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
    // A count is cast only when it is a run of digits its type can hold, so no publisher value fails the read.
    expect(sql).toContain("WHEN coalesce(r.raw->>'record_count', '') ~ '^\\d{1,18}$' THEN (r.raw->>'record_count')::bigint <= $3::bigint");
    expect(sql).toContain("WHEN coalesce(r.raw->>'field_count', '') ~ '^\\d{1,9}$' THEN (r.raw->>'field_count')::int <= $4::int");
    expect(sql.match(/::bigint <= \$3::bigint/g)).toHaveLength(1);
    expect(sql.match(/::int <= \$4::int/g)).toHaveLength(1);
};

// The index policy in SQL (services/indexPolicy.js is its JavaScript twin): a
// live DataStore table, or a prepared copy that is ready and pinned.
const expectIndexableResource = sql => {
    expect(sql).toContain('FROM resources r');
    expect(sql).toContain('JOIN datasets d ON d.id = r.dataset_id');
    expect(sql).toContain('r.id IN (');
    expect(sql).toContain('SELECT tr.id FROM resources tr WHERE tr.datastore_active');
    expect(sql).toContain('JOIN pinned_resources tp ON tp.resource_id = ti.resource_id');
    expect(sql).toContain("WHERE ti.status = 'ready'");
};
const expectIndexableDataset = (sql, idsParam) => {
    expect(sql).toContain('d.id IN (');
    expect(sql).toContain('SELECT td.dataset_id FROM resources td WHERE td.id IN (');
    expect(sql).toContain('SELECT tr.id FROM resources tr WHERE tr.datastore_active');
    expect(sql).toContain('JOIN pinned_resources tp ON tp.resource_id = ti.resource_id');
    expect(sql).toContain('SELECT unnest(' + idsParam + '::text[])');
};
// The pinned copy that made a page indexable, read once for the statement.
const expectResourcePinDate = sql => {
    expect(sql).toContain('SELECT pc.resource_id, GREATEST(pc.created_at, pi.ingested_at) AS changed');
    expect(sql).toContain("JOIN ingested_resources pi ON pi.resource_id = pc.resource_id AND pi.status = 'ready'");
    expect(sql).toContain(') pin ON pin.resource_id = r.id');
};
const expectDatasetPinDate = sql => {
    expect(sql).toContain('SELECT pr.dataset_id, max(GREATEST(pc.created_at, pi.ingested_at)) AS changed');
    expect(sql).toContain("JOIN ingested_resources pi ON pi.resource_id = pc.resource_id AND pi.status = 'ready'");
    expect(sql).toContain(') pin ON pin.dataset_id = d.id');
};
const NOINDEX_LASTMOD = param => 'LEAST(GREATEST(COALESCE(r.last_modified, d.metadata_modified, ' + param + '::timestamptz), ' +
    param + '::timestamptz), now()) AS lastmod';

