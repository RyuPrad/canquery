jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn(), getJobHealth: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
const request = require('supertest');
const catalogReadQueries = require('../db/catalogReadQueries');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

describe('ops API', () => {
    it('all fresh jobs report ok', async () => {
        const now = new Date();
        catalogReadQueries.getJobHealth.mockResolvedValue({
            syncRows: [
                { kind: 'full', last_ok_at: now.toISOString() },
                { kind: 'incremental', last_ok_at: now.toISOString() },
                { kind: 'query-log-prune', last_ok_at: now.toISOString() }
            ],
            evictLastOkAt: now.toISOString()
        });
        const res = await request(app).get('/api/v1/ops');
        expect(res.status).toBe(200);
        expect(res.body.data.ok).toBe(true);
        expect(res.body.data.jobs.full.status).toBe('ok');
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('a stale incremental flips the endpoint to 503', async () => {
        const now = new Date();
        catalogReadQueries.getJobHealth.mockResolvedValue({
            syncRows: [
                { kind: 'full', last_ok_at: now.toISOString() },
                { kind: 'incremental', last_ok_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() },
                { kind: 'query-log-prune', last_ok_at: now.toISOString() }
            ],
            evictLastOkAt: now.toISOString()
        });
        const res = await request(app).get('/api/v1/ops');
        expect(res.status).toBe(503);
        expect(res.body.data.ok).toBe(false);
        expect(res.body.data.jobs.incremental.status).toBe('stale');
        expect(res.body.data.jobs.full.status).toBe('ok');
    });

    it('never-ran jobs are pending, not stale', async () => {
        const now = new Date();
        catalogReadQueries.getJobHealth.mockResolvedValue({
            syncRows: [
                { kind: 'incremental', last_ok_at: now.toISOString() }
            ],
            evictLastOkAt: null
        });
        const res = await request(app).get('/api/v1/ops');
        expect(res.status).toBe(200);
        expect(res.body.data.jobs.full.status).toBe('pending');
        expect(res.body.data.jobs.evict.status).toBe('pending');
        expect(res.body.data.ok).toBe(true);
    });
});
