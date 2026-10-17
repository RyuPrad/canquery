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
});
