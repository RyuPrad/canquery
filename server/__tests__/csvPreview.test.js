jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../services/csvDownload', () => ({ ...jest.requireActual('../services/csvDownload'), downloadHead: jest.fn() }));

const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const csvDownload = require('../services/csvDownload');
const { downloadHead: realDownloadHead } = jest.requireActual('../services/csvDownload');
const { previewRecords, previewCache, PREVIEW_BYTES } = require('../services/csvPreview');
const app = require('../app');

const csv = (rows) => rows.map(row => row.join(',')).join('\n') + '\n';
const ingestable = (overrides = {}) => ({ id: 'csv-1', dataset_id: 'd1', url: 'https://example.org/permits.csv', format: 'CSV',
    size_bytes: null, datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null,
    last_modified: '2026-10-15T11:06:20.720Z', provenance_sources: [], ...overrides });

function fetchStub({ status = 206, body, headers = {}, onInit } = {}) {
    return jest.fn(async (url, init) => {
        if (onInit) onInit(init);
        const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
        const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
        return { status, headers: { get: name => headers[name.toLowerCase()] ?? null }, body: stream };
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    previewCache.clear();
});

describe('downloadHead', () => {
    test('asks for the first bytes only and reports an incomplete range', async () => {
        let init;
        const fetchImpl = fetchStub({ status: 206, body: 'a,b\n1,2\n', headers: { 'content-range': 'bytes 0-7/1000' }, onInit: value => { init = value; } });
        const head = await realDownloadHead('https://example.org/file.csv', { maxBytes: 8, fetchImpl });
        expect(init.headers.Range).toBe('bytes=0-7');
        expect(head.bytes.toString()).toBe('a,b\n1,2\n');
        expect(head).toMatchObject({ complete: false, contentLength: 1000, status: 206 });
    });

    test('a small file served in one range is complete', async () => {
        const fetchImpl = fetchStub({ status: 206, body: 'a,b\n1,2\n', headers: { 'content-range': 'bytes 0-7/8' } });
        const head = await realDownloadHead('https://example.org/file.csv', { maxBytes: 64, fetchImpl });
        expect(head).toMatchObject({ complete: true, contentLength: 8 });
    });

    test('a host that ignores Range is cut at the cap, and a short full body is complete', async () => {
        const big = 'x'.repeat(5000);
        const capped = await realDownloadHead('https://example.org/file.csv', { maxBytes: 100, fetchImpl: fetchStub({ status: 200, body: big, headers: { 'content-length': '5000' } }) });
        expect(capped.bytes.length).toBe(100);
        expect(capped).toMatchObject({ complete: false, contentLength: 5000, status: 200 });
        const small = await realDownloadHead('https://example.org/file.csv', { maxBytes: 100, fetchImpl: fetchStub({ status: 200, body: 'a,b\n1,2\n' }) });
        expect(small).toMatchObject({ complete: true, contentLength: null });
    });

    test('an HTTP failure keeps its status and a hung host times out', async () => {
        await expect(realDownloadHead('https://example.org/file.csv', { fetchImpl: fetchStub({ status: 404, body: 'gone' }) }))
            .rejects.toMatchObject({ code: 'DOWNLOAD_HTTP', httpStatus: 404 });
        const hung = jest.fn((url, init) => new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        }));
        await expect(realDownloadHead('https://example.org/file.csv', { timeoutMs: 20, fetchImpl: hung }))
            .rejects.toMatchObject({ code: 'DOWNLOAD_RESPONSE_STALL' });
    });
});

describe('previewRecords', () => {
    test('infers the header and types and drops the record that may be cut', async () => {
        const rows = [['Year', 'City', 'Amount'], ...Array.from({ length: 60 }, (_, i) => [String(2000 + i), 'Ottawa', (i * 1.5).toFixed(1)])];
        const text = csv(rows).slice(0, -4); // cut inside the last record
        const sample = await previewRecords(Buffer.from(text), { complete: false });
        expect(sample.fields).toEqual([
            { id: 'Year', type: 'INTEGER', original_label: 'Year' },
            { id: 'City', type: 'TEXT', original_label: 'City' },
            { id: 'Amount', type: 'NUMERIC', original_label: 'Amount' }
        ]);
        expect(sample.records).toHaveLength(50);
        expect(sample.records[0]).toEqual({ Year: '2000', City: 'Ottawa', Amount: '0.0' });
        expect(sample.truncated).toBe(true);
        expect(sample.sampled_rows).toBe(59);
    });

    test('keeps every row of a complete file and skips a BOM and a title line like the loader', async () => {
        const text = '\ufeffExport 2026\nRegion,Code\nON,1\nQC,2\n';
        const sample = await previewRecords(Buffer.from(text), { complete: true });
        expect(sample.fields).toEqual([{ id: 'Region', type: 'TEXT', original_label: 'Region' }, { id: 'Code', type: 'INTEGER', original_label: 'Code' }]);
        expect(sample.records).toEqual([{ Region: 'ON', Code: '1' }, { Region: 'QC', Code: '2' }]);
        expect(sample.truncated).toBe(false);
        expect(sample.sampled_rows).toBe(2);
    });

    test('an unclosed quote at the cut keeps the rows before it; empty or HTML content is rejected', async () => {
        const text = 'a,b\n1,"x"\n2,"cut';
        const sample = await previewRecords(Buffer.from(text), { complete: false });
        expect(sample.records).toEqual([{ a: '1', b: 'x' }]);
        await expect(previewRecords(Buffer.from(''), { complete: true })).rejects.toMatchObject({ code: 'CSV_EMPTY' });
        await expect(previewRecords(Buffer.from('<!doctype html><html><head><title>x</title></head></html>'), { complete: true }))
            .rejects.toMatchObject({ code: 'CSV_CONTENT_TYPE' });
    });
});

