const { Pool } = require('pg');
const queries = require('../db/rowSampleQueries');
const { resourceVersion } = require('../services/resourceVersion');
const { sampleOrigin } = require('../services/rowSampler');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

integrationDescribe('resource row samples PostgreSQL integration', () => {
    let pool, db;
    const prefix = 'row_samples_' + process.pid;
    const id = name => prefix + '_' + name;
    const pagePrefix = 'https://canquery.test/resources/';
    const sample = { fields: [{ id: 'ward', label: 'Ward', type: 'text' }], records: [['Rideau']], columns_total: 1, upstream_total: 9 };
    const mine = rows => rows.filter(row => row.id.startsWith(prefix));

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        await db.query('INSERT INTO datasets (id, name, title_en) VALUES ($1, $1, $1)', [id('dataset')]);
        // [key, format, live DataStore, raw]
        for (const [key, format, live, raw] of [
            ['a_csv', 'CSV', false, { record_count: 12, source_hash: 'abc', data_processed: '2026-10-01T00:00:00Z', unrelated: 'x' }],
            ['b_live', 'CSV', true, { source_id: 'open-canada', upstream_resource_id: 'up-1' }],
            ['c_xlsx', 'XLSX', false, {}],
            ['d_ready', 'CSV', false, {}],
            ['e_pdf', 'PDF', false, {}]
        ]) {
            await db.query(`INSERT INTO resources (id, dataset_id, format, url, datastore_active, size_bytes, last_modified, raw)
                VALUES ($1, $2, $3, $4, $5, 2048, '2026-10-02T00:00:00Z', $6)`,
            [id(key), id('dataset'), format, 'https://files.example.test/' + key + '.' + format.toLowerCase(), live, raw]);
        }
        await db.query(`INSERT INTO ingested_resources (resource_id, table_name, status) VALUES ($1, $2, 'ready')`, [id('d_ready'), 'r_' + prefix]);
        // The PDF is the page Google showed on the most days; it cannot be sampled.
        for (const [key, days] of [['b_live', 3], ['a_csv', 1], ['e_pdf', 5]]) {
            for (let day = 0; day < days; day += 1) {
                await db.query(`INSERT INTO search_console_breakdowns (data_date, search_type, dimension, value, impressions)
                    VALUES (current_date - $1::int, 'web', 'page', $2, 5)`, [day + 1, pagePrefix + id(key) + (day ? '?view=table' : '')]);
            }
        }
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });

    test('lists live tables, and CSV files when files are sampled, in id order with the slice the version needs', async () => {
        // By default only live tables are candidates: a CSV that is not prepared has a noindex page.
        const live = mine(await queries.listSweepCandidates({ after: prefix, limit: 1000 }, db));
        expect(live.map(row => row.id)).toEqual([id('b_live')]);
        expect(live.map(row => sampleOrigin(row))).toEqual(['datastore']);
        const rows = mine(await queries.listSweepCandidates({ after: prefix, limit: 1000, files: true }, db));
        expect(rows.map(row => row.id)).toEqual(['a_csv', 'b_live', 'd_ready'].map(id));
        expect(rows.map(row => sampleOrigin(row, { files: true }))).toEqual(['file', 'datastore', null]);
        expect(rows.map(row => sampleOrigin(row))).toEqual([null, 'datastore', null]);
        const { rows: [full] } = await db.query('SELECT * FROM resources WHERE id = $1', [id('a_csv')]);
        expect(resourceVersion(rows[0])).toBe(resourceVersion(full));
        expect(rows[0].raw.unrelated).toBeUndefined();
        expect(rows[2].ingest_status).toBe('ready');
        expect(rows[0].sample_checked_version).toBeNull();
    });

    test('ranks the pages Google showed by days shown, query strings included', async () => {
        const rows = mine(await queries.listShownCandidates({ pagePrefix, days: 28, limit: 200, files: true }, db));
        expect(rows.map(row => row.id)).toEqual([id('b_live'), id('a_csv')]);
        expect(mine(await queries.listShownCandidates({ pagePrefix, days: 28, limit: 200 }, db)).map(row => row.id)).toEqual([id('b_live')]);
        // The limit counts pages that can be sampled: the PDF, shown on more days, does not take the only place.
        expect(mine(await queries.listShownCandidates({ pagePrefix, days: 28, limit: 1 }, db)).map(row => row.id)).toEqual([id('b_live')]);
    });

    test('a failed recheck keeps the last good sample, and due samples come back', async () => {
        const row = mine(await queries.listSweepCandidates({ after: prefix, limit: 10, files: true }, db))[0];
        const version = resourceVersion(row);
        await queries.saveSample({ resourceId: row.id, origin: 'file', status: 'ok', version, sample, bytesRead: 512, attempts: 0,
            nextCheckAt: new Date(Date.now() + 14 * 864e5) }, db);
        expect(await queries.getResourceRowSample(row.id, db)).toMatchObject({ origin: 'file', source_version: version,
            fields: sample.fields, records: sample.records, columns_total: 1 });
        await queries.saveSample({ resourceId: row.id, origin: 'file', status: 'failed', failureCode: 'timeout', version: 'newer',
            attempts: 1, nextCheckAt: new Date(Date.now() - 1000) }, db);
        const kept = await db.query('SELECT status, failure_code, attempts, checked_version, source_version, records, bytes_read FROM resource_row_samples WHERE resource_id = $1', [row.id]);
        expect(kept.rows[0]).toEqual({ status: 'failed', failure_code: 'timeout', attempts: 1, checked_version: 'newer',
            source_version: version, records: sample.records, bytes_read: 512 });
        const due = mine(await queries.listDueCandidates({ limit: 1000, files: true }, db));
        expect(due.map(item => [item.id, item.sample_checked_version, item.sample_attempts, item.sample_stored])).toEqual([[row.id, 'newer', 1, true]]);
        // A stored file sample that is due is not handed out while files are not sampled: it would never be
        // saved again and would stay ahead of every live table in the due list.
        expect(mine(await queries.listDueCandidates({ limit: 1000 }, db))).toEqual([]);
        await queries.saveSample({ resourceId: id('b_live'), origin: 'datastore', status: 'failed', failureCode: 'timeout', version: 'v',
            attempts: 1, nextCheckAt: new Date(Date.now() - 1000) }, db);
        expect(mine(await queries.listDueCandidates({ limit: 1000 }, db)).map(item => item.id)).toEqual([id('b_live')]);
        // A resource with a prepared copy shows the copy's rows and is never sampled again: its old sample must not
        // stay at the head of the due list either.
        await queries.saveSample({ resourceId: id('d_ready'), origin: 'file', status: 'failed', failureCode: 'timeout', version: 'v',
            attempts: 1, nextCheckAt: new Date(Date.now() - 5000) }, db);
        expect(mine(await queries.listDueCandidates({ limit: 1000, files: true }, db)).map(item => item.id).sort())
            .toEqual([id('a_csv'), id('b_live')]);
    });

    test('rejects inconsistent samples and removes a sample with its resource', async () => {
        await db.query('SAVEPOINT broken');
        await expect(db.query(`INSERT INTO resource_row_samples (resource_id, origin, status, checked_version, next_check_at)
            VALUES ($1, 'file', 'ok', 'v', now())`, [id('e_pdf')])).rejects.toMatchObject({ code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT broken');
        await queries.saveSample({ resourceId: id('e_pdf'), origin: 'file', status: 'unsupported', failureCode: 'not_a_table', version: 'v',
            attempts: 1, nextCheckAt: new Date() }, db);
        expect(await queries.getResourceRowSample(id('e_pdf'), db)).toBeNull();
        await db.query('DELETE FROM resources WHERE id = $1', [id('e_pdf')]);
        expect((await db.query('SELECT count(*)::int AS n FROM resource_row_samples WHERE resource_id = $1', [id('e_pdf')])).rows[0].n).toBe(0);
    });
});
