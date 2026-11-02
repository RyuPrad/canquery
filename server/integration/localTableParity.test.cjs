// The resource page's in-browser table (client/src/utils/localTable.js) must
// answer search, filters, sorting and paging exactly as the server's table
// query does, so a table held in the browser shows the same rows the server
// would. This runs both against the same rows on a disposable PostgreSQL.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const enabled = process.env.SPATIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL) {
    test('local table parity requires matching disposable database URLs', { skip: true }, () => {});
} else {
    const pool = require('../db/pool');
    const { queryStoreTable } = require('../db/storeQueries');
    const { parseFilters, validateSort } = require('../utils/filterGrammar');
    after(() => pool.end());

    const COLUMNS = [
        { id: 'name', type: 'TEXT', sql: 'text' },
        { id: 'code', type: 'TEXT', sql: 'text' },
        { id: 'num', type: 'INTEGER', sql: 'bigint' },
        { id: 'amt', type: 'NUMERIC', sql: 'numeric' },
        { id: 'day', type: 'DATE', sql: 'date' },
        { id: 'at', type: 'TIMESTAMPTZ', sql: 'timestamptz' }
    ];
    const ROWS = [
        ['Ward 3', 'b2', 3, '98200.50', '2024-01-05', '2024-01-05 10:00+00'],
        ['ward 11', 'a10', null, '0.5', '2023-12-31', '2024-01-05T08:00:00.123Z'],
        ['Côte 100%', 'c1', 5, '-2', null, null],
        ['Ward_3', 'b10', -2, '1000', '2024-02-29', '2024-07-01T03:59:59Z'],
        ['WARD 3', 'a2', 3, null, '2024-01-05', '2024-01-05 10:00+00'],
        ['', 'z9', 0, '0.50', '2024-12-31', '2023-06-01 00:00:00.5+00'],
        [null, 'b2', 10, '-0.25', '2023-01-01', '2024-01-01 00:00+00'],
        ['a\\b', 'a1', 7, '12345678901234567890.1', '2024-03-01', '2024-03-01 12:30:15-05:00'],
        ['Zoë', 'c2', 1, '3', '2024-01-06', null],
        ['banana', 'b1', 2, '0', '2024-01-04', '2024-01-04 23:59:59.999+00']
    ];
    const QUERIES = {
        q: ['', 'ward', 'ward_3', '100\\%', '2024-01', '0.5', 'zoë', '10:00', 'a\\b'],
        filters: [
            {},
            { num: { op: 'gt', value: '0' } },
            { num: { op: 'eq', value: '3' } },
            { num: null },
            { amt: { op: 'lte', value: '0.5' } },
            { amt: { op: 'eq', value: '0.50' } },
            { day: { op: 'gte', value: '2024-01-01' } },
            { at: { op: 'lt', value: '2024-01-05 09:00' } },
            { name: 'Ward 3' },
            { name: { op: 'contains', value: 'ward' } },
            { code: { op: 'contains', value: 'b_' } },
            { day: { op: 'contains', value: '-01-0' } }
        ],
        sort: [null, 'num', 'num desc', 'amt', 'amt desc', 'day', 'day desc', 'at desc', '_id desc', 'code', 'code desc'],
        pages: [[0, 50], [2, 3]]
    };

    test('search, filters, sorting and paging give the same rows and totals', async () => {
        const engine = await import(pathToFileURL(path.join(__dirname, '../../client/src/utils/localTable.js')));
        const tableName = 'r_' + crypto.randomBytes(8).toString('hex');
        const table = 'store."' + tableName + '"';
        await pool.query('CREATE TABLE ' + table + ' (_id bigserial, ' + COLUMNS.map(c => '"' + c.id + '" ' + c.sql).join(', ') + ')');
        try {
            for (const row of ROWS) {
                await pool.query('INSERT INTO ' + table + ' (' + COLUMNS.map(c => '"' + c.id + '"').join(', ') + ') VALUES (' +
                    COLUMNS.map((_, i) => '$' + (i + 1)).join(', ') + ')', row);
            }
            const knownColumns = COLUMNS.map(c => c.id);
            const fields = [{ id: '_id', type: 'int' }, ...COLUMNS.map(({ id, type }) => ({ id, type }))];
            const stored = JSON.parse(JSON.stringify((await pool.query('SELECT * FROM ' + table + ' ORDER BY "_id"')).rows));
            const local = engine.createLocalTable({ fields, rows: stored.map(r => fields.map(f => r[f.id] ?? null)), complete: true });
            let compared = 0;
            for (const q of QUERIES.q) {
                for (const filters of QUERIES.filters) {
                    for (const sort of QUERIES.sort) {
                        for (const [offset, limit] of QUERIES.pages) {
                            const order = validateSort(sort, ['_id', ...knownColumns]);
                            const server = await queryStoreTable({ tableName, knownColumns, q: q || undefined,
                                filters: parseFilters(JSON.stringify(filters)), sortSql: order ? order.sql : null, limit, offset });
                            const answer = engine.answerLocal(local, { q, filters, sort, offset, limit });
                            const label = JSON.stringify({ q, filters, sort, offset, limit });
                            assert.equal(answer.status, 'ok', label + ' ' + JSON.stringify(answer));
                            assert.deepEqual(answer.records.map(r => r._id), server.records.map(r => r._id), label);
                            assert.equal(answer.total, server.total, label);
                            compared += 1;
                        }
                    }
                }
            }
            assert.ok(compared > 2000);
        } finally {
            await pool.query('DROP TABLE IF EXISTS ' + table);
        }
    });

    // Text sorts follow the database collation (glibc en_US.UTF-8) in
    // PostgreSQL and ICU's en-US in the browser. They agree on letters, digits
    // and case; punctuation and spaces can order differently, which only shows
    // in the silent swap from a file's first rows to its prepared copy.
    test('text sorts agree on letters, digits and case', async () => {
        const engine = await import(pathToFileURL(path.join(__dirname, '../../client/src/utils/localTable.js')));
        const words = ['banana', 'Apple', 'apple', 'cherry', 'Banana', 'a1', 'a10', 'a2', 'Zoë', 'zoe', 'éclair', 'eclair'];
        const { rows } = await pool.query('SELECT w FROM unnest($1::text[]) AS w ORDER BY w', [words]);
        const local = engine.createLocalTable({ fields: [{ id: '_id', type: 'int' }, { id: 'w', type: 'TEXT' }],
            rows: words.map((w, i) => [String(i + 1), w]), complete: true });
        const answer = engine.answerLocal(local, { sort: 'w' });
        assert.deepEqual(answer.records.map(r => r.w), rows.map(r => r.w));
    });
}
