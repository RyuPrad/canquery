// A row of a prepared copy has no stable id: _id is only its position in the
// file, and a copy rebuilt from a changed file numbers its rows again. So the
// rows a search matches are told apart by a fingerprint of their content
// (db/storeQueries.js matchingRowHashes). This checks on a disposable
// PostgreSQL that the fingerprints match the rows the table's own query finds,
// survive a rebuild and a reordering, and change with any value.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const enabled = process.env.SPATIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL) {
    test('row fingerprints require matching disposable database URLs', { skip: true }, () => {});
} else {
    const pool = require('../db/pool');
    const { queryStoreTable, matchingRowHashes, readStoreRowsByIds } = require('../db/storeQueries');
    const { parseFilters } = require('../utils/filterGrammar');
    after(() => pool.end());

    const COLUMNS = [
        { id: 'street', sql: 'text' }, { id: 'status', sql: 'text' }, { id: 'units', sql: 'bigint' },
        { id: 'value', sql: 'numeric' }, { id: 'issued', sql: 'date' }, { id: 'at', sql: 'timestamptz' }
    ];
    const ROWS = [
        ['KING ST W', 'Issued', 3, '98200.50', '2024-01-05', '2024-01-05 10:00+00'],
        ['Queen St', 'Issued', null, '0.5', '2023-12-31', null],
        ['king st e', 'Closed', 5, null, null, '2024-07-01T03:59:59Z'],
        ['', 'Issued', 0, '0.50', '2024-12-31', null],
        [null, 'Issued', 0, '0.50', '2024-12-31', null],
        ['Viking Rd', 'Review', 1, '3', '2024-01-06', null]
    ];
    const known = COLUMNS.map(column => column.id);
    const names = COLUMNS.map(column => '"' + column.id + '"').join(', ');
    const marks = COLUMNS.map((_, index) => '$' + (index + 1)).join(', ');

    async function build(rows) {
        const tableName = 'r_' + crypto.randomBytes(8).toString('hex');
        const table = 'store."' + tableName + '"';
        await pool.query('CREATE TABLE ' + table + ' (_id bigserial, ' + COLUMNS.map(column => '"' + column.id + '" ' + column.sql).join(', ') + ')');
        for (const row of rows) await pool.query('INSERT INTO ' + table + ' (' + names + ') VALUES (' + marks + ')', row);
        return tableName;
    }
    const drop = tableName => pool.query('DROP TABLE IF EXISTS store."' + tableName + '"');
    const hashes = (tableName, query = {}) => matchingRowHashes({ tableName, knownColumns: known, q: query.q,
        filters: parseFilters(query.filters ? JSON.stringify(query.filters) : undefined), limit: query.limit ?? 100 });

    test('the fingerprints are the rows the table query finds, without their position', async () => {
        const first = await build(ROWS);
        // The same file with its rows in another order, and one row changed, one added.
        const second = await build([ROWS[5], ROWS[4], ROWS[3], ROWS[2], ['Queen St', 'Issued', null, '0.5', '2024-01-01', null], ROWS[0],
            ['King St N', 'Issued', 2, '10', '2024-08-01', null]]);
        try {
            for (const query of [{}, { q: 'king' }, { filters: { status: 'Issued' } }, { q: 'st', filters: { units: { op: 'gte', value: '1' } } },
                { filters: { street: { op: 'contains', value: 'king' } } }, { filters: { value: null } }]) {
                const found = await hashes(first, query);
                const page = await queryStoreTable({ tableName: first, knownColumns: known, q: query.q,
                    filters: parseFilters(query.filters ? JSON.stringify(query.filters) : undefined), sortSql: null, limit: 100, offset: 0 });
                assert.deepEqual(found.map(row => row.id), page.records.map(row => String(row._id)), JSON.stringify(query));
                assert.ok(found.every(row => /^[0-9a-f]{32}$/.test(row.hash)));
            }
            const before = await hashes(first);
            const after = await hashes(second);
            assert.equal(new Set(before.map(row => row.hash)).size, ROWS.length, 'an empty text and NULL are different rows');
            const kept = new Set(before.map(row => row.hash));
            const fresh = after.filter(row => !kept.has(row.hash));
            // Five rows kept their fingerprint although their _id changed; the changed row and the added row are new.
            assert.equal(after.length - fresh.length, 5);
            assert.deepEqual((await readStoreRowsByIds({ tableName: second, ids: fresh.map(row => row.id) })).records.map(row => row.street),
                ['Queen St', 'King St N']);
            assert.deepEqual(await readStoreRowsByIds({ tableName: second, ids: [] }), { records: [] });
            assert.equal((await hashes(first, { limit: 2 })).length, 2);
        } finally {
            await drop(first);
            await drop(second);
        }
    });

    test('a value written another way keeps its fingerprint only when PostgreSQL reads the same value', async () => {
        const base = await build([['A', 'x', 1, '1.50', '2024-01-05', '2024-01-05 10:00+00']]);
        const digits = await build([['A', 'x', 1, '1.5', '2024-01-05', '2024-01-05 10:00+00']]);
        const zone = await build([['A', 'x', 1, '1.50', '2024-01-05', '2024-01-05 05:00:00.000-05']]);
        try {
            const [first] = await hashes(base);
            // A number keeps the digits it was written with; an instant is the same in any zone.
            assert.notEqual((await hashes(digits))[0].hash, first.hash);
            assert.equal((await hashes(zone))[0].hash, first.hash);
        } finally {
            await drop(base); await drop(digits); await drop(zone);
        }
    });
}
