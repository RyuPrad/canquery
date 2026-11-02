jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), readStoreRows: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../services/csvDownload', () => ({ ...jest.requireActual('../services/csvDownload'), downloadHead: jest.fn() }));
jest.mock('../db/pool', () => ({ query: jest.fn(), connect: jest.fn(), on: jest.fn(), end: jest.fn() }));

const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const ckan = require('../services/ckanClient');
const store = require('../db/storeQueries');
const queryLog = require('../db/queryLogQueries');
const csvDownload = require('../services/csvDownload');
const pool = require('../db/pool');
const { snapshotInfo } = require('../services/snapshotIdentity');
const tableRows = require('../services/tableRows');
const csvPreview = require('../services/csvPreview');
const { tableRowsLimiter } = require('../middleware/rateLimits');
const app = require('../app');

const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };
const rowsUrl = id => '/web-api/v1/resources/' + id + '/rows';

const base = (overrides = {}) => ({ id: 'r1', dataset_id: 'd1', url: 'https://example.org/file.csv', format: 'CSV', size_bytes: null,
    datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null, ingested_row_count: null,
    last_modified: '2026-10-15T11:06:20.720Z', provenance_sources: [], raw: {}, ...overrides });
const copy = (overrides = {}) => base({ id: 'copy-1', ingest_status: 'ready', table_name: 'r_abc123', ingested_row_count: 2,
    ingested_columns: [{ id: 'name', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }], ingested_at: '2026-11-01T00:00:00.000Z', ...overrides });
const live = (overrides = {}) => base({ id: 'live-1', datastore_active: true, raw: { source_id: 'open-canada' }, ...overrides });

// Stands in for PostgreSQL's two typing queries: every value is valid unless
// the test says otherwise, and the canonical form is the text itself.
function typingPool({ invalid = new Set() } = {}) {
    pool.query.mockImplementation(async (sql, params) => {
        if (/pg_input_is_valid/.test(sql)) {
            const values = params[0].filter(value => value !== null && value !== '');
            return { rows: [{ ok: !values.some(value => invalid.has(value)) }] };
        }
        return { rows: params[0].map(value => ({ v: value === '' ? null : value })) };
    });
}

beforeEach(async () => {
    jest.clearAllMocks();
    // The 10-a-minute limit is per process and this file asks more often.
    for (const key of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) await tableRowsLimiter.resetKey(key);
    tableRows.clearCaches();
    csvPreview.completeHeads.clear();
    store.touchLastAccessed.mockImplementation(() => Promise.resolve());
    typingPool();
});

describe('GET /web-api/v1/resources/:id/rows: who may ask', () => {
    test('requires a same-origin browser request', async () => {
        queries.getResourceById.mockResolvedValue(copy());
        const res = await request(app).get(rowsUrl('copy-1'));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SAME_ORIGIN_REQUIRED');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(queries.getResourceById).not.toHaveBeenCalled();
    });

    test('is not part of the developer API', async () => {
        const res = await request(app).get('/api/v1/resources/copy-1/rows').set(SAME_ORIGIN);
        expect(res.status).toBe(404);
    });

    test('a missing resource is a 404 and download-only files are refused', async () => {
        queries.getResourceById.mockResolvedValueOnce(null);
        expect((await request(app).get(rowsUrl('gone')).set(SAME_ORIGIN)).status).toBe(404);
        queries.getResourceById.mockResolvedValueOnce(base({ id: 'pdf', format: 'PDF', url: 'https://example.org/x.pdf' }));
        const pdf = await request(app).get(rowsUrl('pdf')).set(SAME_ORIGIN);
        expect(pdf.status).toBe(422);
        expect(pdf.body.code).toBe('ROWS_UNSUPPORTED');
        queries.getResourceById.mockResolvedValueOnce(base({ id: 'xlsx', format: 'XLSX', url: 'https://example.org/x.xlsx' }));
        expect((await request(app).get(rowsUrl('xlsx')).set(SAME_ORIGIN)).body.code).toBe('ROWS_UNSUPPORTED');
    });
});

