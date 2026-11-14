// The website's chart routes: what they accept, what they answer, and what a
// request does to the copy's activity. The table scan is the fixture evaluator.
jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ ...jest.requireActual('../db/storeQueries'), queryStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()) }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../db/pool', () => ({ query: jest.fn(), connect: jest.fn(), on: jest.fn(), end: jest.fn() }));
jest.mock('../db/chartQueries', () => ({ readSample: jest.fn(), runBatch: jest.fn() }));

const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const store = require('../db/storeQueries');
const queryLog = require('../db/queryLogQueries');
const chartQueries = require('../db/chartQueries');
const engine = require('../services/charts/chartEngine');
const { snapshotInfo } = require('../services/snapshotIdentity');
const { chartsLimiter, customChartLimiter } = require('../middleware/rateLimits');
const fixtures = require('./fixtures/charts/tables');
const { fakeQueries } = require('./fixtures/charts/evaluate');
const app = require('../app');
const { addUpLongTables } = require('./fixtures/charts/sums');

// These tests are about what the engine does when it adds figures up in long tables too.
addUpLongTables();

const tables = new Map();
let fake;
const base = (overrides = {}) => ({ id: 'r1', dataset_id: 'd1', url: 'https://example.org/file.csv', format: 'CSV', size_bytes: null,
    datastore_active: false, ingest_status: null, table_name: null, ingested_columns: null, ingested_row_count: null,
    last_modified: '2026-10-15T11:06:20.720Z', provenance_sources: [], raw: {}, ...overrides });
// A prepared copy holding one of the chart fixtures.
function copy(name, overrides = {}) {
    const fixture = fixtures[name]();
    const tableName = 'r_' + Buffer.from(name).toString('hex').slice(0, 30);
    tables.set(tableName, fixture);
    return base({ id: name, ingest_status: 'ready', table_name: tableName, ingested_row_count: fixture.rows.length, ingested_columns: fixture.columns,
        ingested_at: '2026-11-01T00:00:00.000Z', ...overrides });
}
const chartsUrl = id => '/web-api/v1/resources/' + id + '/charts';
const serve = row => queries.getResourceById.mockResolvedValue(row);

beforeEach(async () => {
    jest.clearAllMocks();
    for (const key of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
        await chartsLimiter.resetKey(key);
        await customChartLimiter.resetKey(key);
    }
    engine.clearCaches();
    tables.clear();
    fake = fakeQueries(tables);
    chartQueries.readSample.mockImplementation(fake.readSample);
    chartQueries.runBatch.mockImplementation(fake.runBatch);
    store.touchLastAccessed.mockImplementation(() => Promise.resolve());
});

