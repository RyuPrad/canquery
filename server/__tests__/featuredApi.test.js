// The featured charts of prepared Top 100 tables: the public previews of
// GET /api/v1/insights/featured, which keep their published shape, and the
// website's chart cards. Both come from the chart engine; the table scans are
// computed by the fixture evaluator.
jest.mock('../db/catalogReadQueries', () => ({ getResourceById: jest.fn() }));
jest.mock('../db/snapshotRead', () => ({
    withSnapshot: jest.fn(async (_id, callback) => callback()),
    snapshotDb: () => require('../db/pool')
}));
jest.mock('../db/topDownloadsQueries', () => ({
    listIngestedTop: jest.fn(),
    listTopDownloads: jest.fn(),
    replaceTopDownloads: jest.fn(),
    pinResource: jest.fn(),
    prunePins: jest.fn()
}));
jest.mock('../db/storeQueries', () => ({
    ...jest.requireActual('../db/storeQueries'),
    profileStoreTable: jest.fn(),
    aggregateStoreTable: jest.fn(),
    queryStoreTable: jest.fn(),
    touchLastAccessed: jest.fn(() => Promise.resolve())
}));
jest.mock('../db/chartQueries', () => ({ readSample: jest.fn(), runBatch: jest.fn() }));
const request = require('supertest');
const fixtures = require('./fixtures/charts/tables');
const { addUpLongTables } = require('./fixtures/charts/sums');

// These tests are about what the engine does when it adds figures up in long tables too.
addUpLongTables();

const PREPARED_AT = '2026-09-29T12:00:00.000Z';
const text = id => ({ id, type: 'TEXT', original_label: id });
const integer = id => ({ id, type: 'INTEGER', original_label: id });
const date = id => ({ id, type: 'DATE', original_label: id });

// Permits: a table of things, with a status and an issue date.
function permits() {
    const statuses = [...Array(60).fill('Approved'), ...Array(30).fill('Pending'), ...Array(10).fill('Rejected')];
    const rows = statuses.map((status, i) => [i + 1, String(500000 + i * 7), status,
        new Date(Date.UTC(2019 + (i % 5), (i * 5) % 12, 1 + (i % 27))).toISOString().slice(0, 10), String(1 + (i % 4))]);
    return { columns: [integer('Permit number'), text('Status'), date('Issued'), integer('Storeys')], rows };
}

const TABLES = { permits, panel: () => fixtures.balancedPanel(12), counts: fixtures.suppressedCounts, events: fixtures.cleanEvents, codes: fixtures.codes };
const candidate = (name, extra = {}) => ({ dataset_id: 'd-' + name, title_en: 'Title ' + name, title_fr: 'Titre ' + name, resource_id: 'r-' + name, ...extra });
const tableName = name => 'r_' + Buffer.from(name).toString('hex').slice(0, 24);

let topq, catalog, snapshots, chartQueries, app, service, tables, fake;
beforeEach(() => {
    // Each test gets fresh featured and engine caches.
    jest.resetModules();
    topq = require('../db/topDownloadsQueries');
    catalog = require('../db/catalogReadQueries');
    snapshots = require('../db/snapshotRead');
    chartQueries = require('../db/chartQueries');
    service = require('../services/insightsService');
    app = require('../app');
    const { fakeQueries } = require('./fixtures/charts/evaluate');
    tables = new Map();
    fake = fakeQueries(tables);
    chartQueries.readSample.mockImplementation(fake.readSample);
    chartQueries.runBatch.mockImplementation(fake.runBatch);
});
afterEach(() => jest.restoreAllMocks());

// Candidates whose resources are prepared copies of the named fixtures.
function seed(names, extra = {}) {
    const rows = new Map();
    for (const name of names) {
        const fixture = TABLES[name.split(':')[0]]();
        tables.set(tableName(name), fixture);
        rows.set('r-' + name, { ingest_status: 'ready', table_name: tableName(name), ingested_at: PREPARED_AT, ingested_row_count: fixture.rows.length,
            ingested_columns: fixture.columns, ...extra });
    }
    topq.listIngestedTop.mockResolvedValue(names.map(name => candidate(name)));
    catalog.getResourceById.mockImplementation(async id => rows.get(id) || null);
    return rows;
}