describe('prepared copies', () => {
    test('a small copy arrives whole, pinned to its snapshot, without renewing it or counting a visit', async () => {
        const row = copy();
        queries.getResourceById.mockResolvedValue(row);
        store.readStoreRows.mockResolvedValue({ records: [
            { _id: '1', name: 'Ward 3', amount: '98200.50' },
            { _id: '2', name: 'Ward 11', amount: null }
        ] });
        const snapshot = snapshotInfo(row).id;
        const res = await request(app).get(rowsUrl('copy-1')).query({ snapshot }).set(SAME_ORIGIN);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('private, max-age=86400');
        expect(res.headers['x-canquery-retrieved-at']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(res.headers['x-robots-tag']).toBe('noindex');
        expect(res.body.data).toEqual({
            fields: [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }],
            rows: [['1', 'Ward 3', '98200.50'], ['2', 'Ward 11', null]],
            total: 2,
            complete: true
        });
        expect(res.body.meta).toMatchObject({ source: 'canquery', origin: 'copy', query_mode: 'ingested', snapshot: { id: snapshot } });
        expect(store.readStoreRows).toHaveBeenCalledWith({ tableName: 'r_abc123', limit: tableRows.COPY_ROW_CAP + 1 });
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
        expect(queryLog.logQueryHit).not.toHaveBeenCalled();
    });

    test('needs the snapshot the page reported, and a replaced copy is a 409', async () => {
        queries.getResourceById.mockResolvedValue(copy());
        const missing = await request(app).get(rowsUrl('copy-1')).set(SAME_ORIGIN);
        expect(missing.status).toBe(400);
        expect(missing.body.code).toBe('SNAPSHOT_REQUIRED');
        const stale = await request(app).get(rowsUrl('copy-1')).query({ snapshot: 'cqs1_' + '0'.repeat(64) }).set(SAME_ORIGIN);
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe('SNAPSHOT_UNAVAILABLE');
        expect(store.readStoreRows).not.toHaveBeenCalled();
    });

    test('a copy over the row or cell cap is refused before anything is read', async () => {
        for (const overrides of [
            { ingested_row_count: tableRows.COPY_ROW_CAP + 1 },
            { ingested_row_count: 20000, ingested_columns: Array.from({ length: 11 }, (_, i) => ({ id: 'c' + i, type: 'TEXT' })) }
        ]) {
            const row = copy(overrides);
            queries.getResourceById.mockResolvedValue(row);
            const res = await request(app).get(rowsUrl('copy-1')).query({ snapshot: snapshotInfo(row).id }).set(SAME_ORIGIN);
            expect(res.status).toBe(413);
            expect(res.body.code).toBe('TABLE_TOO_LARGE');
        }
        expect(store.readStoreRows).not.toHaveBeenCalled();
    });

    test('a stale row count cannot slip a bigger table through', async () => {
        const row = copy({ ingested_row_count: 2 });
        queries.getResourceById.mockResolvedValue(row);
        store.readStoreRows.mockResolvedValue({ records: Array.from({ length: tableRows.COPY_ROW_CAP + 1 }, (_, i) => ({ _id: String(i + 1), name: 'x', amount: '1' })) });
        const res = await request(app).get(rowsUrl('copy-1')).query({ snapshot: snapshotInfo(row).id }).set(SAME_ORIGIN);
        expect(res.status).toBe(413);
    });
});

describe('live CKAN tables', () => {
    const fields = [{ id: '_id', type: 'int' }, { id: 'ward', type: 'text' }, { id: 'count', type: 'numeric' }, { id: '_full_text', type: 'tsvector' }];

    test('a small live table arrives whole after a one-row size check, without its full-text column', async () => {
        queries.getResourceById.mockResolvedValue(live());
        ckan.datastoreSearch
            .mockResolvedValueOnce({ fields, records: [{ _id: 1, ward: 'A', count: 3 }], total: 2 })
            .mockResolvedValueOnce({ fields, records: [{ _id: 1, ward: 'A', count: 3, _full_text: 'x' }, { _id: 2, ward: 'B', count: null }], total: 2 });
        const res = await request(app).get(rowsUrl('live-1')).set(SAME_ORIGIN);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('private, max-age=300');
        expect(res.body.data).toEqual({ fields: fields.slice(0, 3), rows: [[1, 'A', 3], [2, 'B', null]], total: 2, complete: true });
        expect(res.body.meta).toMatchObject({ origin: 'live', query_mode: 'datastore' });
        expect(ckan.datastoreSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({ resourceId: 'live-1', limit: 1, offset: 0, maxRetries: 0, timeoutMs: 10000 }));
        expect(ckan.datastoreSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: tableRows.LIVE_ROW_CAP, offset: 0, maxRetries: 0 }));
        // A second visit is served from the cache.
        expect((await request(app).get(rowsUrl('live-1')).set(SAME_ORIGIN)).status).toBe(200);
        expect(ckan.datastoreSearch).toHaveBeenCalledTimes(2);
        expect(queryLog.logQueryHit).not.toHaveBeenCalled();
    });

    test('a big live table is refused from its size alone, and the refusal is remembered', async () => {
        queries.getResourceById.mockResolvedValue(live());
        ckan.datastoreSearch.mockResolvedValueOnce({ fields, records: [], total: tableRows.LIVE_ROW_CAP + 1 });
        expect((await request(app).get(rowsUrl('live-1')).set(SAME_ORIGIN)).status).toBe(413);
        expect((await request(app).get(rowsUrl('live-1')).set(SAME_ORIGIN)).status).toBe(413);
        expect(ckan.datastoreSearch).toHaveBeenCalledTimes(1);
    });

    test('a portal that returns fewer rows than it reports is refused', async () => {
        queries.getResourceById.mockResolvedValue(live());
        ckan.datastoreSearch
            .mockResolvedValueOnce({ fields, records: [], total: 3 })
            .mockResolvedValueOnce({ fields, records: [{ _id: 1, ward: 'A', count: 1 }], total: 3 });
        const res = await request(app).get(rowsUrl('live-1')).set(SAME_ORIGIN);
        expect(res.status).toBe(413);
        expect(res.body.code).toBe('TABLE_TOO_LARGE');
    });
});