describe('GET /web-api/v1/resources/:id/charts', () => {
    test('answers with the charts, the figures above them, how the table was read, and the snapshot they are of', async () => {
        const row = copy('cleanEvents');
        serve(row);
        const res = await request(app).get(chartsUrl('cleanEvents'));
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(Object.keys(res.body.data)).toEqual(['engine', 'status', 'kpis', 'charts', 'skipped', 'blocked', 'model', 'builder', 'scope']);
        expect(res.body.data).toMatchObject({ engine: engine.ENGINE_VERSION, status: 'ok', scope: { rows: 300, table_rows: 300, filtered: false } });
        expect(res.body.data.charts.length).toBeGreaterThan(1);
        for (const chart of res.body.data.charts) {
            expect(chart).toMatchObject({ id: expect.stringMatching(/^c_[0-9a-f]{12}$/), kind: expect.stringMatching(/^(line|bars|donut)$/), fit: { tab: true } });
            expect(Object.keys(chart)).toEqual(expect.arrayContaining(['template', 'x', 'y', 'points', 'scope', 'notes', 'title', 'spec']));
        }
        expect(res.body.data.model.columns.map(column => column.id)).toEqual(row.ingested_columns.map(column => column.id));
        expect(res.body.data.builder.default).toEqual(res.body.data.charts[0].spec);
        expect(res.body.meta).toMatchObject({ query_mode: 'ingested', snapshot: snapshotInfo(row), source: 'canquery' });
        expect(Date.parse(res.body.meta.retrieved_at)).not.toBeNaN();
    });

    test('a person\'s look renews the copy and counts once; a background read does neither', async () => {
        serve(copy('cleanEvents'));
        await request(app).get(chartsUrl('cleanEvents'));
        expect(store.touchLastAccessed).toHaveBeenCalledTimes(1);
        expect(store.touchLastAccessed).toHaveBeenCalledWith('cleanEvents', expect.stringMatching(/^r_/));
        expect(queryLog.logQueryHit).toHaveBeenCalledTimes(1);
        expect(queryLog.logQueryHit).toHaveBeenCalledWith('cleanEvents', 'ingested');
        const scans = fake.calls.batches.length;
        const again = await request(app).get(chartsUrl('cleanEvents')).set('X-CanQuery-Read', 'background');
        expect(again.status).toBe(200);
        // Computed once: the second request read nothing.
        expect(fake.calls.batches).toHaveLength(scans);
        expect(store.touchLastAccessed).toHaveBeenCalledTimes(1);
        expect(queryLog.logQueryHit).toHaveBeenCalledTimes(1);
    });

    test('follows the page: language, search and filters, the purpose and how many charts', async () => {
        serve(copy('twins'));
        const french = await request(app).get(chartsUrl('twins')).query({ lang: 'fr' });
        expect(french.body.data.charts.map(chart => chart.x.column)).toContain('FR_PROVINCE/TERRITOIRE');
        const one = await request(app).get(chartsUrl('twins')).query({ limit: 1 });
        expect(one.body.data.charts).toHaveLength(1);
        serve(copy('cleanEvents'));
        fake.options.filter = (row, columns) => row[columns.findIndex(column => column.id === 'Status') + 1] === 'Active';
        const filtered = await request(app).get(chartsUrl('cleanEvents')).query({ filters: JSON.stringify({ Status: 'Active' }), q: 'a' });
        expect(filtered.body.data.scope).toMatchObject({ filtered: true, rows: 150 });
        expect(fake.calls.batches[fake.calls.batches.length - 1].where).toMatchObject({ params: ['Active', '%a%'] });
        const card = await request(app).get(chartsUrl('cleanEvents')).query({ purpose: 'card' });
        expect(card.body.data.charts).toHaveLength(1);
        expect(card.body.data.charts[0].fit.card).toBe(true);
    });

    test('refuses what it cannot read before looking at any table', async () => {
        serve(copy('cleanEvents'));
        for (const query of [{ purpose: 'social' }, { limit: '0' }, { limit: 'many' }, { filters: '{' }, { filters: '[]' }, { q: 'x'.repeat(201) },
            { snapshot: 'yesterday' }]) {
            const res = await request(app).get(chartsUrl('cleanEvents')).query(query);
            expect([res.status, JSON.stringify(query)]).toEqual([400, JSON.stringify(query)]);
        }
        expect(queries.getResourceById).not.toHaveBeenCalled();
        const unknown = await request(app).get(chartsUrl('cleanEvents')).query({ filters: JSON.stringify({ Nope: 'x' }) });
        expect(unknown.status).toBe(400);
        expect(fake.calls.batches).toHaveLength(0);
    });

    test('a table that is not prepared drives the page\'s preparation, as the table query does', async () => {
        serve(null);
        expect((await request(app).get(chartsUrl('missing'))).status).toBe(404);
        serve(base({ id: 'file' }));
        const pending = await request(app).get(chartsUrl('file'));
        expect(pending.status).toBe(409);
        expect(pending.body.hint).toBe('POST /api/v1/resources/file/ingest');
        serve(base({ id: 'pdf', format: 'PDF', url: 'https://example.org/file.pdf' }));
        const download = await request(app).get(chartsUrl('pdf'));
        expect(download.status).toBe(422);
        serve(base({ id: 'live', datastore_active: true, raw: { source_id: 'open-canada' } }));
        expect((await request(app).get(chartsUrl('live'))).status).toBe(400);
        const row = copy('cleanEvents');
        serve(row);
        const other = await request(app).get(chartsUrl('cleanEvents')).query({ snapshot: 'cqs1_' + 'a'.repeat(64) });
        expect([other.status, other.body.code]).toEqual([409, 'SNAPSHOT_UNAVAILABLE']);
        const same = await request(app).get(chartsUrl('cleanEvents')).query({ snapshot: snapshotInfo(row).id });
        expect(same.status).toBe(200);
        expect(store.touchLastAccessed).toHaveBeenCalledTimes(1);
    });

    test('a busy engine, a scan out of time and a filter value of the wrong type each have their own answer', async () => {
        serve(copy('cleanEvents'));
        const busy = jest.spyOn(engine, 'acquireSlot').mockRejectedValueOnce(Object.assign(new (require('../utils/AppError'))('Charts are busy, try again shortly', 503),
            { publicCode: 'CHARTS_BUSY' }));
        const first = await request(app).get(chartsUrl('cleanEvents'));
        expect([first.status, first.body.code]).toEqual([503, 'CHARTS_BUSY']);
        busy.mockRestore();
        fake.options.fail = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        const slow = await request(app).get(chartsUrl('cleanEvents'));
        expect([slow.status, slow.body.code, slow.headers['retry-after']]).toEqual([503, 'CHARTS_TIMEOUT', '30']);
        fake.options.fail = null;
        engine.clearCaches();
        expect((await request(app).get(chartsUrl('cleanEvents'))).status).toBe(200);
        fake.options.fail = Object.assign(new Error('invalid input syntax for type bigint: "abc"'), { code: '22P02' });
        const typed = await request(app).get(chartsUrl('cleanEvents')).query({ filters: JSON.stringify({ 'Share capital': { op: 'gt', value: 'abc' } }) });
        expect([typed.status, typed.body.code]).toEqual([400, 'INVALID_FILTER_VALUE']);
        // Without a filter, a type error is the table's, not the reader's.
        engine.clearCaches();
        const broken = await request(app).get(chartsUrl('cleanEvents'));
        expect(broken.status).toBe(500);
        expect(store.touchLastAccessed).toHaveBeenCalledTimes(1);
    });

    test('one client may have only two scans running at once', async () => {
        serve(copy('cleanEvents'));
        fake.options.delay = 80;
        fake.options.filter = () => true;
        const results = await Promise.all([0, 1, 2].map(i => request(app).get(chartsUrl('cleanEvents')).query({ q: 'x' + i })));
        expect(results.map(res => res.status).sort()).toEqual([200, 200, 429]);
        const refused = results.find(res => res.status === 429);
        expect([refused.body.code, refused.headers['retry-after']]).toEqual(['CHARTS_BUSY', '5']);
    });

    test('is a website route: absent from the developer API, limited per minute', async () => {
        serve(copy('cleanEvents'));
        expect((await request(app).get('/api/v1/resources/cleanEvents/charts')).status).toBe(404);
        expect((await request(app).get('/api/v1/resources/cleanEvents/charts/custom')).status).toBe(404);
        const statuses = [];
        for (let i = 0; i < 31; i += 1) statuses.push((await request(app).get(chartsUrl('cleanEvents')).set('X-CanQuery-Read', 'background')).status);
        expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true);
        expect(statuses[30]).toBe(429);
    });
});