async function fetchFeatured(lang = 'en') {
    const response = await request(app).get('/api/v1/insights/featured?lang=' + lang);
    expect(response.status).toBe(200);
    return response.body.data;
}

// The website's validator of these previews when they were introduced
// (client/src/utils/featuredCharts.js at 42559f5), frozen: every preview the
// engine projects must pass it, so older pages and the app keep reading them.
const FROZEN = (() => {
    const KINDS = ['donut', 'bars', 'line'];
    const GROUP_TYPES = ['TEXT', 'INTEGER', 'BIGINT', 'SMALLINT', 'NUMERIC', 'REAL', 'DOUBLE PRECISION', 'BOOLEAN', 'DATE', 'TIMESTAMPTZ', 'TIMESTAMP',
        'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITHOUT TIME ZONE'];
    const DATE_TYPE = /^(?:DATE|TIMESTAMPTZ|TIMESTAMP(?: WITH(?:OUT)? TIME ZONE)?)$/i;
    const FOOTNOTE = /^(?:notes?|sources?|footnotes?|nota|remarques?|commentaires?|copyright)\s*[:–—-]|^©/i;
    const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
    const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    const filled = value => typeof value === 'string' && value.trim().length > 0;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    function periodTime(key) {
        if (typeof key !== 'string') return null;
        if (/^\d{4}$/.test(key)) return Date.UTC(Number(key), 0, 1);
        const parts = key.match(ISO_DATE);
        if (!parts) return null;
        const calendar = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
        if (calendar.getUTCFullYear() !== Number(parts[1]) || calendar.getUTCMonth() !== Number(parts[2]) - 1 || calendar.getUTCDate() !== Number(parts[3])) return null;
        const time = Date.parse(key);
        return Number.isFinite(time) ? time : null;
    }
    return function isValidFeaturedChart(item) {
        if (!item || !KINDS.includes(item.kind) || !filled(item.dataset_id)) return false;
        if (!item.title || ![item.title.en, item.title.fr].some(filled)) return false;
        const { context, points } = item;
        if (!context || !Array.isArray(points) || points.length < 2) return false;
        if (!filled(context.resource_id) || !filled(context.group_by) || !filled(context.group_type) || !GROUP_TYPES.includes(context.group_type.toUpperCase())) return false;
        if (!['count', 'avg'].includes(context.agg) || (context.agg === 'count' ? context.agg_column !== null : !filled(context.agg_column))) return false;
        if (context.bucket !== null && !['year', 'month', 'day'].includes(context.bucket)) return false;
        if (!filled(context.snapshot_at) || !SNAPSHOT_DATE.test(context.snapshot_at) || periodTime(context.snapshot_at) === null) return false;
        if (!count(context.snapshot_rows) || context.snapshot_rows < 2 || !count(context.total_groups) || !count(context.displayed_groups)) return false;
        if (context.displayed_groups !== points.length || context.total_groups < points.length || context.total_groups > context.snapshot_rows) return false;
        if (context.limited !== (context.total_groups > context.displayed_groups) || !Array.isArray(context.missing_periods)) return false;
        if (context.missing_periods.length + points.length > context.total_groups || new Set(context.missing_periods).size !== context.missing_periods.length) return false;
        if (points.some(point => !point || (point.key !== null && !filled(point.key)) || !filled(point.label) || point.label.length > 200 ||
            FOOTNOTE.test(point.label.trim()) || typeof point.value !== 'number' || !Number.isFinite(point.value))) return false;
        if (new Set(points.map(point => point.key)).size !== points.length || points.every(point => point.value === points[0].value)) return false;
        if (context.agg === 'count' && points.some(point => !count(point.value) || point.value === 0 || point.value > context.snapshot_rows)) return false;
        const total = context.agg === 'count' ? points.reduce((sum, point) => sum + point.value, 0) : null;
        if (total !== null && (total > context.snapshot_rows || (!context.limited && total !== context.snapshot_rows))) return false;
        if (item.kind === 'line') {
            if (points.length > 30 || points.some(point => point.key === null) || context.group_type.toUpperCase() === 'BOOLEAN') return false;
            if (context.bucket !== null && !DATE_TYPE.test(context.group_type)) return false;
            const times = points.map(point => periodTime(point.key));
            if (times.some(time => time === null) || times.some((time, index) => index > 0 && time <= times[index - 1])) return false;
            if (context.missing_periods.some(key => periodTime(key) === null || points.some(point => point.key === key))) return false;
            const allTimes = [...times, ...context.missing_periods.map(periodTime)];
            return new Set(allTimes).size === allTimes.length;
        }
        if (context.agg !== 'count' || context.bucket !== null || DATE_TYPE.test(context.group_type) || context.missing_periods.length > 0) return false;
        if (points.some(point => point.key === null && !['Not recorded', 'Non renseigné'].includes(point.label))) return false;
        if (item.kind === 'donut') return points.length <= 6 && !context.limited && total > 0;
        return points.length <= 5;
    };
})();