describe('CSV files not prepared yet', () => {
    const csv = text => ({ bytes: Buffer.from(text), complete: true, contentLength: Buffer.byteLength(text), status: 206 });

    test('a whole small file arrives typed like the loader, with _id numbered from 1', async () => {
        queries.getResourceById.mockResolvedValue(base({ id: 'csv-1' }));
        csvDownload.downloadHead.mockResolvedValue(csv('Ward,Count,Code,Note\nA,3,007,x\nB,,012,\nC,5,3\n'));
        const res = await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('private, max-age=600');
        expect(res.body.meta).toMatchObject({ origin: 'file', query_mode: 'ingestable' });
        const { fields, rows, total, complete } = res.body.data;
        expect(fields.map(({ id, type }) => [id, type])).toEqual([['_id', 'int'], ['Ward', 'TEXT'], ['Count', 'INTEGER'], ['Code', 'TEXT'], ['Note', 'TEXT']]);
        // An empty typed cell is NULL; an empty text cell stays ''; a missing
        // trailing cell is NULL; leading-zero codes keep the column TEXT.
        expect(rows).toEqual([['1', 'A', '3', '007', 'x'], ['2', 'B', null, '012', ''], ['3', 'C', '5', '3', null]]);
        expect(total).toBe(3);
        expect(complete).toBe(true);
        expect(csvDownload.downloadHead).toHaveBeenCalledWith('https://example.org/file.csv', expect.objectContaining({ maxBytes: tableRows.FILE_BYTES, timeoutMs: 8000 }));
    });

    test('one value PostgreSQL cannot read makes the column TEXT, as the loader does', async () => {
        queries.getResourceById.mockResolvedValue(base({ id: 'csv-1' }));
        csvDownload.downloadHead.mockResolvedValue(csv('Day,Amount\n2024-01-05,1\n2024-02-30,2\n'));
        typingPool({ invalid: new Set(['2024-02-30']) });
        const res = await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN);
        expect(res.body.data.fields[1]).toEqual({ id: 'Day', type: 'TEXT', original_label: 'Day', cast_failed: true });
        expect(res.body.data.fields[2]).toMatchObject({ id: 'Amount', type: 'INTEGER' });
    });

    test('a sample cut short drops its possibly cut last record and is not complete', async () => {
        queries.getResourceById.mockResolvedValue(base({ id: 'csv-1' }));
        csvDownload.downloadHead.mockResolvedValue({ bytes: Buffer.from('Ward,Note\nA,"one"\nB,"tw'), complete: false, contentLength: 5000, status: 206 });
        const res = await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN);
        expect(res.status).toBe(200);
        expect(res.body.data.rows).toEqual([['1', 'A', 'one']]);
        expect(res.body.data).toMatchObject({ total: null, complete: false });
    });

    test('rows beyond the cell cap are cut and the table is not complete', async () => {
        queries.getResourceById.mockResolvedValue(base({ id: 'csv-1' }));
        const columns = 40;
        const rowsWanted = Math.floor(tableRows.CELL_CAP / columns) + 5;
        const header = Array.from({ length: columns }, (_, i) => 'c' + i).join(',');
        const line = Array.from({ length: columns }, () => 'x').join(',');
        csvDownload.downloadHead.mockResolvedValue(csv(header + '\n' + Array.from({ length: rowsWanted }, () => line).join('\n') + '\n'));
        const res = await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN);
        expect(res.body.data.rows).toHaveLength(Math.floor(tableRows.CELL_CAP / columns));
        expect(res.body.data.complete).toBe(false);
    });

    test('more than 120 columns is too large', async () => {
        queries.getResourceById.mockResolvedValue(base({ id: 'csv-1' }));
        const header = Array.from({ length: tableRows.COLUMN_CAP + 1 }, (_, i) => 'c' + i).join(',');
        csvDownload.downloadHead.mockResolvedValue(csv(header + '\n' + header.replace(/c/g, 'v') + '\n'));
        expect((await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN)).status).toBe(413);
    });

    test('the whole file the preview already read is not requested again', async () => {
        const row = base({ id: 'csv-1' });
        queries.getResourceById.mockResolvedValue(row);
        csvDownload.downloadHead.mockResolvedValueOnce(csv('Ward,Count\nA,3\n'));
        expect((await request(app).get('/web-api/v1/resources/csv-1/preview')).status).toBe(200);
        expect(csvPreview.completeHeadFor(row)).toMatchObject({ complete: true });
        const res = await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN);
        expect(res.status).toBe(200);
        expect(res.body.data.rows).toEqual([['1', 'A', '3']]);
        expect(csvDownload.downloadHead).toHaveBeenCalledTimes(1);
    });

    test('a publisher failure is reported like the preview does', async () => {
        queries.getResourceById.mockResolvedValue(base({ id: 'csv-1' }));
        csvDownload.downloadHead.mockRejectedValue(Object.assign(new Error('stalled'), { code: 'DOWNLOAD_RESPONSE_STALL' }));
        const res = await request(app).get(rowsUrl('csv-1')).set(SAME_ORIGIN);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('PREVIEW_TIMEOUT');
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('at most two tables are built at once; the next waits with Retry-After', async () => {
        const pending = [];
        csvDownload.downloadHead.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
        queries.getResourceById.mockImplementation(async id => base({ id, url: 'https://example.org/' + id + '.csv' }));
        const first = request(app).get(rowsUrl('a')).set(SAME_ORIGIN).then(res => res);
        const second = request(app).get(rowsUrl('b')).set(SAME_ORIGIN).then(res => res);
        for (let tries = 0; pending.length < 2 && tries < 400; tries += 1) await new Promise(resolve => setTimeout(resolve, 5));
        expect(pending).toHaveLength(2);
        const third = await request(app).get(rowsUrl('c')).set(SAME_ORIGIN);
        expect(third.status).toBe(503);
        expect(third.body.code).toBe('ROWS_BUSY');
        expect(third.headers['retry-after']).toBe('5');
        pending.forEach(resolve => resolve(csv('A\n1\n')));
        expect((await first).status).toBe(200);
        expect((await second).status).toBe(200);
    });
});