describe('GET /web-api/v1/resources/:id/charts/custom', () => {
    const custom = (id, spec, query = {}) => request(app).get(chartsUrl(id) + '/custom').query({ spec: typeof spec === 'string' ? spec : JSON.stringify(spec), ...query });

    test('computes the chart asked for, without renewing the copy or counting a visit', async () => {
        const row = copy('suppressedCounts');
        serve(row);
        const res = await custom('suppressedCounts', { kind: 'bars', x: { column: 'EN_MONTH' }, y: { agg: 'sum', column: 'TOTAL' } });
        expect(res.status).toBe(200);
        expect(res.body.data.reason).toBeNull();
        expect(res.body.data.chart).toMatchObject({ kind: 'bars', x: { type: 'category', column: 'EN_MONTH' }, y: { agg: 'sum', column: 'TOTAL', lower_bound: true } });
        expect(res.body.data.chart.points).toHaveLength(12);
        expect(res.body.meta.snapshot).toEqual(snapshotInfo(row));
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
        expect(queryLog.logQueryHit).not.toHaveBeenCalled();
    });

    test('says why when the chart cannot be drawn', async () => {
        serve(copy('measureNames'));
        const refused = await custom('measureNames', { x: { column: 'Fiscal Year' }, y: { agg: 'sum', column: 'Measure Value' } });
        expect([refused.status, refused.body.code, refused.body.hint]).toEqual([400, 'CHART_REFUSED', 'mixed_measures']);
        expect(refused.body.error).toContain('Data Point Label');
        for (const spec of ['', '{', '"x"', JSON.stringify({ x: { column: 'Nope' }, y: { agg: 'count' } }), 'x'.repeat(2001)]) {
            const res = await custom('measureNames', spec);
            expect([res.status, res.body.code]).toEqual([400, 'INVALID_CHART_SPEC']);
        }
        // A chart that the data leaves empty is an answer, not an error.
        serve(copy('cleanEvents'));
        fake.options.filter = () => false;
        const empty = await custom('cleanEvents', { x: { column: 'Status' }, y: { agg: 'count' } }, { q: 'nothing matches this' });
        expect(empty.status).toBe(200);
        expect(empty.body.data).toEqual({ chart: null, reason: 'no_groups' });
    });
});
