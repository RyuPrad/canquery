jest.mock('../db/pool', () => ({ query: jest.fn() }));

const pool = require('../db/pool');
const queries = require('../db/catalogReadQueries');
const { ingestLimits } = require('../config/ingest');

beforeEach(() => jest.clearAllMocks());

const caps = () => {
    const limits = ingestLimits();
    return [limits.maxFileBytes, limits.maxXlsxBytes, limits.maxRows, limits.maxCols];
};

const expectDataBearing = sql => {
    expect(sql).toContain('FROM resources r');
    expect(sql).toContain('JOIN datasets d ON d.id = r.dataset_id');
    expect(sql).toContain('r.datastore_active');
    expect(sql).toContain("ir.resource_id = r.id AND ir.status = 'ready'");
    expect(sql).toContain('FROM resource_maps rm WHERE rm.resource_id = r.id');
    expect(sql).toContain("r.format IN ('CSV', 'XLSX', 'XLS')");
    expect(sql).toContain("split_part(coalesce(r.url, ''), '?', 1) ~* '\\.zip$'");
    expect(sql).toContain("CASE WHEN r.format = 'CSV' THEN $1::bigint ELSE $2::bigint END");
    expect(sql).toContain("(r.raw->>'record_count')::bigint <= $3::bigint");
    expect(sql).toContain("(r.raw->>'field_count')::int <= $4::int");
};

