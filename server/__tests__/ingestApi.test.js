jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../db/ingestQueries', () => ({ enqueueJob: jest.fn(), getJobById: jest.fn() }));
// The real ingest limiter (5/hour) would 429 the later requests in this suite.
jest.mock('../middleware/rateLimits', () => ({ generalLimiter: (req, res, next) => next(), ingestLimiter: (req, res, next) => next() }));
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

    it('datastore-active CSV can be upgraded (ingested) for full filtering and returns 202', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-9', datastore_active: true, format: 'CSV' }));
        ingestQueries.enqueueJob.mockResolvedValue({ id: 21, resource_id: 'ds-9', status: 'pending', attempts: 0, error: null, created_at: '2026-01-01' });
        const res = await request(app).post('/api/v1/resources/ds-9/ingest');
        expect(res.status).toBe(202);
        expect(ingestQueries.enqueueJob).toHaveBeenCalledWith('ds-9');
    });

    it('datastore-active resource whose file is not loadable is refused with 422', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'ds-pdf', datastore_active: true, format: 'PDF', url: 'https://example.org/x.pdf' }));
        const res = await request(app).post('/api/v1/resources/ds-pdf/ingest');
        expect(res.status).toBe(422);
        expect(res.body.download_url).toBe('https://example.org/x.pdf');
        expect(ingestQueries.enqueueJob).not.toHaveBeenCalled();
    });

    it('enqueues an ingestable XLSX and returns 202', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'xlsx-1', format: 'XLSX', url: 'https://example.org/file.xlsx' }));
        ingestQueries.enqueueJob.mockResolvedValue({ id: 9, resource_id: 'xlsx-1', status: 'pending', attempts: 0, error: null, created_at: '2026-01-01' });
        const res = await request(app).post('/api/v1/resources/xlsx-1/ingest');
        expect(res.status).toBe(202);
        expect(res.body.data.id).toBe(9);
    });

    it('enqueues a legacy XLS and returns 202', async () => {
        queries.getResourceById.mockResolvedValue(makeRow({ id: 'xls-9', format: 'XLS', url: 'https://example.org/old.xls' }));
        ingestQueries.enqueueJob.mockResolvedValue({ id: 11, resource_id: 'xls-9', status: 'pending', attempts: 0, error: null, created_at: '2026-01-01' });
        const res = await request(app).post('/api/v1/resources/xls-9/ingest');
        expect(res.status).toBe(202);
        expect(res.body.data.id).toBe(11);
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
