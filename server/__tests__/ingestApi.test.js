jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/ingestQueries', () => ({ enqueueJob: jest.fn(), getJobById: jest.fn() }));
const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const ingestQueries = require('../db/ingestQueries');
const app = require('../app');
beforeEach(() => { jest.clearAllMocks(); });
function makeRow(overrides) { return Object.assign({ id: 'r-x', dataset_id: 'd1', url: 'https://example.org/file.csv', format: 'CSV', size_bytes: null, datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null }, overrides); }

describe('ingest API', () => {
    it('enqueues an ingestable CSV and returns 202', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'csv-1' }));
        ingestQueries.enqueueJob.mockResolvedValue({ id: 7, resource_id: 'csv-1', status: 'pending', attempts: 0, error: null, created_at: '2026-01-01' });
        const res = await request(app).post('/api/v1/resources/csv-1/ingest');
        expect(res.status).toBe(202);
        expect(res.body.data.id).toBe(7);
        expect(res.body.data.status).toBe('pending');
        expect(ingestQueries.enqueueJob).toHaveBeenCalledWith('csv-1');
    });

    it('enqueue is idempotent - an active job is returned, not duplicated', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'csv-2' }));
        ingestQueries.enqueueJob.mockResolvedValue({ id: 3, resource_id: 'csv-2', status: 'running', attempts: 1, error: null, created_at: '2026-01-01' });
        const res = await request(app).post('/api/v1/resources/csv-2/ingest');
        expect(res.status).toBe(202);
        expect(res.body.data.id).toBe(3);
        expect(res.body.data.status).toBe('running');
    });

    it('datastore-active resources are refused with 409', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-9', datastore_active: true }));
        const res = await request(app).post('/api/v1/resources/ds-9/ingest');
        expect(res.status).toBe(409);
        expect(ingestQueries.enqueueJob).not.toHaveBeenCalled();
    });

    it('non-CSV resources are refused with 422 and a download url', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'pdf-9', format: 'PDF', url: 'https://example.org/y.pdf' }));
        const res = await request(app).post('/api/v1/resources/pdf-9/ingest');
        expect(res.status).toBe(422);
        expect(res.body.download_url).toBe('https://example.org/y.pdf');
    });

    it('job polling returns the job', async () => {
        ingestQueries.getJobById.mockResolvedValue({ id: 7, resource_id: 'csv-1', status: 'done', attempts: 1, error: null, claimed_at: '2026-01-01', finished_at: '2026-01-01', created_at: '2026-01-01' });
        const res = await request(app).get('/api/v1/jobs/7');
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('done');
    });

    it('unknown job is 404 and bad id is 400', async () => {
        ingestQueries.getJobById.mockResolvedValue(null);
        expect((await request(app).get('/api/v1/jobs/999')).status).toBe(404);
        expect((await request(app).get('/api/v1/jobs/abc')).status).toBe(400);
    });
});
