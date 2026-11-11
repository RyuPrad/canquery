const { Pool } = require('pg');
const queries = require('../db/oasQueries');
const { parseAmounts } = require('../services/oasAmounts');
const { OAS_DATASET_ID, OAS_TABLES } = require('../utils/oasLabels');
const { resourceVersion } = require('../services/resourceVersion');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

const BASE = ['benefityear', 'benefitquarter', 'incomeyear', 'income_from', 'income_to'];
// A table as the publisher writes it: `rows` bands of $24 from 0, a dollar less per band.
function tableRecords(table, { rows = 100, year = 2999, quarter = 4, incomeYear = 2998, top = 113890 } = {}) {
    const columns = [...BASE, ...OAS_TABLES[table]];
    const body = [];
    for (let position = 0; position < rows; position += 1) {
        const amount = top - position * 100;
        const cells = { benefityear: year, benefitquarter: quarter, incomeyear: incomeYear,
            income_from: position * 24, income_to: (position * 2400 + 2399) / 100,
            gistotal: amount / 100, gistotalwithoas65: (amount + 76250) / 100, gistotalwithoas75: (amount + 83875) / 100,
            alwtotal: (amount + 500) / 100, alwstotal: amount / 100 };
        body.push(columns.map(name => String(cells[name])));
    }
    return [columns.map(name => 't' + table + name), ...body];
}

