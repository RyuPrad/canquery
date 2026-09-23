const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');

jest.mock('pg-copy-streams', () => ({ from: sql => ({ copySql: sql }) }));
const { loadCsvIntoStore } = require('../services/csvLoad');

describe('CSV column conversion', () => {
    let directory;
    beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-casts-')); });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

    async function load(text, { validity = {}, validationError, rewriteError } = {}) {
        const filePath = path.join(directory, 'data.csv');
        await fs.writeFile(filePath, text);
        const client = {
            query: jest.fn(sql => {
                if (sql.copySql) return new Writable({ write(chunk, encoding, callback) { callback(); } });
                if (sql.startsWith('SELECT ')) {
                    return validationError ? Promise.reject(validationError) : Promise.resolve({ rows: [validity] });
                }
                if (sql.startsWith('ALTER TABLE ') && rewriteError) return Promise.reject(rewriteError);
                return Promise.resolve({ rows: [] });
            })
        };
        const result = loadCsvIntoStore(client, {
            filePath, tableName: 'r_abc', delimiter: ',', encoding: 'utf8', maxRows: 2000, maxCols: 120
        });
        return { result, client };
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