describe('resource sitemap queries', () => {
    it('counts and lists only the resource pages a search engine may index', async () => {
        pool.query.mockResolvedValue({ rows: [{ n: 13 }] });
        await expect(queries.countSitemapResources()).resolves.toBe(13);
        const [countSql, countParams] = pool.query.mock.calls[0];
        expectIndexableResource(countSql);
        // Files CanQuery could prepare, and maps, are no longer listed.
        expect(countSql).not.toContain('resource_maps');
        expect(countSql).not.toContain("r.format IN ('CSV', 'XLSX', 'XLS')");
        expect(countParams).toBeUndefined();

        const rows = [{ id: 'r1', lastmod: '2026-08-27T00:00:00Z' }];
        pool.query.mockResolvedValue({ rows });
        await expect(queries.listResourceSitemap({ limit: 25000, offset: 50000 })).resolves.toEqual(rows);
        const [sql, params] = pool.query.mock.calls[1];
        expectIndexableResource(sql);
        // Dated by its own change, or by the pinned copy that made the page indexable when that is newer.
        expectResourcePinDate(sql);
        expect(sql).toContain('LEAST(GREATEST(COALESCE(r.last_modified, d.metadata_modified), pin.changed), now()) AS lastmod');
        expect(sql).toContain('ORDER BY r.id LIMIT $1 OFFSET $2');
        expect(params).toEqual([25000, 50000]);
    });

    it('counts and lists only the dataset pages a search engine may index, with the guide and hub ids', async () => {
        pool.query.mockResolvedValue({ rows: [{ n: 7 }] });
        await expect(queries.countSitemapDatasets({ ids: ['d9'] })).resolves.toBe(7);
        const [countSql, countParams] = pool.query.mock.calls[0];
        expectIndexableDataset(countSql, '$1');
        expect(countParams).toEqual([['d9']]);
        await queries.countSitemapDatasets();
        expect(pool.query.mock.calls[1][1]).toEqual([[]]);

        const rows = [{ id: 'd1', name: 'roads', metadata_modified: '2026-08-27T00:00:00Z' }];
        pool.query.mockResolvedValue({ rows });
        await expect(queries.listDatasetSitemap({ limit: 25000, offset: 0, ids: ['d9'] })).resolves.toEqual(rows);
        const [sql, params] = pool.query.mock.calls[2];
        expectIndexableDataset(sql, '$3');
        expectDatasetPinDate(sql);
        expect(sql).toContain('GREATEST(d.metadata_modified, pin.changed) AS lastmod');
        expect(sql).toContain('ORDER BY d.id LIMIT $1 OFFSET $2');
        expect(params).toEqual([25000, 0, ['d9']]);
    });

    it('dates each sitemap chunk by the newest entry it holds, numbered in id order', async () => {
        pool.query.mockResolvedValue({ rows: [{ chunk: 1, lastmod: '2026-08-27T00:00:00Z' }] });
        await expect(queries.listResourceSitemapChunkLastmods(25000)).resolves.toEqual([{ chunk: 1, lastmod: '2026-08-27T00:00:00Z' }]);
        const [sql, params] = pool.query.mock.calls[0];
        expectIndexableResource(sql);
        expect(sql).toContain('(row_number() OVER (ORDER BY r.id) - 1) / $1 + 1 AS chunk');
        // A chunk is dated like its entries.
        expectResourcePinDate(sql);
        expect(sql).toContain('LEAST(GREATEST(COALESCE(r.last_modified, d.metadata_modified), pin.changed), now()) AS lastmod');
        expect(params).toEqual([25000]);

        await queries.listDatasetSitemapChunkLastmods({ pageSize: 25000, ids: ['d9'] });
        const [datasetSql, datasetParams] = pool.query.mock.calls[1];
        expect(datasetSql).toContain('(row_number() OVER (ORDER BY d.id) - 1) / $1 + 1 AS chunk');
        expect(datasetSql).toContain('max(lastmod) AS lastmod');
        expectDatasetPinDate(datasetSql);
        expect(datasetSql).toContain('GREATEST(d.metadata_modified, pin.changed) AS lastmod');
        // The chunks are numbered over the same pages the chunk files list.
        expectIndexableDataset(datasetSql, '$2');
        expect(datasetParams).toEqual([25000, ['d9']]);
    });

    it('reads the indexable pages whose sitemap entry changed in a window, for IndexNow', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'roads' }] }).mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
        const since = new Date('2026-10-24T07:45:00Z');
        const until = new Date('2026-10-26T07:45:00Z');
        await expect(queries.listChangedSitemapPages({ since, until, limit: 50001, ids: ['d9'] }))
            .resolves.toEqual({ datasets: [{ id: 'd1', name: 'roads' }], resources: [{ id: 'r1' }] });
        const [datasetSql, datasetParams] = pool.query.mock.calls[0];
        // The window is over the date the sitemap entry carries, so a page a new pin made indexable is sent.
        expectDatasetPinDate(datasetSql);
        expect(datasetSql).toContain('GREATEST(d.metadata_modified, pin.changed) > $1 AND GREATEST(d.metadata_modified, pin.changed) <= $2');
        expectIndexableDataset(datasetSql, '$4');
        expect(datasetParams).toEqual([since, until, 50001, ['d9']]);
        const [resourceSql, resourceParams] = pool.query.mock.calls[1];
        expectIndexableResource(resourceSql);
        expectResourcePinDate(resourceSql);
        expect(resourceSql).toContain('LEAST(GREATEST(COALESCE(r.last_modified, d.metadata_modified), pin.changed), now()) > $1');
        expect(resourceParams).toEqual([since, until, 50001]);
    });

    it('reads every dataset page and every data-bearing file page changed in a window, for engines the policy does not speak to', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: 'd1', name: 'roads' }] }).mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
        const since = new Date('2026-10-24T07:45:00Z');
        const until = new Date('2026-10-26T07:45:00Z');
        await expect(queries.listChangedCataloguePages({ since, until, limit: 50001 }))
            .resolves.toEqual({ datasets: [{ id: 'd1', name: 'roads' }], resources: [{ id: 'r1' }] });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const [datasetSql, datasetParams] = pool.query.mock.calls[0];
        // Every dataset page, by its record's change: no table is asked for and no pin is read.
        expect(datasetSql).toContain('WHERE d.metadata_modified > $1 AND d.metadata_modified <= $2');
        expect(datasetSql).toContain('ORDER BY d.metadata_modified, d.id LIMIT $3');
        expect(datasetSql).not.toContain('pinned_resources');
        expect(datasetSql).not.toContain('datastore_active');
        expect(datasetParams).toEqual([since, until, 50001]);
        const [resourceSql, resourceParams] = pool.query.mock.calls[1];
        // A file page that carries data; a download-only page is noindex for every engine and is never sent.
        expectDataBearing(resourceSql);
        expect(resourceSql).not.toContain('pinned_resources');
        expect(resourceSql).toContain('LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) > $5');
        expect(resourceSql).toContain('LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) <= $6');
        expect(resourceSql).toContain('ORDER BY r.id LIMIT $7');
        expect(resourceParams).toEqual([...caps(), since, until, 50001]);
    });

    it('lists every page the index policy turned noindex, dated by the policy and never in the future', async () => {
        pool.query.mockResolvedValue({ rows: [{ id: 'd1', name: 'roads', lastmod: '2026-11-16T07:59:59Z' }] });
        await queries.listPolicyNoindexDatasets({ ids: ['d9'], since: '2026-11-16T07:59:59Z', limit: 200000 });
        const [datasetSql, datasetParams] = pool.query.mock.calls[0];
        // The complement of the indexable rule, so the two lists never share a page.
        expectIndexableDataset(datasetSql, '$1');
        expect(datasetSql).toMatch(/WHERE \(d\.id IN \([\s\S]*\)\) IS NOT TRUE/);
        // The clamp to now comes last: a policy date still ahead dates the page by the build time.
        expect(datasetSql).toContain('LEAST(GREATEST(COALESCE(d.metadata_modified, $2::timestamptz), $2::timestamptz), now()) AS lastmod');
        expect(datasetSql).toContain('ORDER BY d.id LIMIT $3');
        expect(datasetParams).toEqual([['d9'], '2026-11-16T07:59:59Z', 200000]);

        await queries.listPolicyNoindexResources({ since: '2026-11-16T07:59:59Z', limit: 200000 });
        const [sql, params] = pool.query.mock.calls[1];
        // Data-bearing pages that are not indexable: download-only pages have their own list.
        expectDataBearing(sql);
        expectIndexableResource(sql);
        expect(sql).toMatch(/\)\)\) AND \(r\.id IN \([\s\S]*\)\) IS NOT TRUE/);
        expect(sql).toContain(NOINDEX_LASTMOD('$5'));
        expect(sql).toContain('ORDER BY r.id LIMIT $6');
        expect(params).toEqual([...caps(), '2026-11-16T07:59:59Z', 200000]);
    });

    it('lists the noindex resource pages Google showed in the recent Search Console data, by scope', async () => {
        const rows = [{ id: 'r1', lastmod: '2026-10-17T04:41:02Z' }];
        pool.query.mockResolvedValue({ rows });
        const args = { pagePrefix: 'https://canquery.com/resources/', days: 28, since: '2026-10-17T04:41:02Z', limit: 50000 };
        await expect(queries.listNoindexResourceSitemap(args)).resolves.toEqual(rows);
        const [sql, params] = pool.query.mock.calls[0];
        // Download-only: the complement of the data-bearing predicate, so a NULL flag counts.
        expectDataBearing(sql);
        expect(sql).toMatch(/WHERE \(r\.datastore_active[\s\S]*\) IS NOT TRUE/);
        expect(sql).not.toContain('pinned_resources');
        // Only the page-dates view: the API role cannot read the Search Console tables.
        expect(sql).toContain('SELECT max(data_date) AS data_date FROM search_console_page_dates');
        expect(sql).toContain('s.data_date > latest.data_date - $6::int AND starts_with(s.page, $5)');
        expect(sql).not.toContain('search_console_breakdowns');
        // A page address with a query string is still the page.
        expect(sql).toContain("split_part(substr(s.page, length($5) + 1), '?', 1) AS slug");
        expect(sql).toContain('JOIN shown ON shown.slug = r.id');
        expect(sql).toContain(NOINDEX_LASTMOD('$7'));
        expect(sql).toContain('ORDER BY r.id LIMIT $8');
        expect(params).toEqual([...caps(), 'https://canquery.com/resources/', 28, '2026-10-17T04:41:02Z', 50000]);

        // The pages the index policy turned noindex: data-bearing, not indexable.
        await queries.listNoindexResourceSitemap({ ...args, since: '2026-11-16T07:59:59Z', scope: 'policy' });
        const [policySql, policyParams] = pool.query.mock.calls[1];
        expectIndexableResource(policySql);
        expect(policySql).toMatch(/\)\)\) AND \(r\.id IN \([\s\S]*\)\) IS NOT TRUE/);
        expect(policyParams).toEqual([...caps(), 'https://canquery.com/resources/', 28, '2026-11-16T07:59:59Z', 50000]);
        await expect(queries.listNoindexResourceSitemap({ ...args, scope: 'anything' })).rejects.toThrow('Unknown noindex scope');
        expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('lists the noindex dataset pages Google showed, by the name or id in their address', async () => {
        pool.query.mockResolvedValue({ rows: [{ id: 'd1', name: 'roads', lastmod: '2026-11-16T07:59:59Z' }] });
        await queries.listShownNoindexDatasets({ ids: ['d9'], pagePrefix: 'https://canquery.com/datasets/', days: 28,
            since: '2026-11-16T07:59:59Z', limit: 50000 });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('SELECT max(data_date) AS data_date FROM search_console_page_dates');
        expect(sql).not.toContain('search_console_breakdowns');
        expect(sql).toContain("split_part(substr(s.page, length($2) + 1), '?', 1) AS slug");
        expect(sql).toContain('d.name IN (SELECT slug FROM shown) OR d.id IN (SELECT slug FROM shown)');
        expectIndexableDataset(sql, '$1');
        expect(sql).toMatch(/AND \(d\.id IN \([\s\S]*\)\) IS NOT TRUE/);
        expect(sql).toContain('LEAST(GREATEST(COALESCE(d.metadata_modified, $4::timestamptz), $4::timestamptz), now()) AS lastmod');
        expect(params).toEqual([['d9'], 'https://canquery.com/datasets/', 28, '2026-11-16T07:59:59Z', 50000]);
    });

    it('reads whether a prepared copy is pinned for the pages, and never in the read the workers share', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const pinned = 'EXISTS (SELECT 1 FROM pinned_resources pin WHERE pin.resource_id = r.id) AS pinned';
        await queries.listResourcesForDataset('d1');
        expect(pool.query.mock.calls[0][0]).toContain(pinned);
        await queries.getResourceById('r1', pool, { pinned: true });
        expect(pool.query.mock.calls[1][0]).toContain(pinned);
        // The map worker reads resources through this function and its role cannot read pins.
        await queries.getResourceById('r1', pool);
        await queries.getResourceById('r1', pool, {});
        for (const [sql] of pool.query.mock.calls.slice(2)) expect(sql).not.toContain('pinned_resources');
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
