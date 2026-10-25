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
    test('includes metadata-only datasets and the data-bearing resources, excluding download-only and orphan resources', async () => {
        expect(await queries.countSitemapDatasets(db)).toBe(datasetCount + 101);
        // The PDF (resource0) is download-only; the preparable, DataStore, prepared and mapped CSVs qualify.
        expect(await queries.countSitemapResources(db)).toBe(resourceCount + 4);
        const datasets = await queries.listDatasetSitemap({ limit: 25000, offset: 0 }, db);
        expect(datasets.filter(row => row.id.startsWith(prefix))).toHaveLength(101);
        const resources = await queries.listResourceSitemap({ limit: 25000, offset: 0 }, db);
        expect(resources.filter(row => row.id.startsWith(prefix)).map(row => row.id)).toEqual(
            [1, 2, 3, 4].map(n => id('resource' + n)));
        expect(resources.find(row => row.id === id('resource1')).lastmod.toISOString()).toBe('2026-08-01T00:00:00.000Z');
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
    test('reads the changed dataset and data-bearing resource pages in a window', async () => {
        const window = (since, until) => queries.listChangedSitemapPages({ since: new Date(since), until: new Date(until), limit: 1000 }, db);
        const changed = await window('2026-07-31T00:00:00Z', '2026-08-02T00:00:00Z');
        expect(changed.datasets.filter(row => row.id.startsWith(prefix))).toHaveLength(101);
        expect(changed.resources.filter(row => row.id.startsWith(prefix)).map(row => row.id)).toEqual(
            [1, 2, 3, 4].map(n => id('resource' + n)));
        // The window's start is exclusive and its end inclusive.
        const later = await window('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');
        expect(later.datasets.filter(row => row.id.startsWith(prefix))).toHaveLength(0);
        const ending = await window('2026-07-31T00:00:00Z', '2026-08-01T00:00:00Z');
        expect(ending.datasets.filter(row => row.id.startsWith(prefix))).toHaveLength(101);
    });
    test('sitemap chunk offsets partition resources without duplicate joins', async () => {
        const all = await queries.listResourceSitemap({ limit: 25000, offset: 0 }, db);
        const first = await queries.listResourceSitemap({ limit: 2, offset: 0 }, db);
        const rest = await queries.listResourceSitemap({ limit: 25000, offset: 2 }, db);
        expect([...first, ...rest]).toEqual(all);
    });
    test('dates each sitemap chunk by the newest entry of exactly that chunk', async () => {
        const newest = rows => {
            const times = rows.map(row => row.lastmod ?? row.metadata_modified).filter(Boolean).map(value => new Date(value).getTime());
            return times.length ? Math.max(...times) : null;
        };
        const check = (chunks, rows, size) => {
            expect(chunks.map(row => row.chunk)).toEqual(Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => index + 1));
            for (const { chunk, lastmod } of chunks) {
                expect(lastmod ? new Date(lastmod).getTime() : null).toBe(newest(rows.slice((chunk - 1) * size, chunk * size)));
            }
        };
        check(await queries.listResourceSitemapChunkLastmods(2, db), await queries.listResourceSitemap({ limit: 25000, offset: 0 }, db), 2);
        check(await queries.listDatasetSitemapChunkLastmods(40, db), await queries.listDatasetSitemap({ limit: 25000, offset: 0 }, db), 40);
    });
});