describe('GET /api/v1/insights/featured', () => {
    it('keeps the published shape: a count of records by one column', async () => {
        seed(['permits']);
        const items = await fetchFeatured();
        expect(items).toEqual([{
            dataset_id: 'd-permits', title: { en: 'Title permits', fr: 'Titre permits' }, kind: 'donut',
            points: [
                { key: 'Approved', label: 'Approved', value: 60 },
                { key: 'Pending', label: 'Pending', value: 30 },
                { key: 'Rejected', label: 'Rejected', value: 10 }
            ],
            context: {
                resource_id: 'r-permits', group_by: 'Status', agg: 'count', agg_column: null, bucket: null, group_type: 'TEXT',
                snapshot_at: PREPARED_AT, snapshot_rows: 100, total_groups: 3, displayed_groups: 3, limited: false, missing_periods: []
            }
        }]);
        expect(FROZEN(items[0])).toBe(true);
    });

    it('records counted over the years of a date column are a line, keyed by the first day of each year', async () => {
        seed(['events']);
        const [item] = await fetchFeatured();
        expect(item).toMatchObject({ kind: 'line', context: { group_by: 'Incorporation date', agg: 'count', agg_column: null, bucket: 'year', group_type: 'DATE' } });
        expect(item.points.every(point => /^\d{4}-01-01T00:00:00\.000Z$/.test(point.key))).toBe(true);
        expect(FROZEN(item)).toBe(true);
    });

    it('a table of rates has neither a preview nor a card: an average of rows that are figures says little', async () => {
        seed(['panel']);
        expect(await fetchFeatured()).toEqual([]);
        expect(await service.cards('en')).toEqual([]);
    });

    it('sums have no place in the published shape, so a table of totals has no preview, but it has a card', async () => {
        seed(['counts']);
        expect(await fetchFeatured()).toEqual([]);
        const [card] = await service.cards('en');
        expect(card.chart).toMatchObject({ y: { agg: 'sum', column: 'TOTAL', lower_bound: true }, fit: { card: true } });
    });

    it('every preview passes the website\'s old validator', async () => {
        seed(Object.keys(TABLES));
        const items = await fetchFeatured();
        expect(items.length).toBeGreaterThanOrEqual(2);
        for (const item of items) expect([item.dataset_id, FROZEN(item)]).toEqual([item.dataset_id, true]);
        for (const item of await fetchFeatured('fr')) expect(FROZEN(item)).toBe(true);
    });

    it('reads the current snapshot under the reader lock instead of trusting the candidate list', async () => {
        const rows = seed(['permits']);
        // Replaced between the list and the lock.
        tables.set('r_replaced', permits());
        catalog.getResourceById.mockImplementationOnce(async () => rows.get('r-permits'))
            .mockImplementationOnce(async () => ({ ...rows.get('r-permits'), table_name: 'r_replaced' }));
        expect(await fetchFeatured()).toHaveLength(1);
        expect(snapshots.withSnapshot).toHaveBeenCalledWith('r-permits', expect.any(Function));
        expect(chartQueries.readSample).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'r_replaced' }), expect.any(Object));
        expect(chartQueries.runBatch.mock.calls.every(([plan]) => plan.tableName === 'r_replaced')).toBe(true);
    });

    it('skips vanished, failed and evicted snapshots without reading them', async () => {
        seed(['permits', 'panel', 'counts']);
        catalog.getResourceById.mockImplementation(async id => (id === 'r-permits' ? null : id === 'r-panel' ? { ingest_status: 'failed' } : { ingest_status: 'ready' }));
        expect(await fetchFeatured()).toEqual([]);
        expect(chartQueries.readSample).not.toHaveBeenCalled();
        expect(chartQueries.runBatch).not.toHaveBeenCalled();
    });

    it('skips a table that cannot be charted now and keeps the others', async () => {
        seed(['permits', 'events']);
        chartQueries.readSample.mockRejectedValueOnce(new Error('snapshot unavailable'));
        const items = await fetchFeatured();
        expect(items.map(item => item.dataset_id)).toEqual(['d-events']);
    });

    it('bounds the scan to 24 tables and keeps at most 12 previews and 12 cards', async () => {
        const names = Array.from({ length: 30 }, (_, i) => 'permits:' + i);
        seed(names);
        expect(await fetchFeatured()).toHaveLength(12);
        expect(await service.cards('en')).toHaveLength(12);
        expect(topq.listIngestedTop).toHaveBeenCalledWith(24, 'en');
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(12);
    });

    it('caches by language; a second language reuses the charts the engine already chose', async () => {
        seed(['permits']);
        const first = await fetchFeatured();
        const reads = chartQueries.runBatch.mock.calls.length;
        expect(await fetchFeatured()).toEqual(first);
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(1);
        await fetchFeatured('fr');
        expect(topq.listIngestedTop).toHaveBeenCalledWith(24, 'fr');
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(2);
        expect(chartQueries.runBatch.mock.calls.length).toBe(reads);
        expect(chartQueries.readSample).toHaveBeenCalledTimes(1);
    });

    it('labels the blank group in the reader\'s language', async () => {
        const fixture = permits();
        fixture.rows.forEach((row, i) => { if (i % 10 === 9) row[2] = ''; });
        seed(['permits']);
        tables.set(tableName('permits'), fixture);
        const [en] = await service.featured('en');
        const [fr] = await service.featured('fr');
        expect(en.points.find(point => point.key === null).label).toBe('Not recorded');
        expect(fr.points.find(point => point.key === null).label).toBe('Non renseigné');
        expect(FROZEN(en) && FROZEN(fr)).toBe(true);
    });

    it('returns nothing when no representative is prepared', async () => {
        topq.listIngestedTop.mockResolvedValue([]);
        expect(await fetchFeatured('fr')).toEqual([]);
        expect(snapshots.withSnapshot).not.toHaveBeenCalled();
    });
});

