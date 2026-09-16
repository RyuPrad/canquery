const enabled = Boolean(process.env.SPATIAL_TEST_DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const pool = require('../db/pool');
const longPool = require('../db/longRunningPool');
const { prepareResource } = require('../services/preparationService');
const { resourceVersion, preparationInfo } = require('../services/resourceVersion');
const { getResourceById } = require('../db/catalogReadQueries');
const { ingestResource } = require('../services/ingestPipeline');
const { withSnapshot } = require('../db/snapshotRead');
const { cleanRetiredTables } = require('../services/retiredIngestTables');
const { withStoreBudgetLock, evictUntilUnderBudget } = require('../services/evictService');
const { queryResource, queryResourceForExport } = require('../services/queryService');
const { claimJob, recoverOrphanedJobs } = require('../db/ingestWorkerQueries');
const { processJob } = require('../scripts/ingest-worker');

let serial = 0;
let verifiedDisposable = false;
const csv = (value = 1) => 'province,amount\n' + Array.from({ length: 600 }, (_, n) => `${n < 50 ? 'ON' : 'QC'},${value}`).join('\n');
const caps = text => ({
    maxFileBytes: 1048576, maxXlsxBytes: 1048576, maxRows: 1000, maxCols: 120,
    storeBudgetBytes: 10485760, storeReserveBytes: 0, storeSizeMultiplier: 0,
    minTmpFreeBytes: 0, minStoreFreeBytes: 0,
    fetchImpl: async () => new Response(text)
});

async function seed() {
    const id = 'prepare-test-' + (++serial);
    await pool.query("INSERT INTO datasets (id,name,title_en) VALUES ($1,$1,'Preparation test')", [id]);
    await pool.query(`INSERT INTO resources (id,dataset_id,format,url,last_modified)
        VALUES ($1,$1,'CSV','https://example.org/data.csv','2026-01-01')`, [id]);
    return id;
}

async function modify(id) {
    await pool.query("UPDATE resources SET last_modified = last_modified + interval '1 day' WHERE id = $1", [id]);
    return getResourceById(id);
}

async function cleanup() {
    const { rows } = await pool.query(`SELECT table_name FROM ingested_resources WHERE resource_id LIKE 'prepare-test-%'
        UNION SELECT table_name FROM retired_ingest_tables WHERE resource_id LIKE 'prepare-test-%'`);
    for (const row of rows) {
        if (/^r_[a-f0-9_]+$/.test(row.table_name)) await pool.query('DROP TABLE IF EXISTS store."' + row.table_name + '"');
    }
    for (const table of ['retired_ingest_tables', 'ingested_resources', 'ingest_jobs', 'ingest_runs']) {
        await pool.query('DELETE FROM ' + table + " WHERE resource_id LIKE 'prepare-test-%'");
    }
    await pool.query("DELETE FROM resources WHERE id LIKE 'prepare-test-%'");
    await pool.query("DELETE FROM datasets WHERE id LIKE 'prepare-test-%'");
}

suite('automatic preparation and immutable snapshots (PostgreSQL)', () => {
    beforeAll(async () => {
        if (process.env.CANQUERY_DATABASE_URL !== process.env.SPATIAL_TEST_DATABASE_URL) {
            throw new Error('Preparation integration requires both database URLs to point to the same disposable database');
        }
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM ingested_resources WHERE resource_id NOT LIKE 'prepare-test-%'");
        if (rows[0].n) throw new Error('Refusing eviction tests in a database containing non-test prepared resources');
        verifiedDisposable = true;
    });
    beforeEach(cleanup);
    afterEach(() => { delete process.env.AUTO_PREPARE_MAX_ACTIVE; delete process.env.AUTO_PREPARE_PER_IP_HOUR; });
    afterAll(async () => {
        if (verifiedDisposable) await cleanup();
        await Promise.all([pool.end(), longPool.end()]);
    });

    test('concurrent visitors share one job; joining does not consume another admission', async () => {
        const id = await seed();
        process.env.AUTO_PREPARE_PER_IP_HOUR = '1';
        const results = await Promise.all(Array.from({ length: 12 }, () => prepareResource(id, id)));
        expect(new Set(results.map(x => x.id)).size).toBe(1);
        expect((await pool.query('SELECT count(*)::int AS n FROM ingest_jobs WHERE resource_id=$1', [id])).rows[0].n).toBe(1);
        const other = await seed();
        await expect(prepareResource(other, id)).rejects.toMatchObject({ statusCode: 429 });
    });

    test('different resources cannot race past the global queue bound', async () => {
        process.env.AUTO_PREPARE_MAX_ACTIVE = '2';
        const ids = await Promise.all(Array.from({ length: 5 }, seed));
        const results = await Promise.allSettled(ids.map(id => prepareResource(id, id)));
        expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(2);
        expect(results.filter(x => x.status === 'rejected').every(x => x.reason.statusCode === 429)).toBe(true);
    });

    test('first preparation persists a version and charts aggregate rows beyond page one', async () => {
        const id = await seed();
        await ingestResource(await getResourceById(id), caps(csv()));
        expect(preparationInfo(await getResourceById(id)).freshness).toBe('current');
        expect(await prepareResource(id, id)).toMatchObject({ already_loaded: true, row_count: 600 });
        await withSnapshot(id, async () => {
            expect((await queryResource(id, { limit: 50 })).records).toHaveLength(50);
            const all = await queryResource(id, { group_by: 'province', agg: 'sum', agg_column: 'amount' });
            expect(all.records).toEqual([{ key: 'ON', value: '50' }, { key: 'QC', value: '550' }]);
            const filtered = await queryResource(id, { filters: JSON.stringify({ province: 'QC' }), group_by: 'province', agg: 'count' });
            expect(filtered.records).toEqual([{ key: 'QC', value: '550' }]);
        });
    });

    test('refresh publishes a new snapshot while an existing export finishes on its old one', async () => {
        const id = await seed();
        const first = await ingestResource(await getResourceById(id), caps(csv(1)));
        const updated = await modify(id);
        const job = await prepareResource(id, id);
        expect(job.serving_cached).toBe(true);
        await withSnapshot(id, async () => {
            const result = await queryResourceForExport(id);
            let n = 0;
            for await (const record of result.records) {
                expect(Number(record.amount)).toBe(1);
                if (++n === 1) {
                    await ingestResource(updated, caps(csv(2)));
                    expect((await pool.query('SELECT count(*)::int AS n FROM retired_ingest_tables WHERE resource_id=$1', [id])).rows[0].n).toBe(1);
                }
            }
            expect(n).toBe(600);
        });
        await withStoreBudgetLock(pool, () => cleanRetiredTables(pool));
        expect((await pool.query('SELECT to_regclass($1) AS name', ['store.' + first.tableName])).rows[0].name).toBeNull();
        await withSnapshot(id, async () => {
            const result = await queryResource(id, { group_by: 'province', agg: 'sum', agg_column: 'amount' });
            expect(result.records).toEqual([{ key: 'ON', value: '100' }, { key: 'QC', value: '1100' }]);
        });
    });

    test('a failed replacement leaves the previous data and version intact', async () => {
        const id = await seed();
        const first = await ingestResource(await getResourceById(id), caps(csv()));
        const updated = await modify(id);
        await expect(ingestResource(updated, caps(''))).rejects.toMatchObject({ code: 'CSV_EMPTY' });
        const row = await getResourceById(id);
        expect(row.table_name).toBe(first.tableName);
        expect(preparationInfo(row).freshness).toBe('stale');
        expect((await queryResource(id, { limit: 1 })).records).toHaveLength(1);
    });

    test('a source changed during download cannot publish an obsolete build', async () => {
        const id = await seed();
        const before = await getResourceById(id);
        const options = { ...caps(csv()), fetchImpl: async () => { await modify(id); return new Response(csv()); } };
        await expect(ingestResource(before, options)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
        expect((await getResourceById(id)).ingest_status).toBeNull();
    });

    test('replacement accounting includes the old copy and cannot evict it', async () => {
        const id = await seed();
        const first = await ingestResource(await getResourceById(id), caps(csv()));
        await expect(ingestResource(await modify(id), { ...caps(csv(2)), storeBudgetBytes: first.byteSize }))
            .rejects.toMatchObject({ code: 'BUDGET' });
        expect((await getResourceById(id)).table_name).toBe(first.tableName);
    });

    test('eviction skips a snapshot with an active reader', async () => {
        const id = await seed();
        await ingestResource(await getResourceById(id), caps(csv()));
        await withSnapshot(id, async () => {
            const result = await evictUntilUnderBudget(pool, { budgetBytes: 0 });
            expect(result.budgetSatisfied).toBe(false);
            expect((await queryResource(id)).records.length).toBeGreaterThan(0);
        });
    });

    test('legacy copies revalidate lazily and unchanged failures honor their cooldown', async () => {
        const id = await seed();
        await ingestResource(await getResourceById(id), caps(csv()));
        await pool.query('UPDATE ingested_resources SET source_version=NULL WHERE resource_id=$1', [id]);
        expect(preparationInfo(await getResourceById(id)).freshness).toBe('unknown');
        const job = await prepareResource(id, id);
        await pool.query("UPDATE ingest_jobs SET status='failed', retry_at=now()+interval '1 hour' WHERE id=$1", [job.id]);
        await expect(prepareResource(id, id)).rejects.toMatchObject({ statusCode: 429, publicCode: 'PREPARATION_COOLDOWN' });
        await modify(id);
        expect((await prepareResource(id, id)).id).not.toBe(job.id);
    });

    test('a refresh committed before a worker crash is reconciled without downloading again', async () => {
        const id = await seed();
        const job = await prepareResource(id, id);
        await claimJob(pool, 'test-worker');
        await ingestResource(await getResourceById(id), caps(csv()));
        await recoverOrphanedJobs(pool);
        const recovered = await claimJob(pool, 'recovered-worker');
        await processJob(recovered, 'recovered-worker');
        const done = (await pool.query('SELECT status FROM ingest_jobs WHERE id=$1', [job.id])).rows[0];
        expect(done.status).toBe('done');
        expect((await getResourceById(id)).ingested_source_version).toBe(resourceVersion(await getResourceById(id)));
    });
});
