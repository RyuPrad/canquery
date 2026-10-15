const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { searchDatasets } = require('../db/catalogReadQueries');
const { readDatasetFacets } = require('../db/catalogFacetQueries');
const { shapeDatasetFacets } = require('../services/catalogFacets');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

// Every fixture title carries one search term, so counts cover only these
// records even when the database holds other data.
integrationDescribe('catalogue filters and facet counts PostgreSQL integration', () => {
    let pool, db;
    const prefix = 'facet_test_' + process.pid;
    const id = name => prefix + '_' + name;
    const token = 'quokkafacetfixture';
    const facets = async (filters = {}) => {
        const scoped = { q: token, lang: 'en', ...filters };
        return shapeDatasetFacets(await readDatasetFacets(scoped, db), scoped);
    };
    const list = async (filters = {}) => (await searchDatasets({ q: token, limit: 100, offset: 0, ...filters }, db)).map(row => row.id);
    const counts = items => Object.fromEntries(items.map(item => [item.value, item.count]));

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        await db.query(`INSERT INTO places (id, slug, kind, name_en, parent_id) VALUES
            ($1, $1, 'country', 'Fixture country', NULL), ($2, $2, 'territory', 'Fixture territory', $1),
            ($3, $3, 'region', 'Fixture region', $1), ($4, $4, 'municipality', 'Fixture town', $3)`,
        [id('country'), id('territory'), id('region'), id('town')]);
        await db.query(`INSERT INTO catalog_sources (id, kind, name_en, name_fr, homepage_url, upstream_host, enabled) VALUES
            ($1, 'ckan', 'Portal A', 'Portail A', 'https://a.example.test/', 'a.example.test', true),
            ($2, 'arcgis-hub', 'Portal B', NULL, 'https://b.example.test/', 'b.example.test', true)`, [id('src_a'), id('src_b')]);
        await db.query(`INSERT INTO organizations (id, name, title_en, title_fr) VALUES
            ($1, $1, 'Publisher A', 'Éditeur A'), ($2, $2, 'Publisher B', NULL)`, [id('org_a'), id('org_b')]);
        // [key, English title, French title, organization, declared jurisdiction, source, direct place, English keywords, French keywords, modified]
        const datasets = [
            ['fed1', `Alpha ${token} roads`, `Zulu ${token} routes`, 'org_a', 'federal', 'open-canada', null, ['roads', 'roads'], [], '2026-09-04'],
            ['fed2', null, `Bravo ${token} routes`, 'org_b', 'provincial', 'open-canada', null, [], ['routes'], '2026-09-03'],
            ['mun1', `Charlie ${token} parks`, null, 'org_a', null, 'src_a', 'town', ['parks'], [], '2026-09-02'],
            ['ter1', `Delta ${token} parcs`, null, 'org_b', null, 'src_b', 'territory', [], ['parcs'], '2026-09-01'],
            ['none', `Echo ${token} roads`, null, null, null, 'src_a', null, ['parks', 'roads'], [], null]
        ];
        for (const [key, titleEn, titleFr, org, jurisdiction, source, place, keywordsEn, keywordsFr, modified] of datasets) {
            await db.query(`INSERT INTO datasets (id, name, title_en, title_fr, org_id, jurisdiction, keywords_en, keywords_fr, metadata_modified)
                VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8)`,
            [id(key), titleEn, titleFr, org && id(org), jurisdiction, keywordsEn, keywordsFr, modified]);
            await db.query('INSERT INTO dataset_sources (source_id, external_id, dataset_id) VALUES ($1, $2, $2)',
                [source.startsWith('src') ? id(source) : source, id(key)]);
            if (place) {
                await db.query(`INSERT INTO dataset_places (source_id, dataset_id, place_id, relationship, assignment_method)
                    VALUES ($1, $2, $3, 'direct', 'source')`, [id(source), id(key), id(place)]);
            }
        }
        // [resource, dataset, format, live DataStore]
        for (const [resource, dataset, format, live] of [
            ['fed1_csv', 'fed1', 'CSV', true], ['fed1_pdf', 'fed1', 'PDF', false], ['fed2_xlsx', 'fed2', 'XLSX', false],
            ['mun1_csv', 'mun1', 'CSV', false], ['ter1_geojson', 'ter1', 'GEOJSON', false]]) {
            await db.query(`INSERT INTO resources (id, dataset_id, format, url, datastore_active)
                VALUES ($1, $2, $3, 'https://example.test/data', $4)`, [id(resource), id(dataset), format, live]);
        }
        await db.query(`INSERT INTO ingested_resources (resource_id, table_name, status) VALUES ($1, $2, 'ready')`, [id('mun1_csv'), id('table')]);
        for (const resource of ['fed2_xlsx', 'ter1_geojson']) {
            await db.query(`INSERT INTO resource_maps (resource_id, provider, service_url, geometry_type)
                VALUES ($1, 'arcgis', 'https://example.test/FeatureServer/0', 'polygon')`, [id(resource)]);
        }
    });

    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });

    test('counts every group, deriving levels from declarations and places', async () => {
        const { total, facets: groups } = await facets();
        expect(total).toBe(5);
        expect(await list()).toHaveLength(5);
        expect(groups.level).toEqual([{ value: 'federal', count: 1 }, { value: 'provincial', count: 2 }, { value: 'municipal', count: 1 }]);
        expect(groups.access).toEqual([{ value: 'queryable', count: 2 }, { value: 'mappable', count: 2 }]);
        expect(counts(groups.organization)).toEqual({ [id('org_a')]: 2, [id('org_b')]: 2 });
        expect(groups.organization.find(item => item.value === id('org_a')).label).toEqual({ en: 'Publisher A', fr: 'Éditeur A' });
        expect(counts(groups.source)).toEqual({ 'open-canada': 2, [id('src_a')]: 2, [id('src_b')]: 1 });
        expect(counts(groups.format)).toEqual({ CSV: 2, PDF: 1, XLSX: 1, GEOJSON: 1 });
        // Duplicates in one record count once; an empty English list falls back to French.
        expect(counts(groups.keyword)).toEqual({ roads: 2, parks: 2, routes: 1, parcs: 1 });
        expect(counts((await facets({ lang: 'fr' })).facets.keyword)).toEqual({ roads: 2, parks: 2, routes: 1, parcs: 1 });
    });

    test('each group is counted without its own filter, and totals match the paged list', async () => {
        const { total, facets: groups } = await facets({ org: [id('org_a')] });
        expect(total).toBe(2);
        expect((await list({ org: [id('org_a')] })).sort()).toEqual([id('fed1'), id('mun1')]);
        expect(counts(groups.organization)).toEqual({ [id('org_a')]: 2, [id('org_b')]: 2 });
        expect(counts(groups.format)).toEqual({ CSV: 2, PDF: 1 });
        expect(counts(groups.level)).toEqual({ federal: 1, municipal: 1 });
    });

    test('values in one group match any; different groups must all match', async () => {
        expect((await list({ format: ['CSV', 'XLSX'] })).sort()).toEqual([id('fed1'), id('fed2'), id('mun1')]);
        expect((await facets({ format: ['CSV', 'XLSX'] })).total).toBe(3);
        expect(await list({ format: ['CSV'], level: ['municipal'] })).toEqual([id('mun1')]);
        expect((await list({ level: ['provincial'] })).sort()).toEqual([id('fed2'), id('ter1')]);
        expect((await list({ source: [id('src_a'), id('src_b')] })).sort()).toEqual([id('mun1'), id('none'), id('ter1')]);
        expect(await list({ queryable: true, mappable: true })).toEqual([]);
        const both = await facets({ queryable: true, mappable: true });
        expect(both.total).toBe(0);
        expect(both.facets.access).toEqual([{ value: 'queryable', count: 0 }, { value: 'mappable', count: 0 }]);
        expect((await list({ queryable: true })).sort()).toEqual([id('fed1'), id('mun1')]);
    });

    test('a selected keyword matches either language and keeps its count', async () => {
        const { total, facets: groups } = await facets({ keyword: ['parcs'] });
        expect(total).toBe(1);
        expect(await list({ keyword: ['parcs'] })).toEqual([id('ter1')]);
        expect(groups.keyword.find(item => item.value === 'parcs')).toEqual({ value: 'parcs', count: 1 });
        const missing = await facets({ keyword: ['absent'], org: ['no-such-publisher'] });
        expect(missing.facets.keyword.find(item => item.value === 'absent')).toEqual({ value: 'absent', count: 0 });
        expect(missing.facets.organization.find(item => item.value === 'no-such-publisher')).toEqual({ value: 'no-such-publisher', label: { en: null, fr: null }, count: 0 });
    });

    test('title and update orders are total and follow the language', async () => {
        expect(await list({ sort: 'title' })).toEqual(['fed1', 'fed2', 'mun1', 'ter1', 'none'].map(id));
        expect(await list({ sort: 'title_desc' })).toEqual(['none', 'ter1', 'mun1', 'fed2', 'fed1'].map(id));
        expect(await list({ sort: 'title', lang: 'fr' })).toEqual(['fed2', 'mun1', 'ter1', 'none', 'fed1'].map(id));
        expect(await list({ sort: 'updated' })).toEqual(['fed1', 'fed2', 'mun1', 'ter1', 'none'].map(id));
        const first = await searchDatasets({ q: token, sort: 'title', limit: 2, offset: 0 }, db);
        const rest = await searchDatasets({ q: token, sort: 'title', limit: 10, offset: 2 }, db);
        expect([...first, ...rest].map(row => row.id)).toEqual(await list({ sort: 'title' }));
    });

    test('the backfill copies declared federal jurisdictions and the check rejects other values', async () => {
        await db.query('SAVEPOINT backfill');
        try {
            await db.query(`UPDATE datasets SET jurisdiction = NULL, raw = '{"jurisdiction": " Provincial "}' WHERE id = $1`, [id('fed1')]);
            await db.query(`UPDATE datasets SET raw = '{"jurisdiction": "federal"}' WHERE id = $1`, [id('mun1')]);
            await db.query(fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '040_dataset_jurisdiction_backfill.sql'), 'utf8'));
            const { rows } = await db.query('SELECT id, jurisdiction FROM datasets WHERE id = ANY($1) ORDER BY id', [[id('fed1'), id('mun1')]]);
            expect(rows).toEqual([{ id: id('fed1'), jurisdiction: 'provincial' }, { id: id('mun1'), jurisdiction: null }]);
            await expect(db.query("UPDATE datasets SET jurisdiction = 'regional' WHERE id = $1", [id('fed1')])).rejects.toMatchObject({ code: '23514' });
        } finally {
            await db.query('ROLLBACK TO SAVEPOINT backfill');
        }
    });
});
