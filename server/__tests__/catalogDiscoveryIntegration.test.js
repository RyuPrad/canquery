const { Pool } = require('pg');
const queries = require('../db/catalogReadQueries');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

integrationDescribe('complete catalogue discovery PostgreSQL integration', () => {
    let pool, db, datasetCount, resourceCount;
    const prefix = 'discovery_test_' + process.pid;
    const id = name => prefix + '_' + name;
    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        datasetCount = await queries.countSitemapDatasets(db);
        resourceCount = await queries.countSitemapResources(db);
        await db.query(`INSERT INTO organizations (id, name, title_fr) VALUES
            ($1, $1, 'Organisme principal'), ($2, $2, 'ÉTUDES DU NORD')`, [prefix, id('publisher')]);
        await db.query(`INSERT INTO datasets (id, name, title_en, org_id, metadata_modified)
            SELECT $1 || lpad(n::text, 3, '0'), $1 || lpad(n::text, 3, '0'), 'Example data ' || n,
                   $2, '2026-08-01'::timestamptz FROM generate_series(0, 100) n`, [id('dataset'), prefix]);
        await db.query('UPDATE datasets SET org_id = $1 WHERE id = $2', [id('publisher'), id('dataset100')]);
        await db.query(`INSERT INTO resources (id, dataset_id, format, url, datastore_active)
            SELECT $1 || n, $2 || lpad(n::text, 3, '0'), CASE WHEN n=0 THEN 'PDF' ELSE 'CSV' END,
                   'https://example.test/data', n=2 FROM generate_series(0, 4) n`, [id('resource'), id('dataset')]);
        await db.query(`INSERT INTO ingested_resources (resource_id, table_name, status) VALUES ($1, $2, 'ready')`, [id('resource3'), id('table')]);
        await db.query(`INSERT INTO resource_maps (resource_id, provider, service_url, geometry_type)
            VALUES ($1, 'arcgis', 'https://example.test/FeatureServer/0', 'polygon')`, [id('resource4')]);
        await db.query(`INSERT INTO resources (id, dataset_id) VALUES ($1, $2)`, [id('orphan'), id('missing')]);
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });
    test('includes metadata-only datasets and all five resource capabilities, excluding orphan resources', async () => {
        expect(await queries.countSitemapDatasets(db)).toBe(datasetCount + 101);
        expect(await queries.countSitemapResources(db)).toBe(resourceCount + 5);
        const datasets = await queries.listDatasetSitemap({ limit: 25000, offset: 0 }, db);
        expect(datasets.filter(row => row.id.startsWith(prefix))).toHaveLength(101);
        const resources = await queries.listResourceSitemap({ limit: 25000, offset: 0 }, db);
        expect(resources.filter(row => row.id.startsWith(prefix)).map(row => row.id)).toEqual(
            [0, 1, 2, 3, 4].map(n => id('resource' + n)));
        expect(resources.find(row => row.id === id('resource0')).metadata_modified.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });
    test('pages through tied dataset dates without losing or repeating records', async () => {
        const search = offset => queries.searchDatasets({ org: prefix, q: null, limit: 50, offset }, db);
        const pages = [...await search(0), ...await search(50)];
        expect(pages).toHaveLength(100);
        expect(new Set(pages.map(row => row.id)).size).toBe(100);
        expect(await search(100)).toHaveLength(0);
    });
    test('publisher search covers the directory with literal bilingual matching', async () => {
        const search = q => queries.listOrganizations({ q, limit: 50, offset: 0 }, db);
        expect((await search('études du nord')).map(row => row.name)).toEqual([id('publisher')]);
        expect(await search('%études%')).toHaveLength(0);
    });
    test('filters before pagination and retains resource capabilities on the selected page', async () => {
        const page = await queries.searchDatasets({ org: prefix, format: 'CSV', limit: 2, offset: 1 }, db);
        expect(page.map(row => row.id)).toEqual([id('dataset002'), id('dataset003')]);
        for (const [index, row] of page.entries()) {
            expect(row.resource_count).toBe(1);
            expect(row.queryable_count).toBe(1);
            expect(row.preview_table_id).toBe(id('resource' + (index + 2)));
            expect(row.org_name).toBe(prefix);
        }
        const maps = await queries.searchDatasets({ org: prefix, mappable: true, limit: 1, offset: 0 }, db);
        expect(maps.map(row => row.id)).toEqual([id('dataset004')]);
        expect(maps[0].mappable_count).toBe(1);
        expect(maps[0].preview_map_id).toBe(id('resource4'));
    });
    test('sitemap chunk offsets partition resources without duplicate joins', async () => {
        const all = await queries.listResourceSitemap({ limit: 25000, offset: 0 }, db);
        const first = await queries.listResourceSitemap({ limit: 2, offset: 0 }, db);
        const rest = await queries.listResourceSitemap({ limit: 25000, offset: 2 }, db);
        expect([...first, ...rest]).toEqual(all);
    });
});
