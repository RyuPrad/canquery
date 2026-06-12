jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const store = require('../db/storeQueries');
const { detectHeaderIndex } = require('../utils/csvTypes');
const app = require('../app');
beforeEach(() => { jest.clearAllMocks(); store.touchLastAccessed.mockImplementation(() => Promise.resolve()); });

describe('UX batch endpoints', () => {
    it('stats includes the last sync time', async () => {
        queries.getStats.mockResolvedValue({ datasets: 1, resources: 2, datastore_active_resources: 1, ingested_resources: 0, store_bytes: '0', organizations: 1 });
        queries.getLastSyncTime.mockResolvedValue('2026-06-12T02:15:00Z');
        const res = await request(app).get('/api/v1/stats');
        expect(res.status).toBe(200);
        expect(res.body.data.last_synced_at).toBe('2026-06-12T02:15:00Z');
    });

    it('recently-unlocked returns shaped items', async () => {
        queries.listRecentlyIngested.mockResolvedValue([{ resource_id: 'r1', ingested_at: '2026-06-12', row_count: '10', name_en: 'A', name_fr: null, format: 'CSV', dataset_id: 'd1', dataset_name: 'd1', dataset_title_en: 'DS', dataset_title_fr: null }]);
        const res = await request(app).get('/api/v1/resources/recently-unlocked');
        expect(res.status).toBe(200);
        expect(res.body.data[0].resource_id).toBe('r1');
        expect(res.body.data[0].row_count).toBe(10);
        expect(res.body.data[0].dataset.title.en).toBe('DS');
        expect(queries.getResourceById).not.toHaveBeenCalled();
    });

    it('query.csv exports an ingested resource as a CSV attachment', async () => {
        queries.getResourceById.mockResolvedValue({ id: 'ing-9', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: 'ready', table_name: 'r_abc9', ingested_columns: [{ id: 'name', type: 'TEXT' }, { id: 'n', type: 'INTEGER' }] });
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: 1, name: 'plain', n: 5 }, { _id: 2, name: 'has,comma "q"', n: null }], total: 2 });
        const res = await request(app).get('/api/v1/resources/ing-9/query.csv');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/csv/);
        expect(res.headers['content-disposition']).toMatch(/attachment/);
        const lines = res.text.trim().split('\n');
        expect(lines[0]).toBe('_id,name,n');
        expect(lines[1]).toBe('1,plain,5');
        expect(lines[2]).toBe('2,"has,comma ""q""",');
    });

    it('query.csv on an unlockable resource is still a 409', async () => {
        queries.getResourceById.mockResolvedValue({ id: 'csv-9', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null });
        const res = await request(app).get('/api/v1/resources/csv-9/query.csv');
        expect(res.status).toBe(409);
        expect(res.body.hint).toMatch(/ingest/);
    });

    it('detectHeaderIndex skips title and blank preamble rows', () => {
        expect(detectHeaderIndex([['Big Title'], [''], ['Year', 'Value', 'Note'], ['2020', '1', 'x']])).toBe(2);
        expect(detectHeaderIndex([['a', 'b'], ['1', '2']])).toBe(0);
    });

    it('detectHeaderIndex leaves single-column files alone', () => {
        expect(detectHeaderIndex([['only'], ['1'], ['2']])).toBe(0);
        expect(detectHeaderIndex([])).toBe(0);
    });
});
