jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const queryLog = require('../db/queryLogQueries');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

function popularRow() {
    return { resource_id: 'r1', hits: '12', last_queried_at: '2026-06-12T00:00:00Z', name_en: 'A', name_fr: null, format: 'CSV', dataset_id: 'd1', dataset_name: 'd1', dataset_title_en: 'DS', dataset_title_fr: null };
}

describe('popular resources API', () => {
    it('returns shaped items with numeric hits', async () => {
        queryLog.listPopularResources.mockResolvedValue([popularRow()]);
        const res = await request(app).get('/api/v1/resources/popular');
        expect(res.status).toBe(200);
        expect(res.body.data[0]).toEqual({
            resource_id: 'r1',
            hits: 12,
            last_queried_at: '2026-06-12T00:00:00Z',
            name: { en: 'A', fr: null },
            format: 'CSV',
            dataset: { id: 'd1', name: 'd1', title: { en: 'DS', fr: null } }
        });
        // route order proof: /popular must not be swallowed by /:id
        expect(queries.getResourceById).not.toHaveBeenCalled();
    });

    it('defaults to days=7 limit=6 and caches for 5 minutes', async () => {
        queryLog.listPopularResources.mockResolvedValue([]);
        const res = await request(app).get('/api/v1/resources/popular');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        expect(queryLog.listPopularResources).toHaveBeenCalledWith({ days: 7, limit: 6 });
    });

    it('clamps days to 30 and limit to 20', async () => {
        queryLog.listPopularResources.mockResolvedValue([]);
        const res = await request(app).get('/api/v1/resources/popular?days=999&limit=999');
        expect(res.status).toBe(200);
        expect(queryLog.listPopularResources).toHaveBeenCalledWith({ days: 30, limit: 20 });
    });

    it('garbage days is a 400', async () => {
        const res = await request(app).get('/api/v1/resources/popular?days=abc');
        expect(res.status).toBe(400);
        expect(queryLog.listPopularResources).not.toHaveBeenCalled();
    });
});