describe('GET /web-api/v1/insights/charts', () => {
    it('answers the website with the engine\'s best card-sized chart of each table, and nothing to the developer API', async () => {
        seed(['permits', 'counts']);
        const res = await request(app).get('/web-api/v1/insights/charts?lang=fr');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        expect(res.body.data.map(card => card.dataset_id)).toEqual(['d-permits', 'd-counts']);
        const [card] = res.body.data;
        expect(Object.keys(card)).toEqual(['dataset_id', 'title', 'resource_id', 'snapshot_at', 'rows', 'kpis', 'chart']);
        expect(card).toMatchObject({ title: { en: 'Title permits', fr: 'Titre permits' }, resource_id: 'r-permits', snapshot_at: PREPARED_AT, rows: 100 });
        expect(card.chart.fit.card).toBe(true);
        expect(card.kpis.length).toBeLessThanOrEqual(3);
        expect((await request(app).get('/api/v1/insights/charts')).status).toBe(404);
        // The shared insights routes still answer under the website's prefix.
        expect((await request(app).get('/web-api/v1/insights/featured')).status).toBe(200);
    });

    it('neither renews a copy nor counts a visit', async () => {
        seed(['permits']);
        await request(app).get('/web-api/v1/insights/charts');
        expect(require('../db/storeQueries').touchLastAccessed).not.toHaveBeenCalled();
    });

    it('a visitor who starts the shared work cannot cut it short for everyone', async () => {
        seed(['permits', 'counts']);
        const { runWithRequestSignal } = require('../utils/requestContext');
        const gone = new AbortController();
        gone.abort(new Error('The visitor left'));
        // A cold cache: the request that asks first runs the work, inside its own context.
        const cards = await runWithRequestSignal(gone.signal, () => service.cards('en'));
        expect(cards.map(card => card.dataset_id)).toEqual(['d-permits', 'd-counts']);
        // And what was cached is the whole answer.
        expect((await service.cards('en')).map(card => card.dataset_id)).toEqual(['d-permits', 'd-counts']);
    });

    it('a table replaced between the first look and the lock is scanned with a slot, not while holding the lock', async () => {
        const rows = seed(['permits']);
        const engine = require('../services/charts/chartEngine');
        const acquire = jest.spyOn(engine, 'acquireSlot');
        // Warm the engine on this copy, then let the copy change under the lock.
        expect((await service.cards('en')).length).toBe(1);
        acquire.mockClear();
        let looks = 0;
        const replaced = { ...rows.get('r-permits'), table_name: tableName('permits:2'), ingested_at: '2026-09-30T12:00:00.000Z' };
        tables.set(tableName('permits:2'), TABLES.permits());
        catalog.getResourceById.mockImplementation(async () => (++looks === 1 ? rows.get('r-permits') : replaced));
        await service.refreshFeatured('en');
        // The first look found it warm; under the lock it was not, so the lock was let go and a slot taken first.
        expect(acquire).toHaveBeenCalledTimes(1);
        expect((await service.cards('en'))[0].snapshot_at).toBe('2026-09-30T12:00:00.000Z');
    });
});