describe('the table query, read in the background', () => {
    const row = () => copy({ ingested_columns: [{ id: 'name', type: 'TEXT' }] });

    test('a website background read neither renews the copy nor counts a visit', async () => {
        queries.getResourceById.mockResolvedValue(row());
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: '1', name: 'x' }], total: 1 });
        const res = await request(app).get('/web-api/v1/resources/copy-1/query').set('X-CanQuery-Read', 'background');
        expect(res.status).toBe(200);
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
        expect(queryLog.logQueryHit).not.toHaveBeenCalled();
    });

    test('the developer API ignores the header and a plain website read still counts', async () => {
        queries.getResourceById.mockResolvedValue(row());
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: '1', name: 'x' }], total: 1 });
        await request(app).get('/api/v1/resources/copy-1/query').set('X-CanQuery-Read', 'background');
        await request(app).get('/web-api/v1/resources/copy-1/query');
        expect(store.touchLastAccessed).toHaveBeenCalledTimes(2);
        expect(queryLog.logQueryHit).toHaveBeenCalledTimes(2);
    });

    test('a filter value its column type cannot read is a 400, not a server error', async () => {
        queries.getResourceById.mockResolvedValue(copy());
        store.queryStoreTable.mockRejectedValue(Object.assign(new Error('invalid input syntax for type numeric: "abc"'), { code: '22P02' }));
        const res = await request(app).get('/web-api/v1/resources/copy-1/query').query({ filters: JSON.stringify({ amount: { op: 'gt', value: 'abc' } }) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_FILTER_VALUE');
    });
});

describe('CSV export cells', () => {
    test('dates are written as dates and timestamps in ISO UTC', async () => {
        queries.getResourceById.mockResolvedValue(copy({ ingested_columns: [{ id: 'day', type: 'DATE' }, { id: 'at', type: 'TIMESTAMPTZ' }] }));
        store.queryStoreTable.mockResolvedValueOnce({ records: [{ _id: '1', day: new Date(2024, 0, 5), at: new Date(Date.UTC(2024, 0, 5, 10, 30)) }] });
        const res = await request(app).get('/web-api/v1/resources/copy-1/query.csv');
        expect(res.status).toBe(200);
        expect(res.text).toBe('_id,day,at\n1,2024-01-05,2024-01-05T10:30:00.000Z\n');
    });
});
