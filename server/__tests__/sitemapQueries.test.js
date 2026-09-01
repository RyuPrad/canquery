jest.mock('../db/pool', () => ({ query: jest.fn() }));

const pool = require('../db/pool');
const queries = require('../db/catalogReadQueries');

beforeEach(() => jest.clearAllMocks());

describe('resource sitemap queries', () => {
    it('counts only resources with a live table, local table, or map capability', async () => {
        pool.query.mockResolvedValue({ rows: [{ n: 13 }] });

        await expect(queries.countSitemapResources()).resolves.toBe(13);

        const sql = pool.query.mock.calls[0][0];
        expect(sql).toContain('FROM resources r');
        expect(sql).toContain('r.datastore_active');
        expect(sql).toContain("ir.status = 'ready'");
        expect(sql).toContain('resource_maps');
    });

    it('lists each qualifying resource once with its parent dataset modification time', async () => {
        const rows = [{ id: 'r1', metadata_modified: '2026-08-27T00:00:00Z' }];
        pool.query.mockResolvedValue({ rows });

        await expect(queries.listResourceSitemap({ limit: 25000, offset: 50000 }))
            .resolves.toEqual(rows);

        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('WITH eligible_resources AS MATERIALIZED');
        expect(sql).toContain('JOIN datasets d ON d.id = eligible.dataset_id');
        expect(sql).toContain('ORDER BY eligible.id LIMIT $1 OFFSET $2');
        expect(sql).toContain('EXISTS (SELECT 1 FROM ingested_resources');
        expect(sql).toContain('EXISTS (SELECT 1 FROM resource_maps');
        expect(params).toEqual([25000, 50000]);
    });
});