// Quarters of the year 2999 keep these tables apart from any real quarter in the database.
integrationDescribe('OAS benefit amounts PostgreSQL integration', () => {
    let pool, db;
    const prefix = 'oas_amounts_' + process.pid;
    const id = name => prefix + '_' + name;
    // Quarters of 2999 are plausible only to a run that believes it is 2999.
    const parsed = (table, options) => parseAmounts(tableRecords(table, options), { now: new Date('2999-07-01T00:00:00Z') });
    const mine = rows => rows.filter(row => Number(row.period_key) >= 299900);
    const save = (table, options, version = 'v1') => queries.saveOasTable({ resource_id: id('t' + table), version, table: parsed(table, options) }, db);
    // A statement that must fail, without ending the test's transaction.
    async function rejected(sql, params = []) {
        await db.query('SAVEPOINT oas_rejected');
        try {
            await db.query(sql, params);
        } catch (error) {
            await db.query('ROLLBACK TO SAVEPOINT oas_rejected');
            return error.code;
        }
        await db.query('ROLLBACK TO SAVEPOINT oas_rejected');
        return 'accepted';
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        await db.query(`INSERT INTO datasets (id, name, title_en) VALUES ($1, $1, 'OAS') ON CONFLICT (id) DO NOTHING`, [OAS_DATASET_ID]);
        await db.query(`INSERT INTO datasets (id, name, title_en) VALUES ($1, $1, 'Other')`, [id('other')]);
        for (const [key, dataset, language, format, name, link] of [
            ['t1', OAS_DATASET_ID, 'en, fr', 'CSV', 'Table 1 - GIS for single person who receives an OAS pension', 'https://files.example.test/t1.csv'],
            ['t2', OAS_DATASET_ID, 'en, fr', 'csv', 'Table 2 - GIS for spouse', 'https://files.example.test/t2.csv'],
            ['t1_xlsx', OAS_DATASET_ID, 'en, fr', 'XLSX', 'Table 1 - GIS for single person who receives an OAS pension', 'https://files.example.test/t1.xlsx'],
            ['pdf', OAS_DATASET_ID, 'en, fr', 'PDF', 'Table of Amounts', 'https://files.example.test/amounts.pdf'],
            ['nourl', OAS_DATASET_ID, 'en, fr', 'CSV', 'Table 3 - not uploaded yet', null],
            ['elsewhere', id('other'), 'en', 'CSV', 'Table 1 - another dataset', 'https://files.example.test/other.csv']
        ]) {
            await db.query(`INSERT INTO resources (id, dataset_id, name_en, language, format, url, size_bytes, last_modified, raw)
                VALUES ($1, $2, $3, $4, $5, $6, 4096, '2999-09-29T14:00:00Z', $7)`,
            [id(key), dataset, name, language, format, link, { hash: 'h-' + key, unrelated: 'x' }]);
        }
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });

    test('lists the dataset’s CSV files, bilingual ones included, with the slice the version needs', async () => {
        const rows = (await queries.listOasResources(db)).filter(row => row.id.startsWith(prefix));
        expect(rows.map(row => row.id)).toEqual([id('t1'), id('t2')]);
        const { rows: [full] } = await db.query('SELECT * FROM resources WHERE id = $1', [id('t1')]);
        expect(resourceVersion(rows[0])).toBe(resourceVersion(full));
        expect(rows[0].raw.unrelated).toBeUndefined();
        expect(rows[0].name_en).toBe('Table 1 - GIS for single person who receives an OAS pension');
    });

    test('a quarter is listed once its five tables are loaded, with every row as published', async () => {
        const before = mine(await queries.listOasPeriods(db));
        expect(before).toEqual([]);
        for (const table of [1, 2, 3, 4]) expect(await save(table, { quarter: 3 })).toBe(100);
        expect(mine(await queries.listOasPeriods(db))).toEqual([]);
        await save(5, { quarter: 3, top: 172618 });
        const [period] = mine(await queries.listOasPeriods(db));
        expect(period).toMatchObject({ period_key: 299909, benefit_year: 2999, benefit_quarter: 3, income_year: 2998 });
        expect(period.loaded_at).toBeInstanceOf(Date);

        const files = mine(await queries.listOasFiles(db));
        expect(files.map(file => [file.period_key, file.table_no, file.resource_id, file.source_version, file.row_count])).toEqual(
            [1, 2, 3, 4, 5].map(table => [299909, table, id('t' + table), 'v1', 100]));
        expect(files[0].content_sha256).toBe(parsed(1, { quarter: 3 }).hash);
        const { rows } = await db.query(`SELECT * FROM oas_rows WHERE period_key = 299909 AND table_no = ANY($1::smallint[])
            AND line IN (1, 100) ORDER BY table_no, line`, [[1, 4, 5]]);
        expect(rows.map(({ period_key: _period, ...row }) => row)).toEqual([
            { table_no: 1, line: 1, income_from_cents: 0, income_to_cents: 2399, amount_cents: 113890, allowance_cents: null,
                with_oas_65_cents: 190140, with_oas_75_cents: 197765 },
            { table_no: 1, line: 100, income_from_cents: 237600, income_to_cents: 239999, amount_cents: 103990, allowance_cents: null,
                with_oas_65_cents: 180240, with_oas_75_cents: 187865 },
            { table_no: 4, line: 1, income_from_cents: 0, income_to_cents: 2399, amount_cents: 113890, allowance_cents: 114390,
                with_oas_65_cents: 190140, with_oas_75_cents: 197765 },
            { table_no: 4, line: 100, income_from_cents: 237600, income_to_cents: 239999, amount_cents: 103990, allowance_cents: 104490,
                with_oas_65_cents: 180240, with_oas_75_cents: 187865 },
            { table_no: 5, line: 1, income_from_cents: 0, income_to_cents: 2399, amount_cents: 172618, allowance_cents: null,
                with_oas_65_cents: null, with_oas_75_cents: null },
            { table_no: 5, line: 100, income_from_cents: 237600, income_to_cents: 239999, amount_cents: 162718, allowance_cents: null,
                with_oas_65_cents: null, with_oas_75_cents: null }
        ]);
    });

    test('a newer quarter replaced only in part is not listed, and the older one stays whole', async () => {
        for (const table of [1, 2, 3]) await save(table, { quarter: 4, top: 115000 }, 'v2');
        expect(mine(await queries.listOasPeriods(db)).map(period => period.period_key)).toEqual([299909]);
        expect(mine(await queries.listOasFiles(db))).toHaveLength(8);
        const { rows: [counts] } = await db.query(`SELECT count(*) FILTER (WHERE period_key = 299909)::int AS old,
            count(*) FILTER (WHERE period_key = 299912)::int AS new FROM oas_rows WHERE period_key >= 299900`);
        expect(counts).toEqual({ old: 500, new: 300 });
        await save(4, { quarter: 4, top: 115000 }, 'v2');
        await save(5, { quarter: 4, top: 175000 }, 'v2');
        expect(mine(await queries.listOasPeriods(db)).map(period => period.period_key)).toEqual([299909, 299912]);
    });

    test('a corrected file replaces its table and its date; the same rows published again keep both', async () => {
        // loaded_at to the microsecond, so two loads a moment apart are told apart.
        const stamp = async () => (await db.query(`SELECT (extract(epoch FROM loaded_at) * 1000000)::bigint AS loaded,
            resource_id, source_version, row_count FROM oas_files WHERE period_key = 299912 AND table_no = 2`)).rows[0];
        const loaded = await stamp();
        expect(await queries.touchOasTable({ period_key: 299912, table: 2, resource_id: id('t2_new'), version: 'v3' }, db)).toBe(1);
        expect(await stamp()).toEqual({ ...loaded, resource_id: id('t2_new'), source_version: 'v3' });
        expect(await queries.touchOasTable({ period_key: 299903, table: 2, resource_id: id('t2'), version: 'v9' }, db)).toBe(0);

        expect(await queries.saveOasTable({ resource_id: id('t2'), version: 'v4', table: parsed(2, { quarter: 4, top: 114000, rows: 120 }) }, db)).toBe(120);
        const corrected = await stamp();
        expect(corrected).toMatchObject({ resource_id: id('t2'), source_version: 'v4', row_count: 120 });
        expect(BigInt(corrected.loaded)).toBeGreaterThan(BigInt(loaded.loaded));
        const { rows } = await db.query('SELECT count(*)::int AS rows, max(amount_cents) AS top FROM oas_rows WHERE period_key = 299912 AND table_no = 2');
        expect(rows[0]).toEqual({ rows: 120, top: 114000 });
        // Still one quarter of five tables.
        expect(mine(await queries.listOasPeriods(db)).map(period => period.period_key)).toEqual([299909, 299912]);
    });

    test('tables that disagree on the income year do not make a quarter', async () => {
        for (const table of [1, 2, 3, 4]) await save(table, { quarter: 2, incomeYear: 2997 });
        await save(5, { quarter: 2, incomeYear: 2998 });
        expect(mine(await queries.listOasFiles(db)).filter(file => file.period_key === 299906)).toHaveLength(5);
        expect(mine(await queries.listOasPeriods(db)).map(period => period.period_key)).toEqual([299909, 299912]);
        await save(5, { quarter: 2, incomeYear: 2997 }, 'v2');
        expect(mine(await queries.listOasPeriods(db)).map(period => period.period_key)).toEqual([299906, 299909, 299912]);
    });

    test('the tables refuse what is not a table of amounts', async () => {
        const file = `INSERT INTO oas_files (period_key, table_no, benefit_year, benefit_quarter, income_year, resource_id,
            source_version, content_sha256, row_count) VALUES ($1, $2, $3, $4, $5, 'x', 'v', $6, $7)`;
        const digest = 'a'.repeat(64);
        expect(await rejected(file, [299803, 1, 2998, 1, 2997, digest, 1])).toBe('accepted');
        expect(await rejected(file, [299806, 1, 2998, 1, 2997, digest, 1])).toBe('23514');
        expect(await rejected(file, [299803, 6, 2998, 1, 2997, digest, 1])).toBe('23514');
        expect(await rejected(file, [299803, 1, 2998, 1, 2999, digest, 1])).toBe('23514');
        expect(await rejected(file, [299803, 1, 2998, 1, 2994, digest, 1])).toBe('23514');
        expect(await rejected(file, [299803, 1, 2998, 1, 2997, 'not-a-digest', 1])).toBe('23514');
        expect(await rejected(file, [299803, 1, 2998, 1, 2997, digest, 0])).toBe('23514');
        expect(await rejected(file, [299912, 2, 2999, 4, 2998, digest, 1])).toBe('23505');

        const row = `INSERT INTO oas_rows (period_key, table_no, line, income_from_cents, income_to_cents, amount_cents,
            allowance_cents, with_oas_65_cents, with_oas_75_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
        expect(await rejected(row, [299912, 1, 9001, 0, 99, 500, null, 600, 700])).toBe('accepted');
        expect(await rejected(row, [299912, 1, 1, 0, 99, 500, null, 600, 700])).toBe('23505');
        expect(await rejected(row, [299912, 1, 9001, 100, 99, 500, null, 600, 700])).toBe('23514');
        expect(await rejected(row, [299912, 1, 9001, 0, 99, -1, null, 600, 700])).toBe('23514');
        expect(await rejected(row, [299912, 1, 9001, 0, 99, 500, 100, 600, 700])).toBe('23514');
        expect(await rejected(row, [299912, 1, 9001, 0, 99, 500, null, null, 700])).toBe('23514');
        expect(await rejected(row, [299912, 1, 9001, 0, 99, 500, null, 499, 700])).toBe('23514');
        expect(await rejected(row, [299912, 4, 9001, 0, 99, 500, null, 600, 700])).toBe('23514');
        expect(await rejected(row, [299912, 5, 9001, 0, 99, 500, null, 600, 700])).toBe('23514');
        expect(await rejected(row, [299912, 5, 9001, 0, 99, 500, null, null, null])).toBe('accepted');
        expect(await rejected(row, [299812, 1, 1, 0, 99, 500, null, 600, 700])).toBe('23503');
        expect(await rejected(row, [299912, 1, 0, 0, 99, 500, null, 600, 700])).toBe('23514');
    });

    test('deleting a table deletes its rows', async () => {
        await db.query('SAVEPOINT oas_cascade');
        await db.query('DELETE FROM oas_files WHERE period_key = 299909 AND table_no = 3');
        const { rows: [left] } = await db.query('SELECT count(*)::int AS rows FROM oas_rows WHERE period_key = 299909 AND table_no = 3');
        expect(left.rows).toBe(0);
        expect(mine(await queries.listOasPeriods(db)).map(period => period.period_key)).toEqual([299906, 299912]);
        await db.query('ROLLBACK TO SAVEPOINT oas_cascade');
    });

    test('the job’s memory is kept between runs', async () => {
        await db.query('SAVEPOINT oas_memory');
        await db.query('DELETE FROM sync_progress WHERE key = $1', [queries.MEMORY_KEY]);
        expect(await queries.getOasMemory(db)).toEqual({});
        const memory = { [id('t3')]: { version: 'v7', state: 'failed', failure: 'band_gap', at: '2999-07-01T00:00:00.000Z' } };
        await queries.saveOasMemory(memory, db);
        expect(await queries.getOasMemory(db)).toEqual(memory);
        await queries.saveOasMemory({}, db);
        expect(await queries.getOasMemory(db)).toEqual({});
        await db.query(`UPDATE sync_progress SET value = '{"files": []}' WHERE key = $1`, [queries.MEMORY_KEY]);
        expect(await queries.getOasMemory(db)).toEqual({});
        await db.query('ROLLBACK TO SAVEPOINT oas_memory');
    });
});