describe('resource sitemap queries', () => {
    it('counts the data-bearing resource pages with a parent dataset, sharing the loader caps', async () => {
        pool.query.mockResolvedValue({ rows: [{ n: 13 }] });

        await expect(queries.countSitemapResources()).resolves.toBe(13);

        const [sql, params] = pool.query.mock.calls[0];
        expectDataBearing(sql);
        expect(params).toEqual(caps());
    });

    it('lists each qualifying resource once with its own or its dataset change date, never in the future', async () => {
        const rows = [{ id: 'r1', lastmod: '2026-08-27T00:00:00Z' }];
        pool.query.mockResolvedValue({ rows });

        await expect(queries.listResourceSitemap({ limit: 25000, offset: 50000 }))
            .resolves.toEqual(rows);

        const [sql, params] = pool.query.mock.calls[0];
        expectDataBearing(sql);
        expect(sql).toContain('LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) AS lastmod');
        expect(sql).toContain('ORDER BY r.id LIMIT $5 OFFSET $6');
        expect(params).toEqual([...caps(), 25000, 50000]);
    });

    it('dates each sitemap chunk by the newest entry it holds, numbered in id order', async () => {
        pool.query.mockResolvedValue({ rows: [{ chunk: 1, lastmod: '2026-08-27T00:00:00Z' }] });
        await expect(queries.listResourceSitemapChunkLastmods(25000)).resolves.toEqual([{ chunk: 1, lastmod: '2026-08-27T00:00:00Z' }]);
        const [sql, params] = pool.query.mock.calls[0];
        expectDataBearing(sql);
        expect(sql).toContain('(row_number() OVER (ORDER BY r.id) - 1) / $5 + 1 AS chunk');
        expect(sql).toContain('LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) AS lastmod');
        expect(params).toEqual([...caps(), 25000]);

        await queries.listDatasetSitemapChunkLastmods(25000);
        const [datasetSql, datasetParams] = pool.query.mock.calls[1];
        expect(datasetSql).toContain('(row_number() OVER (ORDER BY d.id) - 1) / $1 + 1 AS chunk');
        expect(datasetSql).toContain('max(lastmod) AS lastmod');
        expect(datasetParams).toEqual([25000]);
    });

    it('reads the pages whose sitemap entry changed in a window, for IndexNow', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'roads' }] }).mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
        const since = new Date('2026-10-24T07:45:00Z');
        const until = new Date('2026-10-26T07:45:00Z');
        await expect(queries.listChangedSitemapPages({ since, until, limit: 50001 }))
            .resolves.toEqual({ datasets: [{ id: 'd1', name: 'roads' }], resources: [{ id: 'r1' }] });
        const [datasetSql, datasetParams] = pool.query.mock.calls[0];
        expect(datasetSql).toContain('d.metadata_modified > $1 AND d.metadata_modified <= $2');
        expect(datasetParams).toEqual([since, until, 50001]);
        const [resourceSql, resourceParams] = pool.query.mock.calls[1];
        expectDataBearing(resourceSql);
        expect(resourceSql).toContain('LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) > $5');
        expect(resourceParams).toEqual([...caps(), since, until, 50001]);
    });

    it('lists the download-only pages Google showed in the recent Search Console data, dated no earlier than their noindex', async () => {
        const rows = [{ id: 'r1', lastmod: '2026-10-17T04:41:02Z' }];
        pool.query.mockResolvedValue({ rows });
        const args = { pagePrefix: 'https://canquery.com/resources/', days: 28, since: '2026-10-17T04:41:02Z', limit: 50000 };
        await expect(queries.listNoindexResourceSitemap(args)).resolves.toEqual(rows);
        const [sql, params] = pool.query.mock.calls[0];
        // The complement of the data-bearing predicate, so a NULL flag counts as download-only.
        expectDataBearing(sql);
        expect(sql).toMatch(/WHERE \(r\.datastore_active[\s\S]*\) IS NOT TRUE/);
        // Only the page-dates view: the API role cannot read the Search Console tables.
        expect(sql).toContain('SELECT max(data_date) AS data_date FROM search_console_page_dates');
        expect(sql).toContain('s.data_date > latest.data_date - $6::int AND starts_with(s.page, $5)');
        expect(sql).not.toContain('search_console_breakdowns');
        expect(sql).toContain('JOIN shown ON shown.id = r.id');
        expect(sql).toContain('GREATEST(LEAST(COALESCE(r.last_modified, d.metadata_modified, $7::timestamptz), now()), $7::timestamptz) AS lastmod');
        expect(sql).toContain('ORDER BY r.id LIMIT $8');
        expect(params).toEqual([...caps(), 'https://canquery.com/resources/', 28, '2026-10-17T04:41:02Z', 50000]);
    });

    it('reads the newest catalogue change for sitemap dates', async () => {
        pool.query.mockResolvedValue({ rows: [{ modified: '2026-10-01T00:00:00Z' }] });
        await expect(queries.getCatalogLastModified()).resolves.toBe('2026-10-01T00:00:00Z');
        expect(pool.query.mock.calls[0][0]).toContain('max(metadata_modified)');
        pool.query.mockResolvedValue({ rows: [{ modified: null }] });
        await expect(queries.getCatalogLastModified()).resolves.toBeNull();
    });

    it('reads the Top 100 as links with the canonical dataset slug', async () => {
        const rows = [{ rank: 1, dataset_id: 'd1', dataset_name: 'roads', title_en: 'Roads', title_fr: null, downloads: 10 }];
        pool.query.mockResolvedValue({ rows });
        await expect(queries.listTopDownloadLinks()).resolves.toEqual(rows);
        const sql = pool.query.mock.calls[0][0];
        expect(sql).toContain('FROM top_downloads t');
        expect(sql).toContain('LEFT JOIN datasets d ON d.id = t.dataset_id');
        expect(sql).toContain('ORDER BY t.rank ASC');
        expect(sql).toContain('LIMIT 100');
    });
});

