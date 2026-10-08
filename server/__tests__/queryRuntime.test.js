jest.mock('../db/pool', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({ getResourceById: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ datastoreSearch: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(async () => {}) }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(),
    touchLastAccessed: jest.fn(async () => true), profileStoreTable: jest.fn() }));

const pool = require('../db/pool');
const catalog = require('../db/catalogReadQueries');
const store = require('../db/storeQueries');
const ckan = require('../services/ckanClient');
const service = require('../services/queryService');
const { snapshotDb } = require('../db/snapshotRead');
const { snapshotInfo } = require('../services/snapshotIdentity');
let checkedOut;
let client;
const local = { id: 'fixture', dataset_id: 'd', format: 'CSV', url: 'https://example.test/a.csv',
    ingest_status: 'ready', table_name: 'r_a1', ingested_at: '2026-01-01T00:00:00Z',
    ingested_columns: [{ id: 'value', type: 'TEXT' }], ingested_row_count: 2 };
const remote = { ...local, ingest_status: null, table_name: null, datastore_active: true };

beforeEach(() => {
    jest.clearAllMocks();
    checkedOut = 0;
    client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn(() => checkedOut--) };
    pool.connect.mockImplementation(async () => { checkedOut++; return client; });
    catalog.getResourceById.mockResolvedValue(local);
    store.queryStoreTable.mockResolvedValue({ records: [{ _id: '1', value: '00123' }], total: 1 });
});

test('a slow CKAN request and export retain no database connection', async () => {
    catalog.getResourceById.mockResolvedValue(remote);
    ckan.datastoreSearch.mockImplementation(async () => {
        expect(checkedOut).toBe(0);
        await new Promise(resolve => setImmediate(resolve));
        expect(checkedOut).toBe(0);
        return { fields: [], records: [], total: 0 };
    });
    await service.queryResource('remote-fixture');
    await service.queryResourceForExport('remote-fixture', {}, async () => expect(checkedOut).toBe(0));
    expect(pool.connect).not.toHaveBeenCalled();
});

test('metadata is re-read under the lease and a changed backend runs after release', async () => {
    catalog.getResourceById.mockResolvedValueOnce(local).mockImplementationOnce(async () => {
        expect(snapshotDb()).toBe(client);
        return { ...remote, id: 'backend-race' };
    });
    ckan.datastoreSearch.mockImplementation(async () => {
        expect(checkedOut).toBe(0);
        return { fields: [], records: [], total: 0 };
    });
    await service.queryResource('backend-race');
    expect(client.release).toHaveBeenCalledTimes(1);
});

test('local export consumption, backpressure and partial close retain one lease', async () => {
    await service.queryResourceForExport(local.id, {}, async ({ records }) => {
        expect(checkedOut).toBe(1);
        for await (const record of records) {
            expect(record.value).toBe('00123');
            await new Promise(resolve => setImmediate(resolve));
            expect(snapshotDb()).toBe(client);
            expect(checkedOut).toBe(1);
            break;
        }
    });
    expect(store.touchLastAccessed).toHaveBeenCalledWith(local.id, local.table_name);
    expect(checkedOut).toBe(0);
});

test('consumer failure closes the iterator and releases its lease', async () => {
    await expect(service.queryResourceForExport(local.id, {}, async ({ records }) => {
        await records.next();
        throw new Error('socket closed');
    })).rejects.toThrow('socket closed');
    expect(store.touchLastAccessed).toHaveBeenCalledTimes(1);
    expect(checkedOut).toBe(0);
});

test('snapshot identifiers hide table names, survive metadata changes and change on publication', () => {
    const first = snapshotInfo(local);
    expect(first.id).toMatch(/^cqs1_[0-9a-f]{64}$/);
    expect(snapshotInfo({ ...local, last_modified: '2026-10-01', name_en: 'new' }).id).toBe(first.id);
    expect(snapshotInfo({ ...local, table_name: 'r_a2' }).id).not.toBe(first.id);
});