describe('GET /resources/:id/preview', () => {
    test('returns the first rows of a file CanQuery can prepare, served from the cache afterwards', async () => {
        queries.getResourceById.mockResolvedValue(ingestable());
        csvDownload.downloadHead.mockResolvedValue({ bytes: Buffer.from(csv([['Year', 'City'], ['2024', 'Ottawa'], ['2025', 'Hull']])), complete: false, contentLength: 111600495, status: 206 });
        const res = await request(app).get('/api/v1/resources/csv-1/preview');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.body.data.fields).toEqual([{ id: 'Year', type: 'INTEGER', original_label: 'Year' }, { id: 'City', type: 'TEXT', original_label: 'City' }]);
        expect(res.body.data.records).toEqual([{ Year: '2024', City: 'Ottawa' }, { Year: '2025', City: 'Hull' }]);
        expect(res.body.data).toMatchObject({ truncated: true, sampled_rows: 2, content_length: 111600495 });
        expect(res.body.meta).toMatchObject({ query_mode: 'preview', source: 'canquery', publisher_modified_at: '2026-10-15T11:06:20.720Z', sources: [] });
        expect(res.body.meta.retrieved_at).toBeTruthy();
        expect(csvDownload.downloadHead).toHaveBeenCalledWith('https://example.org/permits.csv', expect.objectContaining({ maxBytes: PREVIEW_BYTES, timeoutMs: 8000 }));
        const again = await request(app).get('/web-api/v1/resources/csv-1/preview');
        expect(again.status).toBe(200);
        expect(csvDownload.downloadHead).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['a ready copy', { ingest_status: 'ready', table_name: 'r_abc', ingested_columns: [{ id: 'a', type: 'TEXT' }] }, 409, 'PREVIEW_NOT_NEEDED'],
        ['a live DataStore', { datastore_active: true }, 409, 'PREVIEW_NOT_NEEDED'],
        ['an Excel workbook', { format: 'XLSX', url: 'https://example.org/book.xlsx' }, 422, 'PREVIEW_UNSUPPORTED'],
        ['a plain download', { format: 'PDF', url: 'https://example.org/guide.pdf' }, 422, 'PREVIEW_UNSUPPORTED']
    ])('refuses %s without reading the publisher', async (_label, overrides, status, code) => {
        queries.getResourceById.mockResolvedValue(ingestable(overrides));
        const res = await request(app).get('/api/v1/resources/csv-1/preview');
        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
        expect(csvDownload.downloadHead).not.toHaveBeenCalled();
    });

    test('maps publisher failures to 502 with their retry delay, and unreadable content to 422', async () => {
        queries.getResourceById.mockResolvedValue(ingestable());
        csvDownload.downloadHead.mockRejectedValueOnce(Object.assign(new Error('download failed: HTTP 503'), { code: 'DOWNLOAD_HTTP', httpStatus: 503, retryAfterMs: 30000 }));
        const failed = await request(app).get('/api/v1/resources/csv-1/preview');
        expect(failed.status).toBe(502);
        expect(failed.body).toMatchObject({ code: 'PREVIEW_UPSTREAM', retry_after: 30 });
        expect(failed.headers['retry-after']).toBe('30');
        previewCache.clear();
        csvDownload.downloadHead.mockRejectedValueOnce(Object.assign(new Error('stalled'), { code: 'DOWNLOAD_RESPONSE_STALL' }));
        const stalled = await request(app).get('/api/v1/resources/csv-1/preview');
        expect(stalled.status).toBe(502);
        expect(stalled.body.code).toBe('PREVIEW_TIMEOUT');
        previewCache.clear();
        csvDownload.downloadHead.mockResolvedValueOnce({ bytes: Buffer.from('<!doctype html><html><head></head><body>no</body></html>'), complete: true, contentLength: 60, status: 200 });
        const html = await request(app).get('/api/v1/resources/csv-1/preview');
        expect(html.status).toBe(422);
        expect(html.body.code).toBe('PREVIEW_UNSUPPORTED');
    });

    test('404 for an unknown resource', async () => {
        queries.getResourceById.mockResolvedValue(null);
        const res = await request(app).get('/api/v1/resources/ghost/preview');
        expect(res.status).toBe(404);
    });
});