describe('organization sitemap queries', () => {
    it('lists organizations with datasets and their latest modification time', async () => {
        const rows = [{ name: 'city-works', metadata_modified: '2026-08-30T00:00:00Z' }];
        pool.query.mockResolvedValue({ rows });

        await expect(queries.listOrganizationSitemap()).resolves.toEqual(rows);

        const sql = pool.query.mock.calls[0][0];
        expect(sql).toContain('JOIN datasets d ON d.org_id = o.id');
        expect(sql).toContain('HAVING count(d.id) > 0');
        expect(sql).toContain('max(d.metadata_modified)');
    });

    it('lists only publishers with datasets in the directory and reads a place with its enabled flag', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        await queries.listOrganizations({ q: null, source: null, place: null, limit: 50, offset: 0 });
        expect(pool.query.mock.calls[0][0]).toContain('WHERE EXISTS (SELECT 1 FROM datasets d_any WHERE d_any.org_id = o.id)');
        pool.query.mockResolvedValue({ rows: [{ id: 'p1', enabled: false }] });
        await queries.getPlaceByIdOrSlug('old-on');
        expect(pool.query.mock.calls[1][0]).toContain('p.featured, p.enabled');
    });

    it('groups a place\'s own datasets by publisher when no source filter applies', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        await queries.listOrganizations({ q: null, source: null, place: 'calgary-ab', limit: 12, offset: 0 });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('place_datasets AS (');
        expect(sql).toContain('FROM counts c');
        expect(params).toEqual(['calgary-ab', 12, 0, null]);
        await queries.listOrganizations({ q: null, source: 'calgary-open-data', place: 'calgary-ab', limit: 12, offset: 0 });
        expect(pool.query.mock.calls[1][0]).toContain('WHERE EXISTS (SELECT 1 FROM datasets d_any WHERE d_any.org_id = o.id)');
    });
});

describe('place directory queries', () => {
    const catalogReadCache = require('../services/catalogReadCache');
    beforeEach(() => {
        pool.query.mockReset();
        catalogReadCache.clear();
    });

    it('lists every place with open data, carries its province and orders by it, with an optional ancestor scope', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        await queries.listPlaces({ q: null, kind: null, parent: null, featured: null, limit: 51, offset: 0 });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('province.slug AS province_slug, province.name_en AS province_name_en, province.name_fr AS province_name_fr');
        expect(sql).toContain("WHEN p.kind IN ('province', 'territory') THEN p.id");
        expect(sql).toContain("WHEN grand_place.kind IN ('province', 'territory') THEN grand_place.id");
        expect(sql).toContain('ORDER BY province.name_en NULLS FIRST');
        expect(sql).toContain('ORDER BY p.province_name_en NULLS FIRST');
        expect(sql).toContain('$4::boolean IS TRUE OR p.featured OR EXISTS');
        expect(sql).toContain('p.id IN (SELECT id FROM within_places)');
        expect(params).toEqual([null, null, null, null, 51, 0, null]);
        await queries.listPlaces({ q: null, kind: null, parent: null, featured: null, within: 'ontario', limit: 100, offset: 0 });
        expect(pool.query.mock.calls[1][1]).toEqual([null, null, null, null, 100, 0, 'ontario']);
    });

    it('lists the places inside a province, a region’s municipalities, and none for a municipality', async () => {
        const detail = kind => [{ rows: [{ id: 'p', slug: 'p', kind, parent_id: 'parent' }] }, { rows: [] },
            { rows: [{ dataset_count: 3, direct_dataset_count: 1, mappable_dataset_count: 2, last_modified: '2026-10-01T00:00:00Z' }] }, { rows: [] }];
        for (const row of detail('province')) pool.query.mockResolvedValueOnce(row);
        const province = await queries.getPlaceByIdOrSlug('ontario');
        expect(province.last_modified).toBe('2026-10-01T00:00:00Z');
        expect(pool.query.mock.calls[2][0]).toContain('AS last_modified');
        expect(pool.query.mock.calls[3][1]).toEqual([null, null, null, null, 100, 0, 'p']);
        pool.query.mockClear();
        catalogReadCache.clear();
        for (const row of detail('region')) pool.query.mockResolvedValueOnce(row);
        await queries.getPlaceByIdOrSlug('durham-on');
        expect(pool.query.mock.calls[3][1]).toEqual([null, 'municipality', 'p', null, 100, 0, null]);
        pool.query.mockReset();
        for (const row of detail('municipality').slice(0, 3)) pool.query.mockResolvedValueOnce(row);
        const city = await queries.getPlaceByIdOrSlug('oshawa-on');
        expect(city.children).toEqual([]);
        expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('caches the source portals of a place like the other directory reads', async () => {
        pool.query.mockResolvedValue({ rows: [{ id: 'oshawa-hub' }] });
        await expect(queries.listSources({ place: 'oshawa-on' })).resolves.toEqual([{ id: 'oshawa-hub' }]);
        await queries.listSources({ place: 'oshawa-on' });
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][1]).toEqual(['oshawa-on']);
    });
});
