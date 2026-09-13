jest.mock('../db/pool', () => ({ query: jest.fn() }));

const pool = require('../db/pool');
const queries = require('../db/catalogReadQueries');

beforeEach(() => jest.clearAllMocks());

describe('resource sitemap queries', () => {
    it('counts public resource pages with a parent dataset', async () => {
        pool.query.mockResolvedValue({ rows: [{ n: 13 }] });

        await expect(queries.countSitemapResources()).resolves.toBe(13);

        const sql = pool.query.mock.calls[0][0];
        expect(sql).toContain('FROM resources r');
        expect(sql).toContain('JOIN datasets d ON d.id = r.dataset_id');
        expect(sql).not.toMatch(/datastore_active|ingested_resources|resource_maps/);
    });

    it('lists each qualifying resource once with its parent dataset modification time', async () => {
        const rows = [{ id: 'r1', metadata_modified: '2026-08-27T00:00:00Z' }];
        pool.query.mockResolvedValue({ rows });

        await expect(queries.listResourceSitemap({ limit: 25000, offset: 50000 }))
            .resolves.toEqual(rows);

        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('JOIN datasets d ON d.id = r.dataset_id');
        expect(sql).toContain('ORDER BY r.id LIMIT $1 OFFSET $2');
        expect(sql).not.toMatch(/datastore_active|ingested_resources|resource_maps/);
        expect(params).toEqual([25000, 50000]);
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
});
