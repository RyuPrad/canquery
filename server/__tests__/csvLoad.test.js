const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');

jest.mock('pg-copy-streams', () => ({ from: sql => ({ copySql: sql }) }));
const { loadCsvIntoStore } = require('../services/csvLoad');
const { sniffCsvMeta } = require('../services/csvDownload');

describe('CSV column conversion', () => {
    let directory;
    beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-casts-')); });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

    async function load(text, { validity = {}, validationError, rewriteError, sniff = false } = {}) {
        const filePath = path.join(directory, 'data.csv');
        await fs.writeFile(filePath, text);
        const copied = [];
        const client = {
            query: jest.fn(sql => {
                if (sql.copySql) return new Writable({ write(chunk, encoding, callback) { copied.push(chunk.toString()); callback(); } });
                if (sql.startsWith('SELECT ')) {
                    return validationError ? Promise.reject(validationError) : Promise.resolve({ rows: [validity] });
                }
                if (sql.startsWith('ALTER TABLE ') && rewriteError) return Promise.reject(rewriteError);
                return Promise.resolve({ rows: [] });
            })
        };
        const metadata = sniff ? await sniffCsvMeta(filePath) : { delimiter: ',', encoding: 'utf8' };
        const result = loadCsvIntoStore(client, {
            filePath, tableName: 'r_abc', ...metadata, maxRows: 2000, maxCols: 120
        });
        return { result, client, copied };
    }

    test('uses database types matching publication and batches valid conversions', async () => {
        const { result, client } = await load('id,amount,date,time\n3000000000,1.5,2026-09-23,2026-09-23T01:00:00Z\n', {
            validity: { cast_0: true, cast_1: true, cast_2: true, cast_3: true }
        });
        expect((await result).columns.map(col => col.type)).toEqual(['INTEGER', 'NUMERIC', 'DATE', 'TIMESTAMPTZ']);
        const validation = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('SELECT '));
        expect(validation[1]).toEqual(['bigint', 'numeric', 'date', 'timestamptz']);
        const alterations = client.query.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.startsWith('ALTER TABLE '));
        expect(alterations).toHaveLength(1);
        expect(alterations[0][0].match(/ALTER COLUMN/g)).toHaveLength(4);
    });

    test('invalid input keeps only the affected column as TEXT', async () => {
        const { result, client } = await load('amount,date\n10,2026-09-23\n', {
            validity: { cast_0: false, cast_1: true }
        });
        expect((await result).columns).toEqual([
            { id: 'amount', type: 'TEXT', cast_failed: true }, { id: 'date', type: 'DATE' }
        ]);
        const alteration = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('ALTER TABLE '))[0];
        expect(alteration).not.toContain('ALTER COLUMN "amount"');
        expect(alteration).toContain('ALTER COLUMN "date"');
    });

    test('text-only files require no validation or rewrite', async () => {
        const { result, client } = await load('name,province\nAlice,Ontario\n');
        expect((await result).columns.every(col => col.type === 'TEXT')).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => typeof sql === 'string' && /^(SELECT|ALTER TABLE)/.test(sql))).toBe(false);
    });

    test('keeps every publisher _id field separate from the generated row identity', async () => {
        const { result, client, copied } = await load('_id,_id_1,_id\na,b,c\n');
        expect((await result).columns.map(column => column.id)).toEqual(['_id_1', '_id_1_2', '_id_3']);
        const createSql = client.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('CREATE TABLE '))[0];
        expect(createSql).toBe('CREATE TABLE store."r_abc" (_id bigserial, "_id_1" text, "_id_1_2" text, "_id_3" text)');
        expect(copied.join('')).toBe('"a","b","c"\n');
    });

    test.each(['utf16le', 'utf16be'])('uses the same %s decoder for sampling and complete COPY', async encoding => {
        const text = 'Place,Note\r\nMontréal,"été 🐟"\r\nQuébec,"deux lignes\nensemble"\r\n';
        const bytes = Buffer.from('\uFEFF' + text, 'utf16le');
        const { result, copied } = await load(encoding === 'utf16be' ? bytes.swap16() : bytes, { sniff: true });
        expect(await result).toEqual({
            rowCount: 2, columns: [{ id: 'Place', type: 'TEXT' }, { id: 'Note', type: 'TEXT' }]
        });
        expect(copied.join('')).toBe('"Montréal","été 🐟"\n"Québec","deux lignes\nensemble"\n');
    });

    test('loads quoted pipe headers and CR-only records without relaxing quote validation', async () => {
        const { result, copied } = await load('"Place | region"|Note\rMontréal|"été | automne"\r', { sniff: true });
        expect(await result).toEqual({
            rowCount: 1, columns: [{ id: 'Place | region', type: 'TEXT' }, { id: 'Note', type: 'TEXT' }]
        });
        expect(copied.join('')).toBe('"Montréal","été | automne"\n');
    });

    test('sampling read failures reject before creating a replacement table', async () => {
        const client = { query: jest.fn() };
        await expect(loadCsvIntoStore(client, {
            filePath: path.join(directory, 'missing.csv'), tableName: 'r_abc',
            delimiter: ',', encoding: 'utf16le', maxRows: 2000, maxCols: 120
        })).rejects.toMatchObject({ code: 'ENOENT' });
        expect(client.query).not.toHaveBeenCalled();
    });

    test('complete COPY rejects malformed UTF-16 beyond the sampled rows', async () => {
        const valid = Buffer.from('\uFEFFName,Note\n' + ('x,' + 'y'.repeat(50) + '\n').repeat(1500), 'utf16le');
        // A final high surrogate is complete in bytes but invalid at EOF.
        const { result, client } = await load(Buffer.concat([valid, Buffer.from([0x00, 0xd8])]), { sniff: true });
        await expect(result).rejects.toMatchObject({ code: 'CSV_ENCODING' });
        expect(client.query.mock.calls.some(([sql]) => sql.copySql)).toBe(true);
    });

    test.each(['validation', 'rewrite'])('%s infrastructure failures abort the import', async stage => {
        const error = Object.assign(new Error('disk full'), { code: '53100' });
        const { result, client } = await load('amount,date\n10,2026-09-23\n', {
            validity: { cast_0: true, cast_1: true },
            [stage + 'Error']: error
        });
        await expect(result).rejects.toBe(error);
        expect(client.query.mock.calls.some(([sql]) => typeof sql === 'string' && sql.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(false);
    });
});
