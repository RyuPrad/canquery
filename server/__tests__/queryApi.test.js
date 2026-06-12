jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const queryLog = require('../db/queryLogQueries');
const ckan = require('../services/ckanClient');
const app = require('../app');
beforeEach(() => { jest.clearAllMocks(); });
function makeRow(overrides) { return Object.assign({ id: 'r-x', dataset_id: 'd1', url: 'https://example.org/file.csv', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null }, overrides); }

describe('query API datastore path', () => {
    test('datastore mode proxies upstream and wraps in the envelope', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-1', datastore_active: true }));
        ckan.datastoreSearch.mockResolvedValue({ fields: [{ id: '_id', type: 'int' }], records: [{ _id: 1 }], total: 42 });
        const res = await request(app).get('/api/v1/resources/ds-1/query?limit=2');
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(42);
        expect(res.body.meta.query_mode).toBe('datastore');
        expect(res.body.meta.source).toBe('opencanada');
        expect(ckan.datastoreSearch).toHaveBeenCalledWith({ resourceId: 'ds-1', q: undefined, filters: undefined, sort: undefined, limit: 2, offset: 0 });
    });

    test('datastore queries are logged as hits', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-log', datastore_active: true }));
        ckan.datastoreSearch.mockResolvedValue({ fields: [], records: [], total: 0 });
        const res = await request(app).get('/api/v1/resources/ds-log/query');
        expect(res.status).toBe(200);
        expect(queryLog.logQueryHit).toHaveBeenCalledWith('ds-log', 'datastore');
    });

    test('datastore proxy responses are cached', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-cache', datastore_active: true }));
        ckan.datastoreSearch.mockResolvedValue({ fields: [], records: [], total: 0 });
        const res1 = await request(app).get('/api/v1/resources/ds-cache/query?limit=5');
        const res2 = await request(app).get('/api/v1/resources/ds-cache/query?limit=5');
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
        expect(ckan.datastoreSearch).toHaveBeenCalledTimes(1);
    });

    test('equality filters are forwarded upstream', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-2', datastore_active: true }));
        ckan.datastoreSearch.mockResolvedValue({ fields: [], records: [], total: 0 });
        await request(app).get('/api/v1/resources/ds-2/query').query({ filters: JSON.stringify({ city: 'Ottawa' }) });
        expect(ckan.datastoreSearch).toHaveBeenCalledWith(expect.objectContaining({ filters: { city: 'Ottawa' } }));
    });

    test('operator filters on a datastore resource are rejected with 400', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-3', datastore_active: true }));
        const res = await request(app).get('/api/v1/resources/ds-3/query').query({ filters: JSON.stringify({ amount: { op: 'lt', value: 5 } }) });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/equality/i);
        expect(ckan.datastoreSearch).not.toHaveBeenCalled();
    });

    test('unknown resource is a 404', async () => {
        queries.getResourceById.mockResolvedValue(null);
        const res = await request(app).get('/api/v1/resources/nope/query');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Resource not found');
    });
});