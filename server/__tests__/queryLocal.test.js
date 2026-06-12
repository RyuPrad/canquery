jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const queryLog = require('../db/queryLogQueries');
const store = require('../db/storeQueries');
const app = require('../app');
beforeEach(() => { jest.clearAllMocks(); store.touchLastAccessed.mockImplementation(() => Promise.resolve()); });
function makeRow(overrides) { return Object.assign({ id: 'r-x', dataset_id: 'd1', url: 'https://example.org/file.csv', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null }, overrides); }

describe('query API local and unqueryable paths', () => {
    test('ingested mode queries the local store with validated sort and filters', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ing-1', ingest_status: 'ready', table_name: 'r_abc123', ingested_columns: [{ id: 'col1', type: 'text' }] }));
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: 1, col1: 'v' }], total: 1 });
        const res = await request(app).get('/api/v1/resources/ing-1/query').query({ filters: JSON.stringify({ col1: 'v' }), sort: 'col1 desc', limit: 10 });
        expect(res.status).toBe(200);
        expect(res.body.meta.query_mode).toBe('ingested');
        expect(res.body.data.fields[0]).toEqual({ id: '_id', type: 'int' });
        expect(store.queryStoreTable).toHaveBeenCalledWith({ tableName: 'r_abc123', knownColumns: ['col1'], q: undefined, filters: [{ column: 'col1', op: 'eq', value: 'v' }], sortSql: '"col1" DESC', limit: 10, offset: 0 });
        expect(store.touchLastAccessed).toHaveBeenCalledWith('ing-1');
        expect(queryLog.logQueryHit).toHaveBeenCalledWith('ing-1', 'ingested');
    });

    test('a failing query log write never breaks the response', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ing-1', ingest_status: 'ready', table_name: 'r_abc123', ingested_columns: [{ id: 'col1', type: 'text' }] }));
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: 1, col1: 'v' }], total: 1 });
        queryLog.logQueryHit.mockRejectedValue(new Error('pg down'));
        const res = await request(app).get('/api/v1/resources/ing-1/query');
        expect(res.status).toBe(200);
    });

    test('unknown filter column on an ingested resource is a 400', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ing-2', ingest_status: 'ready', table_name: 'r_abc124', ingested_columns: [{ id: 'col1', type: 'text' }] }));
        const res = await request(app).get('/api/v1/resources/ing-2/query').query({ filters: JSON.stringify({ evil: { op: 'eq', value: 'x' } }) });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/unknown column/i);
        expect(store.queryStoreTable).not.toHaveBeenCalled();
    });

    test('unknown sort column on an ingested resource is a 400', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ing-3', ingest_status: 'ready', table_name: 'r_abc125', ingested_columns: [{ id: 'col1', type: 'text' }] }));
        const res = await request(app).get('/api/v1/resources/ing-3/query').query({ sort: 'hax desc' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/unknown sort column/i);
    });

    test('ingestable CSV returns 409 with an ingest hint', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'csv-1' }));
        const res = await request(app).get('/api/v1/resources/csv-1/query');
        expect(res.status).toBe(409);
        expect(res.body.hint).toBe('POST /api/v1/resources/csv-1/ingest');
    });

    test('file-only resources return 422 with the download url', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'pdf-1', format: 'PDF', url: 'https://example.org/x.pdf' }));
        const res = await request(app).get('/api/v1/resources/pdf-1/query');
        expect(res.status).toBe(422);
        expect(res.body.download_url).toBe('https://example.org/x.pdf');
    });
});
