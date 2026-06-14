jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), profileStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const storeQueries = require('../db/storeQueries');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

function ingestedRow(id) {
    return { id: id || 'ing-1', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: 'ready', table_name: 'r_abc123', ingested_at: '2026-06-14T00:00:00Z', ingested_columns: [{ id: 'province', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }] };
}

describe('profile API', () => {
    it('returns row_count + per-column profile for an ingested resource', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        storeQueries.profileStoreTable.mockResolvedValue({
            rowCount: 1000,
            columns: [
                { id: 'province', type: 'TEXT', distinct: 13, nulls: 0 },
                { id: 'amount', type: 'NUMERIC', distinct: 940, nulls: 2, min: 0, max: 99, avg: 42 },
            ],
        });
        const res = await request(app).get('/api/v1/resources/ing-1/profile');
        expect(res.status).toBe(200);
        expect(res.body.data.row_count).toBe(1000);
        expect(res.body.data.columns).toHaveLength(2);
        expect(res.body.data.columns[0]).toEqual({ id: 'province', type: 'TEXT', distinct: 13, nulls: 0 });
        expect(res.body.meta.query_mode).toBe('ingested');
        expect(storeQueries.profileStoreTable).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'r_abc123' }));
    });

    it('caches by table + ingested_at (second hit does not re-query)', async () => {
        // Distinct table_name so this test owns its own (process-local) cache key.
        queries.getResourceById.mockResolvedValue(Object.assign(ingestedRow('ing-cache'), { table_name: 'r_cache01' }));
        storeQueries.profileStoreTable.mockResolvedValue({ rowCount: 5, columns: [] });
        await request(app).get('/api/v1/resources/ing-cache/profile');
        await request(app).get('/api/v1/resources/ing-cache/profile');
        expect(storeQueries.profileStoreTable).toHaveBeenCalledTimes(1);
    });

    it('datastore resources are 400 (no cheap profile path)', async () => {
        queries.getResourceById.mockResolvedValue({ id: 'ds-1', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: null, datastore_active: true, ingest_status: null, table_name: null, ingested_columns: null });
        const res = await request(app).get('/api/v1/resources/ds-1/profile');
        expect(res.status).toBe(400);
        expect(storeQueries.profileStoreTable).not.toHaveBeenCalled();
    });

    it('not-yet-ingested resources are 409 with an ingest hint', async () => {
        queries.getResourceById.mockResolvedValue({ id: 'big-1', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: 10, datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null });
        const res = await request(app).get('/api/v1/resources/big-1/profile');
        expect(res.status).toBe(409);
        expect(storeQueries.profileStoreTable).not.toHaveBeenCalled();
    });

    it('unknown resource is 404', async () => {
        queries.getResourceById.mockResolvedValue(null);
        const res = await request(app).get('/api/v1/resources/nope/profile');
        expect(res.status).toBe(404);
    });
});
