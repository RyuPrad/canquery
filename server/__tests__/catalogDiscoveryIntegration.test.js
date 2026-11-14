const { Pool } = require('pg');
const queries = require('../db/catalogReadQueries');
const blogContent = require('../services/blogContent');
const indexPolicy = require('../services/indexPolicy');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

integrationDescribe('complete catalogue discovery PostgreSQL integration', () => {
    let pool, db, datasetCount, resourceCount, ids;
    const prefix = 'discovery_test_' + process.pid;
    const id = name => prefix + '_' + name;
    const mine = rows => rows.filter(row => row.id.startsWith(prefix)).map(row => row.id);
    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        // dataset008 has no file at all; a guide is about it, so its page is indexable.
        jest.spyOn(blogContent, 'listArticles').mockReturnValue([{ datasetId: id('dataset008') }]);
        ids = indexPolicy.alwaysIndexableDatasetIds();
        datasetCount = await queries.countSitemapDatasets({ ids }, db);
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
        // The index policy's cases: a pinned prepared copy (5), a pin without a copy (6, a PDF), and a live
        // table that also has an unpinned copy (7). resource3 above is a prepared copy nobody pinned.
        await db.query(`INSERT INTO resources (id, dataset_id, format, url, datastore_active) VALUES
            ($1 || '5', $2 || '005', 'CSV', 'https://example.test/data', false),
            ($1 || '6', $2 || '006', 'PDF', 'https://example.test/report.pdf', false),
            ($1 || '7', $2 || '007', 'CSV', 'https://example.test/data', true)`, [id('resource'), id('dataset')]);
        await db.query(`INSERT INTO ingested_resources (resource_id, table_name, status) VALUES ($1, $2, 'ready'), ($3, $4, 'ready')`,
            [id('resource5'), id('table5'), id('resource7'), id('table7')]);
        await db.query('INSERT INTO pinned_resources (resource_id, reason) VALUES ($1, $3), ($2, $3)', [id('resource5'), id('resource6'), 'test']);
    });
    afterAll(async () => {
        jest.restoreAllMocks();
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });
    test('lists only the pages a search engine may index, and the JavaScript rule agrees file by file', async () => {
        // Datasets 002 (live table), 005 (pinned copy), 007 (live table) and 008 (a guide's dataset).
        expect(await queries.countSitemapDatasets({ ids }, db)).toBe(datasetCount + 4);
        // Without the guide's id, dataset008 has nothing to show.
        expect(await queries.countSitemapDatasets({}, db)).toBe(datasetCount + 3);
        expect(await queries.countSitemapResources(db)).toBe(resourceCount + 3);
        const datasets = mine(await queries.listDatasetSitemap({ limit: 25000, offset: 0, ids }, db));
        expect(datasets).toEqual(['002', '005', '007', '008'].map(n => id('dataset' + n)));
        const listed = await queries.listResourceSitemap({ limit: 25000, offset: 0 }, db);
        // The PDF, the CSV CanQuery could prepare, the unpinned copy, the map, the pin without a copy and the orphan stay out.
        expect(mine(listed)).toEqual([2, 5, 7].map(n => id('resource' + n)));
        expect(listed.find(row => row.id === id('resource2')).lastmod.toISOString()).toBe('2026-08-01T00:00:00.000Z');

        for (let n = 0; n <= 7; n++) {
            const row = await queries.getResourceById(id('resource' + n), db);
            expect([n, typeof row.pinned]).toEqual([n, 'boolean']);
            expect([n, indexPolicy.isIndexableResource(row)]).toEqual([n, mine(listed).includes(row.id)]);
        }
        for (const n of ['000', '001', '002', '003', '004', '005', '006', '007', '008', '050']) {
            const files = await queries.listResourcesForDataset(id('dataset' + n), db);
            expect([n, indexPolicy.isIndexableDataset({ id: id('dataset' + n) }, files)]).toEqual([n, datasets.includes(id('dataset' + n))]);
        }
    });
    test('lists every page the policy turned noindex: the complement of the indexable pages', async () => {
        const since = '2026-09-01T00:00:00Z';
        const noindexDatasets = await queries.listPolicyNoindexDatasets({ ids, since, limit: 200000 }, db);
        const indexable = mine(await queries.listDatasetSitemap({ limit: 25000, offset: 0, ids }, db));
        // 101 fixture datasets: each is in exactly one of the two lists.
        expect(mine(noindexDatasets)).toHaveLength(97);
        expect(mine(noindexDatasets).filter(row => indexable.includes(row))).toEqual([]);
        expect(new Set([...mine(noindexDatasets), ...indexable]).size).toBe(101);
        // Data-bearing files that are not indexable: the preparable CSV, the unpinned copy and the map.
        // Download-only files (the PDFs) have had their own list since they turned noindex.
        const noindexResources = await queries.listPolicyNoindexResources({ since, limit: 200000 }, db);
        expect(mine(noindexResources)).toEqual([1, 3, 4].map(n => id('resource' + n)));
        // A page is dated by the policy unless its own change is newer, and never in the future.
        const dated = async policyDate => (await queries.listPolicyNoindexDatasets({ ids, since: policyDate, limit: 200000 }, db))
            .find(row => row.id === id('dataset000')).lastmod;
        expect((await dated(since)).toISOString()).toBe('2026-09-01T00:00:00.000Z');
        expect((await dated('2026-07-01T00:00:00Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
        const ahead = await dated('2999-01-01T00:00:00Z');
        expect(ahead.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
        expect(ahead.getTime()).toBeGreaterThan(Date.now() - 10 * 60000);
        const resourceAhead = (await queries.listPolicyNoindexResources({ since: '2999-01-01T00:00:00Z', limit: 200000 }, db))
            .find(row => row.id === id('resource1')).lastmod;
        expect(resourceAhead.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
        expect((await queries.listPolicyNoindexDatasets({ ids, since, limit: 2 }, db))).toHaveLength(2);
    });
    test('counts the files of a dataset that share a name, format and language', async () => {
        // A savepoint keeps these rows out of the counts the later tests take.
        await db.query('SAVEPOINT yearly_files');
        try {
            await db.query(`INSERT INTO datasets (id, name, title_en) VALUES ($1, $1, 'Library statistics')`, [id('yearly')]);
            await db.query(`INSERT INTO resources (id, dataset_id, name_en, name_fr, format, language, url) VALUES
                ($1 || 'a', $2, 'Key ratios', NULL, 'XLSX', 'fr', 'https://example.test/key-ratios-fr-2023.xlsx'),
                ($1 || 'b', $2, ' key ratios ', NULL, 'xlsx', 'fr', 'https://example.test/key-ratios-fr-2024.xlsx'),
                ($1 || 'c', $2, '', 'Key ratios', 'XLSX', 'fr', 'https://example.test/key-ratios-fr-2025.xlsx'),
                ($1 || 'd', $2, 'Key ratios', NULL, 'XLSX', 'en', 'https://example.test/key-ratios-en-2023.xlsx'),
                ($1 || 'e', $2, 'General information', NULL, 'XLSX', 'fr', 'https://example.test/general-fr-2023.xlsx')`,
                [id('yearly-'), id('yearly')]);
            // Case, surrounding spaces and a missing English name (the French one counts) do not split a group.
            const listed = await queries.listResourcesForDataset(id('yearly'), db);
            expect(Object.fromEntries(listed.map(row => [row.id, row.same_name_siblings]))).toEqual({
                [id('yearly-a')]: 2, [id('yearly-b')]: 2, [id('yearly-c')]: 2, [id('yearly-d')]: 0, [id('yearly-e')]: 0 });
            expect((await queries.getResourceById(id('yearly-a'), db)).same_name_siblings).toBe(2);
            expect((await queries.getResourceById(id('yearly-e'), db)).same_name_siblings).toBe(0);
        } finally {
            await db.query('ROLLBACK TO SAVEPOINT yearly_files');
        }
    });
    test('lists the noindex pages Google still showed, by the latest four weeks of Search Console data', async () => {
        await db.query('SAVEPOINT noindex_pages');
        try {
            const page = name => 'https://canquery.com/resources/' + id(name);
            const datasetPage = name => 'https://canquery.com/datasets/' + id(name);
            await db.query(`INSERT INTO resources (id, dataset_id, format, url, last_modified) VALUES
                ($1, $4, 'PDF', 'https://example.test/stale.pdf', NULL),
                ($2, $4, 'PDF', 'https://example.test/blank.pdf', NULL),
                ($3, $4, 'PDF', 'https://example.test/newer.pdf', '2026-10-21T08:00:00Z')`,
                [id('stale'), id('blank'), id('newer'), id('dataset000')]);
            // Far-future import dates make these rows the latest data in the shared database. The window
            // holds the 28 days ending on the latest date, so 2099-03-03 falls just outside it.
            await db.query(`INSERT INTO search_console_breakdowns (data_date, search_type, dimension, value, clicks, impressions, ctr, position) VALUES
                ('2099-03-31', 'web', 'page', $1, 0, 5, 0, 4.2),
                ('2099-03-31', 'web', 'page', $2, 1, 9, 0.1, 3.0),
                ('2099-03-03', 'web', 'page', $3, 0, 2, 0, 9.0),
                ('2099-03-31', 'web', 'page', $4, 0, 0, 0, 0),
                ('2099-03-30', 'web', 'page', $5, 0, 1, 0, 6.0),
                ('2099-03-31', 'web', 'page', $6, 0, 3, 0, 8.0),
                ('2099-03-31', 'web', 'page', $7, 0, 4, 0, 5.0),
                ('2099-03-31', 'web', 'query', $8, 0, 7, 0, 2.0),
                ('2099-03-30', 'web', 'page', $9, 0, 4, 0, 5.0),
                ('2099-03-31', 'web', 'page', $10, 0, 6, 0, 7.0),
                ('2099-03-31', 'web', 'page', $11, 0, 6, 0, 7.0),
                ('2099-03-31', 'web', 'page', $12, 0, 6, 0, 7.0),
                ('2099-03-03', 'web', 'page', $13, 0, 6, 0, 7.0)`,
                [page('resource0'), page('resource1'), page('stale'), page('blank'), page('newer'), page('orphan'),
                    page('resource0') + '?view=table', id('resource0'), page('resource4') + '?view=map',
                    datasetPage('dataset000'), datasetPage('dataset001') + '?page=2', datasetPage('dataset002'), datasetPage('dataset003')]);
            const since = '2026-10-17T04:41:02Z';
            const list = async days => Object.fromEntries((await queries.listNoindexResourceSitemap(
                { pagePrefix: 'https://canquery.com/resources/', days, since, limit: 1000 }, db))
                .filter(row => row.id.startsWith(prefix)).map(row => [row.id, row.lastmod.toISOString()]));
            // Download-only pages. The preparable CSV belongs to the policy's list below, the stale page was last
            // shown outside the window, the blank one had no impressions, the orphan has no dataset, and a query
            // row names no page. An older file date gives way to the noindex date; a newer one stays.
            expect(await list(28)).toEqual({
                [id('resource0')]: '2026-10-17T04:41:02.000Z',
                [id('newer')]: '2026-10-21T08:00:00.000Z'
            });
            expect(await list(1)).toEqual({ [id('resource0')]: '2026-10-17T04:41:02.000Z' });
            // The pages the index policy turned noindex, dated by the policy: the preparable CSV, and the map,
            // which Google showed only at an address with a query string.
            // A date already past: one still ahead would date the pages by the time of the read.
            const policySince = '2026-11-01T00:00:00Z';
            const policy = Object.fromEntries((await queries.listNoindexResourceSitemap(
                { pagePrefix: 'https://canquery.com/resources/', days: 28, since: policySince, limit: 1000, scope: 'policy' }, db))
                .filter(row => row.id.startsWith(prefix)).map(row => [row.id, row.lastmod.toISOString()]));
            expect(policy).toEqual({ [id('resource1')]: '2026-11-01T00:00:00.000Z', [id('resource4')]: '2026-11-01T00:00:00.000Z' });
            // Dataset pages: by the name in the address, with or without a query string. The dataset with a live
            // table is indexable, and dataset003 was last shown outside the window.
            const shownDatasets = await queries.listShownNoindexDatasets(
                { ids, pagePrefix: 'https://canquery.com/datasets/', days: 28, since: policySince, limit: 1000 }, db);
            expect(Object.fromEntries(shownDatasets.filter(row => row.id.startsWith(prefix)).map(row => [row.id, row.lastmod.toISOString()])))
                .toEqual({ [id('dataset000')]: '2026-11-01T00:00:00.000Z', [id('dataset001')]: '2026-11-01T00:00:00.000Z' });
        } finally {
            await db.query('ROLLBACK TO SAVEPOINT noindex_pages');
        }
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
    test('reads the changed indexable dataset and resource pages in a window', async () => {
        const window = (since, until) => queries.listChangedSitemapPages({ since: new Date(since), until: new Date(until), limit: 1000, ids }, db);
        const changed = await window('2026-07-31T00:00:00Z', '2026-08-02T00:00:00Z');
        // All 101 fixture datasets changed in the window; only the indexable ones are sent to IndexNow.
        expect(mine(changed.datasets).sort()).toEqual(['002', '005', '007', '008'].map(n => id('dataset' + n)));
        expect(mine(changed.resources)).toEqual([2, 5, 7].map(n => id('resource' + n)));
        // The window's start is exclusive and its end inclusive.
        const later = await window('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');
        expect(mine(later.datasets)).toHaveLength(0);
        const ending = await window('2026-07-31T00:00:00Z', '2026-08-01T00:00:00Z');
        expect(mine(ending.datasets)).toHaveLength(4);
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
        check(await queries.listDatasetSitemapChunkLastmods({ pageSize: 2, ids }, db), await queries.listDatasetSitemap({ limit: 25000, offset: 0, ids }, db), 2);
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

integrationDescribe('federal provincial places PostgreSQL integration', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { normalizePackage } = require('../services/catalogNormalizer');
    const { loadFederalPlaceIds, writeFederalChunk } = require('../services/federalCatalogWrite');
    let pool, db;
    const prefix = 'federal_places_' + process.pid;
    const id = name => prefix + '_' + name;
    const token = 'wombatprovincefixture';
    const migration = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '047_federal_provincial_places.sql'), 'utf8');
    const search = async filters => (await queries.searchDatasets({ q: token, limit: 50, offset: 0, ...filters }, db)).map(row => row.id).sort();
    const placeRows = async () => (await db.query(`SELECT dataset_id, place_id, relationship, includes_descendants, assignment_method
        FROM dataset_places WHERE dataset_id LIKE $1 AND source_id = 'open-canada' ORDER BY dataset_id`, [prefix + '%'])).rows;
    const town = async () => (await queries.listPlaces({ q: id('town'), kind: null, parent: null, featured: null,
        limit: 10, offset: 0 }, db)).map(row => [row.id, row.dataset_count, row.direct_dataset_count]);

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        await db.query(`INSERT INTO catalog_sources (id, kind, name_en, homepage_url, upstream_host)
            VALUES ($1, 'ckan', $1, 'https://example.test', 'example.test')`, [id('src')]);
        await db.query(`INSERT INTO places (id, slug, kind, parent_id, name_en) VALUES ($1, $1, 'municipality', 'sgc-pr-48', $1)`, [id('town')]);
        // The listed publisher names are real CKAN names; the rest stay unlisted.
        await db.query(`INSERT INTO organizations (id, name, title_en) VALUES ($1, 'ab', 'Government of Alberta'),
            ($2, 'qc', 'Government and Municipalities of Québec'), ($3, $3, 'Federal department')`, [id('org_ab'), id('org_qc'), id('org_fed')]);
        // [key, organization, declared jurisdiction, source, direct place]
        for (const [key, org, jurisdiction, source, place] of [
            ['prov_ab', 'org_ab', 'provincial', 'open-canada', null],
            ['muni_qc', 'org_qc', 'municipal', 'open-canada', null],
            ['fed', 'org_fed', 'federal', 'open-canada', null],
            ['prov_unlisted', 'org_fed', 'provincial', 'open-canada', null],
            ['prov_elsewhere', 'org_ab', 'provincial', 'src', null],
            ['town_own', null, null, 'src', 'town']
        ]) {
            await db.query(`INSERT INTO datasets (id, name, title_en, org_id, jurisdiction) VALUES ($1, $1, $2, $3, $4)`,
                [id(key), token + ' ' + key, org && id(org), jurisdiction]);
            await db.query('INSERT INTO dataset_sources (source_id, external_id, dataset_id) VALUES ($1, $2, $2)',
                [source === 'src' ? id('src') : source, id(key)]);
            if (place) {
                await db.query(`INSERT INTO dataset_places (source_id, dataset_id, place_id, relationship, assignment_method)
                    VALUES ($1, $2, $3, 'direct', 'source')`, [id('src'), id(key), id(place)]);
            }
        }
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });

    test('the backfill places provincial government records in their province, directly, and their publishers there', async () => {
        const provincialBefore = await search({ level: ['provincial'] });
        const townBefore = await town();
        await db.query('SAVEPOINT backfill');
        try {
            await db.query(migration);
            await db.query(migration);
            expect(await placeRows()).toEqual([{ dataset_id: id('prov_ab'), place_id: 'sgc-pr-48', relationship: 'direct',
                includes_descendants: false, assignment_method: 'source' }]);
            const orgs = await db.query('SELECT id, place_id FROM organizations WHERE id LIKE $1 ORDER BY id', [prefix + '%']);
            expect(orgs.rows).toEqual([{ id: id('org_ab'), place_id: 'sgc-pr-48' }, { id: id('org_fed'), place_id: null },
                { id: id('org_qc'), place_id: 'sgc-pr-24' }]);
            // The province lists its record; the town inside it keeps only its own.
            expect(await search({ place: 'alberta' })).toEqual([id('prov_ab')]);
            expect(await search({ place: id('town') })).toEqual([id('town_own')]);
            expect(await town()).toEqual(townBefore);
            expect(townBefore).toEqual([[id('town'), 1, 1]]);
            // Levels still come from the declared jurisdiction.
            expect(await search({ level: ['provincial'] })).toEqual(provincialBefore);
        } finally {
            await db.query('ROLLBACK TO SAVEPOINT backfill');
        }
    });

    test('the federal sync writer replaces the place of every record it writes', async () => {
        await db.query('SAVEPOINT sync');
        try {
            const known = await loadFederalPlaceIds(db);
            expect(known.has('sgc-pr-48')).toBe(true);
            const write = async jurisdiction => {
                const n = normalizePackage({ id: id('synced'), name: id('synced'), title: token + ' synced', jurisdiction,
                    owner_org: id('org_ab'), organization: { id: id('org_ab'), name: 'ab', title: 'Government of Alberta | Gouvernement de l’Alberta' },
                    resources: [] });
                await writeFederalChunk(db, { organizations: [n.organization], datasets: [n.dataset], resources: n.resources, places: n.places }, known);
            };
            await write('provincial');
            expect((await placeRows()).map(row => [row.dataset_id, row.place_id])).toEqual([[id('synced'), 'sgc-pr-48']]);
            expect((await db.query('SELECT place_id FROM organizations WHERE id = $1', [id('org_ab')])).rows[0].place_id).toBe('sgc-pr-48');
            await write('federal');
            expect(await placeRows()).toEqual([]);
        } finally {
            await db.query('ROLLBACK TO SAVEPOINT sync');
        }
    });
});