integrationDescribe('paged place discovery PostgreSQL integration', () => {
    let pool, db;
    const prefix = 'place_discovery_' + process.pid;
    const id = name => prefix + '_' + name;
    const read = overrides => queries.listPlaces({
        q: null, kind: 'municipality', parent: id('region'), featured: true,
        limit: 100, offset: 0, ...overrides
    }, db);
    const counts = row => [row.dataset_count, row.direct_dataset_count, row.mappable_resource_count];

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        for (const source of ['source1', 'source2']) {
            await db.query(`INSERT INTO catalog_sources (id, kind, name_en, homepage_url, upstream_host)
                VALUES ($1, 'ckan', $1, 'https://example.test', 'example.test')`, [id(source)]);
        }
        for (const [name, kind, parent, title, french, featured, enabled] of [
            ['country', 'country', null, 'Country', null, false, true],
            ['region', 'region', 'country', 'Region', null, true, true],
            ['a', 'municipality', 'region', 'Alpha', null, true, true],
            ['a_twin', 'municipality', 'region', 'Alpha', 'Nord spécial', true, true],
            ['b', 'municipality', 'region', 'Bravo', null, false, true],
            ['c', 'municipality', 'region', 'Charlie', null, true, true],
            ['disabled', 'municipality', 'region', 'Disabled', null, true, false],
            ['isolated', 'municipality', null, 'Isolated', null, true, true]
        ]) {
            await db.query(`INSERT INTO places (id, slug, kind, parent_id, name_en, name_fr, featured, enabled)
                VALUES ($1,$1,$2,$3,$4,$5,$6,$7)`, [id(name), kind, parent ? id(parent) : null, prefix + ' ' + title, french, featured, enabled]);
        }
        await db.query('INSERT INTO place_aliases (slug, place_id) VALUES ($1,$2)', [id('historic'), id('a')]);
        for (const name of ['direct', 'inherited', 'noninherited', 'countrywide', 'localcoverage', 'sibling']) {
            await db.query('INSERT INTO datasets (id, name, title_en) VALUES ($1,$1,$1)', [id(name)]);
        }
        for (const [dataset, place, relationship, descendants, source = 'source1'] of [
            ['direct', 'a', 'direct', false], ['direct', 'a', 'direct', false, 'source2'],
            ['inherited', 'region', 'coverage', true], ['inherited', 'a', 'direct', false],
            ['noninherited', 'region', 'direct', false], ['countrywide', 'country', 'coverage', true],
            ['localcoverage', 'a', 'coverage', false], ['sibling', 'b', 'direct', false]
        ]) {
            await db.query(`INSERT INTO dataset_places (source_id, dataset_id, place_id, relationship, includes_descendants, assignment_method)
                VALUES ($1,$2,$3,$4,$5,'source')`, [id(source), id(dataset), id(place), relationship, descendants]);
        }
        for (const [resource, dataset] of [['map1', 'direct'], ['map2', 'direct'], ['map3', 'inherited']]) {
            await db.query('INSERT INTO resources (id, dataset_id) VALUES ($1,$2)', [id(resource), id(dataset)]);
            await db.query(`INSERT INTO resource_maps (resource_id, provider, service_url, geometry_type)
                VALUES ($1,'arcgis','https://example.test/FeatureServer/0','point')`, [id(resource)]);
        }
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });

    test('deduplicates memberships while distinguishing dataset, direct and mapped-resource counts', async () => {
        const rows = await read();
        expect(rows.map(row => row.id)).toEqual(['a', 'a_twin', 'c'].map(id));
        expect(counts(rows[0])).toEqual([4, 2, 3]);
        expect(counts(rows[1])).toEqual([2, 0, 1]);
        expect(counts(rows[2])).toEqual([2, 0, 1]);
        expect(rows[0].parent_slug).toBe(id('region'));
    });

    test('filters before paging and preserves tied names, count results and empty later pages', async () => {
        const all = await read();
        const paged = [...await read({ limit: 2 }), ...await read({ limit: 2, offset: 2 })];
        expect(paged).toEqual(all);
        expect(await read({ limit: 2, offset: 4 })).toEqual([]);
        expect((await read({ featured: false })).map(row => row.id)).toEqual([id('b')]);
        // Without a featured filter the directory lists every place with datasets
        // plus the featured ones, the same set as the places sitemap.
        const normal = await read({ featured: null });
        expect(normal.map(row => row.id)).toEqual(['a', 'a_twin', 'b', 'c'].map(id));
        expect(counts(normal[2])).toEqual([3, 1, 1]);
        expect(normal.map(row => row.province_slug)).toEqual([null, null, null, null]);
    });

    test('keeps bilingual and alias search and includes a featured place without coverage', async () => {
        expect((await read({ q: id('historic') })).map(row => row.id)).toEqual([id('a')]);
        expect((await read({ q: 'Nord spécial' })).map(row => row.id)).toEqual([id('a_twin')]);
        const isolated = await read({ parent: null, q: id('isolated') });
        expect(isolated.map(row => row.id)).toEqual([id('isolated')]);
        expect(counts(isolated[0])).toEqual([0, 0, 0]);
        expect(await read({ kind: 'province' })).toEqual([]);
    });

    test('lists a place\'s publishers by the datasets that apply to it, as the general publisher query does', async () => {
        await db.query(`INSERT INTO organizations (id, name, title_en) VALUES ($1, $1, 'Works'), ($2, $2, 'Statistics')`,
            [id('works'), id('stats')]);
        await db.query('UPDATE datasets SET org_id = $1 WHERE id = ANY($2)', [id('works'), [id('direct'), id('inherited'), id('noninherited')]]);
        await db.query('UPDATE datasets SET org_id = $1 WHERE id = ANY($2)', [id('stats'), [id('countrywide'), id('sibling')]]);
        for (const name of ['direct', 'inherited', 'noninherited', 'countrywide', 'localcoverage', 'sibling']) {
            await db.query('INSERT INTO dataset_sources (source_id, external_id, dataset_id) VALUES ($1, $2, $2)', [id('source1'), id(name)]);
        }
        const publishers = args => queries.listOrganizations({ q: null, source: null, limit: 12, offset: 0, ...args }, db);
        const fast = await publishers({ place: id('a') });
        expect(fast.map(row => [row.name, row.dataset_count])).toEqual([[id('works'), 2], [id('stats'), 1]]);
        // Every dataset carries source1, so the general query (reached through a source filter) must agree.
        expect(await publishers({ place: id('a'), source: id('source1') })).toEqual(fast);
        expect((await publishers({ place: id('a'), q: 'statis' })).map(row => row.name)).toEqual([id('stats')]);
        expect(await publishers({ place: id('a'), limit: 1, offset: 1 })).toEqual(fast.slice(1));
        expect(await publishers({ place: id('missing') })).toEqual([]);
    });
});