describe('pure featured preview builder', () => {
    it('stays available, with the same output, to the hosted social pool until it moves to the engine', () => {
        const profile = { rowCount: 100, columns: [{ id: 'status', type: 'TEXT', distinct: 3, nulls: 0 }, { id: 'amount', type: 'NUMERIC', distinct: 80, nulls: 0, avg: 5, min: 1, max: 9 }] };
        const spec = require('../services/featuredChart').pickChartSpec({ row_count: profile.rowCount, columns: profile.columns });
        const item = service.buildFeaturedPreview({
            candidate: { dataset_id: 'd1', title_en: 'Grants', title_fr: 'Subventions', resource_id: 'r1' }, current: { ingested_at: PREPARED_AT },
            profile, spec, aggregate: { records: [{ key: 'Approved', value: '60' }, { key: 'Pending', value: '30' }, { key: 'Rejected', value: '10' }], total: 3 },
            lang: 'en'
        });
        expect(item.points[0]).toEqual({ key: 'Approved', label: 'Approved', value: 60 });
        expect(item.context.snapshot_at).toBe(PREPARED_AT);
        expect(FROZEN(item)).toBe(true);
        expect(snapshots.withSnapshot).not.toHaveBeenCalled();
    });
});

describe('startFeaturedWarming', () => {
    const flush = async () => {
        for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    };

    it('builds both languages as soon as it starts, so the first request is served from cache', async () => {
        seed(['permits']);
        const stop = service.startFeaturedWarming({ intervalMs: 60 * 60 * 1000 });
        try {
            for (let i = 0; i < 20 && topq.listIngestedTop.mock.calls.length < 2; i++) await flush();
            await flush();
            expect(topq.listIngestedTop.mock.calls.map(([, lang]) => lang)).toEqual(['en', 'fr']);
            const res = await request(app).get('/api/v1/insights/featured?lang=fr');
            expect(res.body.data.map(item => item.dataset_id)).toEqual(['d-permits']);
            expect(topq.listIngestedTop).toHaveBeenCalledTimes(2);
        } finally {
            stop();
        }
    });

    it('a refresh replaces the cached charts while requests keep the previous ones', async () => {
        seed(['permits', 'events']);
        topq.listIngestedTop.mockResolvedValueOnce([candidate('permits')]);
        expect(await service.featured('en')).toHaveLength(1);
        let release;
        topq.listIngestedTop.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const refreshed = service.refreshFeatured('en');
        await flush();
        expect(await service.featured('en')).toHaveLength(1);
        release([candidate('permits'), candidate('events')]);
        expect(await refreshed).toHaveLength(2);
        expect(await service.featured('en')).toHaveLength(2);
        expect(await service.cards('en')).toHaveLength(2);
    });

    it('a failed refresh keeps the previous charts and never throws', async () => {
        seed(['permits']);
        await service.featured('en');
        topq.listIngestedTop.mockRejectedValueOnce(new Error('db down'));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(service.refreshFeatured('en')).resolves.toBeNull();
        expect(console.warn).toHaveBeenCalledWith('[insights-featured] refresh failed');
        expect(await service.featured('en')).toHaveLength(1);
    });
});
