// The website's whole-table read types a CSV sample the way the loader will
// type the prepared copy, so the copy can replace it without a visible change.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { loadCsvIntoStore } = require('../services/csvLoad');
const { sniffCsvMeta } = require('../services/csvDownload');
const { parseFileRows, typeFileColumns } = require('../services/tableRows');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

const FIXTURE = [
    '_id,Ward,Count,Spaces,Amount,Day,Bad day,At,Code,Note',
    '9,A,3,1,1.50,2024-01-05,2024-01-05,2024-01-05 10:00,007,"Montréal, ""east"""',
    '8,B,,2,.5,2023-12-31,2024-02-30,2024-01-05T10:00:00Z,012,',
    '7,C,5, ,1e3,2024-02-29,2024-03-01,2024-01-05T10:00:00.123+02:00,3,plain',
    '6,D,-2,4,-0.25,2024-03-01,2024-03-02,2024-06-30T23:59:59-04:00,040',
    ''
].join('\n');

integrationDescribe('whole-table rows match the loaded copy', () => {
    let pool, db, dir;

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-rows-'));
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    test('types, cell values and _id equal what the loader stores', async () => {
        const filePath = path.join(dir, 'fixture.csv');
        fs.writeFileSync(filePath, FIXTURE);
        const { delimiter, encoding } = await sniffCsvMeta(filePath);
        const tableName = 'r_' + crypto.randomBytes(8).toString('hex');
        const { columns } = await loadCsvIntoStore(db, { filePath, tableName, delimiter, encoding, maxRows: 1000000, maxCols: 120 });
        const { rows: stored } = await db.query('SELECT * FROM store."' + tableName + '" ORDER BY "_id"');
        const copyFields = [{ id: '_id' }, ...columns];
        // What the JSON API would send for the prepared copy.
        const copyRows = JSON.parse(JSON.stringify(stored)).map(record => copyFields.map(field => record[field.id] ?? null));

        const sample = await parseFileRows(Buffer.from(FIXTURE), { complete: true });
        await typeFileColumns(sample.columns, sample.values, db);
        // What the website's whole-table read sends for the same file.
        const fileRows = JSON.parse(JSON.stringify(Array.from({ length: sample.rowCount }, (_, row) =>
            [String(row + 1), ...sample.columns.map((_, column) => sample.values[column][row])])));

        expect(sample.complete).toBe(true);
        expect(sample.columns.map(({ id, type, cast_failed }) => [id, type, Boolean(cast_failed)]))
            .toEqual(columns.map(({ id, type, cast_failed }) => [id, type, Boolean(cast_failed)]));
        expect(fileRows).toEqual(copyRows);
        // The cases this fixture exists for.
        const type = id => columns.find(column => column.id === id).type;
        expect(type('_id_1')).toBe('INTEGER');
        expect(type('Spaces')).toBe('TEXT'); // a blank cell the bigint cast refuses
        expect(type('Bad day')).toBe('TEXT'); // 2024-02-30
        expect(type('Code')).toBe('TEXT'); // leading zeros
        expect(type('At')).toBe('TIMESTAMPTZ');
        expect(copyRows[1][copyFields.findIndex(field => field.id === 'Amount')]).toBe('0.5');
    });
});
