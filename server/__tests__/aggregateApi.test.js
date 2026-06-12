jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const storeQueries = require('../db/storeQueries');
const ckan = require('../services/ckanClient');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

function ingestedRow() {
    return { id: 'ing-1', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: 'ready', table_name: 'r_abc123', ingested_columns: [{ id: 'province', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }, { id: 'day', type: 'DATE' }] };
}

describe('aggregation API', () => {
    it('aggregated query returns key/value fields and meta echo', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        storeQueries.aggregateStoreTable.mockResolvedValue({ records: [{ key: 'ON', value: '4' }], total: 1 });
        const res = await request(app).get('/api/v1/resources/ing-1/query?group_by=province&agg=count');
        expect(res.status).toBe(200);
        expect(res.body.data.fields).toEqual([{ id: 'key', type: 'TEXT' }, { id: 'value', type: 'INTEGER' }]);
        expect(res.body.data.total).toBe(1);
        expect(res.body.meta.query_mode).toBe('ingested');
        expect(res.body.meta.aggregation).toEqual({ group_by: 'province', agg: 'count', agg_column: null, bucket: null });
        expect(storeQueries.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'r_abc123', groupBy: 'province', agg: 'count', limit: 20, offset: 0 }));
    });

    it('sort value desc is accepted and forwarded', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        storeQueries.aggregateStoreTable.mockResolvedValue({ records: [], total: 0 });
        const res = await request(app).get('/api/v1/resources/ing-1/query?group_by=province&agg=count&sort=value%20desc');
        expect(res.status).toBe(200);
        expect(storeQueries.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ sortSql: '"value" DESC' }));
    });

    it('sorting by a table column in aggregation mode is 400', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        const res = await request(app).get('/api/v1/resources/ing-1/query?group_by=province&agg=count&sort=amount%20asc');
        expect(res.status).toBe(400);
        expect(storeQueries.aggregateStoreTable).not.toHaveBeenCalled();
    });

    it('datastore resources reject aggregation with 400', async () => {
        queries.getResourceById.mockResolvedValue({ id: 'ds-1', dataset_id: 'd1', url: 'u', format: 'CSV', size_bytes: null, datastore_active: true, ingest_status: null, table_name: null, ingested_columns: null });
        const res = await request(app).get('/api/v1/resources/ds-1/query?group_by=province&agg=count');
        expect(res.status).toBe(400);
        expect(ckan.datastoreSearch).not.toHaveBeenCalled();
    });

    it('sum over a TEXT column is 400', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        const res = await request(app).get('/api/v1/resources/ing-1/query?group_by=province&agg=sum&agg_column=province');
        expect(res.status).toBe(400);
        expect(storeQueries.aggregateStoreTable).not.toHaveBeenCalled();
    });

    it('aggregated CSV export emits key,value header', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        storeQueries.aggregateStoreTable.mockResolvedValue({ records: [{ key: 'ON', value: '4' }], total: 1 });
        const res = await request(app).get('/api/v1/resources/ing-1/query.csv?group_by=province&agg=count');
        expect(res.status).toBe(200);
        const lines = res.text.split('\n');
        expect(lines[0]).toBe('key,value');
        expect(lines[1]).toBe('ON,4');
    });

    it('plain non-aggregated query still works', async () => {
        queries.getResourceById.mockResolvedValue(ingestedRow());
        storeQueries.queryStoreTable.mockResolvedValue({ records: [{ _id: 1, province: 'ON', amount: '1', day: '2024-01-01' }], total: 1 });
        const res = await request(app).get('/api/v1/resources/ing-1/query');
        expect(res.status).toBe(200);
        expect(res.body.meta.aggregation).toBeUndefined();
        expect(storeQueries.queryStoreTable).toHaveBeenCalled();
        expect(storeQueries.aggregateStoreTable).not.toHaveBeenCalled();
    });
});