test('recorded legacy aliases share query validation and canonical aggregate cache options', () => {
    const row = { ...local, ingested_columns: [{ id: 'code', type: 'TEXT', legacy_ids: ['ancien'] },
        { id: 'amount', type: 'NUMERIC', legacy_ids: ['old amount'] }] };
    const plan = service.planQuery(row, { filters: JSON.stringify({ ancien: '00123' }), sort: 'ancien desc' });
    expect(plan.options.filters[0].column).toBe('code');
    expect(plan.options.sortSql).toContain('"code" DESC');
    expect(plan.options.snapshotRowCount).toBe(2);
    const aggregate = service.planQuery(row, { group_by: 'ancien', agg: 'sum', agg_column: 'old amount', sort: 'value desc' });
    expect(aggregate.options).toMatchObject({ groupBy: 'code', aggColumn: 'amount' });
    expect(aggregate.options.sortSql).toContain('"value" DESC');
});

test('required snapshot is checked after lease acquisition before reading', async () => {
    const expected = snapshotInfo(local).id;
    catalog.getResourceById.mockResolvedValueOnce(local).mockResolvedValueOnce({ ...local, table_name: 'r_a2' });
    await expect(service.queryResource(local.id, { snapshot: expected })).rejects.toMatchObject({
        statusCode: 409, publicCode: 'SNAPSHOT_UNAVAILABLE'
    });
    expect(store.queryStoreTable).not.toHaveBeenCalled();
    expect(checkedOut).toBe(0);
});

test.each(['', 'private_table', ['cqs1_' + 'a'.repeat(64)]])('rejects malformed snapshot %p before database access', async snapshot => {
    await expect(service.queryResource(local.id, { snapshot })).rejects.toMatchObject({ statusCode: 400 });
    expect(catalog.getResourceById).not.toHaveBeenCalled();
});

test('a required snapshot never falls back to DataStore', async () => {
    catalog.getResourceById.mockResolvedValue(remote);
    await expect(service.queryResource(local.id, { snapshot: snapshotInfo(local).id })).rejects.toMatchObject({
        publicCode: 'SNAPSHOT_UNAVAILABLE'
    });
    expect(ckan.datastoreSearch).not.toHaveBeenCalled();
});

test('HTTP query, profile and CSV share the same public snapshot contract', async () => {
    const request = require('supertest');
    const app = require('../app');
    const id = snapshotInfo(local).id;
    store.profileStoreTable.mockResolvedValue({ rowCount: 1, columns: [] });
    for (const route of ['query', 'profile']) {
        const response = await request(app).get('/api/v1/resources/fixture/' + route).query({ snapshot: id });
        expect(response.status).toBe(200);
        expect(response.body.meta.snapshot.id).toBe(id);
        expect(response.body.meta.retrieved_at).toBeTruthy();
    }
    const csv = await request(app).get('/api/v1/resources/fixture/query.csv').query({ snapshot: id });
    expect(csv.status).toBe(200);
    expect(csv.headers['x-canquery-snapshot']).toBe(id);
    expect(csv.headers['x-canquery-prepared-at']).toBe('2026-01-01T00:00:00.000Z');
    expect(csv.text).toContain('00123');
    const unavailable = await request(app).get('/api/v1/resources/fixture/query.csv')
        .query({ snapshot: 'cqs1_' + '0'.repeat(64) });
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.code).toBe('SNAPSHOT_UNAVAILABLE');
    expect(unavailable.headers['content-disposition']).toBeUndefined();
});


test('profile cache follows corrected schema even when serving table and preparation time are unchanged', async () => {
    const row = { ...local, id: 'profile-schema-repair', table_name: 'r_schema_repair', ingested_columns: [{ id: 'old', type: 'TEXT' }] };
    catalog.getResourceById.mockResolvedValue(row);
    store.profileStoreTable.mockImplementation(async ({ columns }) => ({ rowCount: 1, columns }));
    expect((await service.profileResource(row.id)).columns[0].id).toBe('old');
    catalog.getResourceById.mockResolvedValue({ ...row, ingested_columns: [{ id: 'canonical', type: 'TEXT', legacy_ids: ['old'] }] });
    expect((await service.profileResource(row.id)).columns[0].id).toBe('canonical');
    expect(store.profileStoreTable).toHaveBeenCalledTimes(2);
});
