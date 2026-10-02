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
    profileStoreTable: jest.fn(),
    aggregateStoreTable: jest.fn(),
    queryStoreTable: jest.fn(),
    touchLastAccessed: jest.fn(() => Promise.resolve()),
    TABLE_NAME_RE: /^r_[0-9a-f_]+$/
}));
const request = require('supertest');

const PREPARED_AT = '2026-09-29T12:00:00.000Z';
const candidate = (extra = {}) => ({ dataset_id: 'd1', title_en: 'Grants', title_fr: 'Subventions', resource_id: 'r1', ...extra });
const categoryProfile = (extra = {}) => ({ rowCount: 100, columns: [
    { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
    { id: 'amount', type: 'NUMERIC', distinct: 80, nulls: 0, avg: 5, min: 1, max: 9 }
], ...extra });
const timeProfile = (extra = {}) => ({ rowCount: 100, columns: [
    { id: 'Year', type: 'INTEGER', distinct: 3, nulls: 0, min: 2023, max: 2025 },
    { id: 'temperature_departure', type: 'NUMERIC', distinct: 20, nulls: 0, min: -2, max: 3 }
], ...extra });
const categoricalAggregate = () => ({ records: [
    { key: 'Approved', value: '60' }, { key: 'Pending', value: '30' }, { key: 'Rejected', value: '10' }
], total: 3 });
const timeAggregate = () => ({ records: [
    { key: 2025, value: '2.5' }, { key: 2024, value: '0' }, { key: 2023, value: '-1.25' }
], total: 3 });

let topq, store, catalog, snapshots, app, service;
beforeEach(() => {
    // Each test gets a real, independent language-keyed featured cache.
    jest.resetModules();
    topq = require('../db/topDownloadsQueries');
    store = require('../db/storeQueries');
    catalog = require('../db/catalogReadQueries');
    snapshots = require('../db/snapshotRead');
    service = require('../services/insightsService');
    app = require('../app');
});
afterEach(() => jest.restoreAllMocks());

function seed(profile = categoryProfile(), aggregate = categoricalAggregate(), candidates = [candidate()]) {
    topq.listIngestedTop.mockResolvedValue(candidates);
    catalog.getResourceById.mockResolvedValue({
        ingest_status: 'ready', table_name: 'r_aaa', ingested_at: PREPARED_AT,
        ingested_columns: profile.columns.map(({ id, type }) => ({ id, type }))
    });
    store.profileStoreTable.mockResolvedValue(profile);
    store.aggregateStoreTable.mockResolvedValue(aggregate);
}

async function fetchFeatured(lang = 'en') {
    const response = await request(app).get('/api/v1/insights/featured?lang=' + lang);
    expect(response.status).toBe(200);
    return response.body.data;
}

describe('GET /api/v1/insights/featured', () => {
    it('preserves the existing chart fields and adds exact snapshot/grouping context', async () => {
        seed();
        const items = await fetchFeatured();
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            dataset_id: 'd1', title: { en: 'Grants', fr: 'Subventions' }, kind: 'donut',
            points: [
                { key: 'Approved', label: 'Approved', value: 60 },
                { key: 'Pending', label: 'Pending', value: 30 },
                { key: 'Rejected', label: 'Rejected', value: 10 }
            ],
            context: {
                resource_id: 'r1', group_by: 'status', agg: 'count', agg_column: null, bucket: null,
                group_type: 'TEXT', snapshot_at: PREPARED_AT, snapshot_rows: 100,
                total_groups: 3, displayed_groups: 3, limited: false, missing_periods: []
            }
        });
        expect(topq.listIngestedTop).toHaveBeenCalledWith(24, 'en');
        expect(snapshots.withSnapshot).toHaveBeenCalledWith('r1', expect.any(Function));
        expect(store.aggregateStoreTable).toHaveBeenCalledWith({
            tableName: 'r_aaa', knownColumns: ['status', 'amount'], q: undefined, filters: [],
            groupBy: 'status', agg: 'count', aggColumn: null, bucket: null,
            sortSql: '"value" DESC', limit: 7, offset: 0
        });
        expect(store.queryStoreTable).not.toHaveBeenCalled();
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
    });

    it.each([['en', 'Not recorded'], ['fr', 'Non renseigné']])('includes the real NULL category in a complete %s donut', async (lang, nullLabel) => {
            seed(categoryProfile({ columns: [{ id: 'status', type: 'TEXT', distinct: 2, nulls: 10 }] }), {
                total: 3, records: [
                    { key: 'Approved', value: 60 }, { key: 'Pending', value: 30 }, { key: null, value: 10 }
                ]
            });
            const [item] = await fetchFeatured(lang);
            expect(item.kind).toBe('donut');
            expect(item.points[2]).toEqual({ key: null, label: nullLabel, value: 10 });
            expect(item.context).toMatchObject({ total_groups: 3, displayed_groups: 3, limited: false });
            expect(topq.listIngestedTop).toHaveBeenCalledWith(24, lang);
        });

    it('falls back to five bars when six named categories plus NULL do not fit a donut', async () => {
        seed(categoryProfile({ columns: [{ id: 'status', type: 'TEXT', distinct: 6, nulls: 2 }] }), {
            total: 7, records: [40, 25, 15, 10, 5, 3, 2].map((value, index) => ({
                key: index === 6 ? null : ['Approved', 'Pending', 'Rejected', 'Review', 'Cancelled', 'Withdrawn'][index], value
            }))
        });
        const [item] = await fetchFeatured();
        expect(item.kind).toBe('bars');
        expect(item.points.map(point => point.value)).toEqual([40, 25, 15, 10, 5]);
        expect(item.context).toMatchObject({ total_groups: 7, displayed_groups: 5, limited: true });
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(1);
    });

    it('discloses partial categorical coverage and reuses the same aggregate', async () => {
        seed(categoryProfile({ columns: [{ id: 'status', type: 'TEXT', distinct: 4, nulls: 0 }] }), {
            total: 8, records: [50, 20, 10, 5, 4, 3, 2].map((value, index) => ({ key: 'Category ' + String.fromCharCode(65 + index), value }))
        });
        const [item] = await fetchFeatured();
        expect(item.kind).toBe('bars');
        expect(item.points).toHaveLength(5);
        expect(item.context).toMatchObject({ total_groups: 8, displayed_groups: 5, limited: true });
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(1);
    });

    it('can display a NULL category among the top five limited bars', async () => {
        seed(categoryProfile({ columns: [{ id: 'status', type: 'TEXT', distinct: 10, nulls: 30 }] }), {
            total: 11, records: [
                { key: null, value: 30 }, { key: 'Approved', value: 20 }, { key: 'Pending', value: 10 },
                { key: 'Rejected', value: 8 }, { key: 'Cancelled', value: 7 }
            ]
        });
        const [item] = await fetchFeatured();
        expect(item.kind).toBe('bars');
        expect(item.points[0]).toEqual({ key: null, label: 'Not recorded', value: 30 });
        expect(item.context.limited).toBe(true);
    });

    it('keeps full readable category labels rather than truncating the chart meaning', async () => {
        const label = 'Canadian federal assistance for community infrastructure projects';
        const rawKey = '  ' + label.replace(' assistance ', '\n\tassistance  ') + '  ';
        seed(categoryProfile({ rowCount: 500, columns: [{ id: 'department', type: 'TEXT', distinct: 10, nulls: 0 }] }), {
            total: 10, records: [
                { key: rawKey, value: 200 }, { key: 'Health and social programmes', value: 100 },
                { key: 'Research and development programmes', value: 60 },
                { key: 'Transport infrastructure programmes', value: 40 }, { key: 'Education and training programmes', value: 25 }
            ]
        });
        const [item] = await fetchFeatured();
        expect(item.points[0]).toEqual({ key: rawKey, label, value: 200 });
        expect(item.context).toMatchObject({ total_groups: 10, displayed_groups: 5, limited: true });
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    });

    it('does not chart the flat study-permit category preview or its footnote', async () => {
        seed(categoryProfile({ rowCount: 179, columns: [{ id: 'Province', type: 'TEXT', distinct: 25, nulls: 0 }] }), {
            total: 25, records: [
                'Alberta Total', 'British Columbia Total', 'For further information, please contact the publisher',
                'Manitoba Total', 'New Brunswick Total'
            ].map(key => ({ key, value: 1 }))
        }, [candidate({ dataset_id: '90115b00-f9b8-49e8-afa3-b4cff8facaee' })]);
        expect(await fetchFeatured()).toEqual([]);
    });

    it.each([
        ['all-one', [1, 1, 1]], ['equal counts', [20, 20, 20]],
        ['zero count', [70, 30, 0]], ['negative count', [71, 30, -1]],
        ['null count', [60, 30, null]], ['empty count', [60, 30, '']],
        ['fractional count', [60, 30, 1.5]], ['nonfinite count', [60, 30, Infinity]],
        ['counts above snapshot rows', [80, 30, 10]], ['incomplete complete split', [40, 30, 10]]
    ])('omits misleading categorical values: %s', async (_name, values) => {
        seed(categoryProfile(), { total: 3, records: values.map((value, index) => ({ key: ['Approved', 'Pending', 'Rejected'][index], value })) });
        expect(await fetchFeatured()).toEqual([]);
    });

    it.each([
        'For further information, contact us', 'Note: provisional values', 'Source: original publication',
        'Pour plus de renseignements, contactez-nous', 'status', 'N/A', 'Not applicable', '---', '  ', '12345', 'x'.repeat(201)
    ])('omits an ambiguous/header/footnote category: %s', async label => {
        seed(categoryProfile(), { total: 3, records: [
            { key: 'Approved', value: 60 }, { key: 'Pending', value: 30 }, { key: label, value: 10 }
        ] });
        expect(await fetchFeatured()).toEqual([]);
    });

    it('rejects duplicate visible category labels after whitespace cleanup', async () => {
        seed(categoryProfile(), { total: 3, records: [
            { key: 'Approved', value: 60 }, { key: '  approved  ', value: 30 }, { key: 'Pending', value: 10 }
        ] });
        expect(await fetchFeatured()).toEqual([]);
    });

    it('omits identifier-like unique categories before running an aggregate', async () => {
        seed(categoryProfile({ rowCount: 10, columns: [{ id: 'Category', type: 'TEXT', distinct: 10, nulls: 0 }] }));
        expect(await fetchFeatured()).toEqual([]);
        expect(store.aggregateStoreTable).not.toHaveBeenCalled();
    });

    it('keeps genuine zero and signed values in a named average time series', async () => {
        seed(timeProfile(), timeAggregate());
        const [item] = await fetchFeatured();
        expect(item.kind).toBe('line');
        expect(item.points).toEqual([
            { key: '2023', label: '2023', value: -1.25 },
            { key: '2024', label: '2024', value: 0 },
            { key: '2025', label: '2025', value: 2.5 }
        ]);
        expect(item.context).toMatchObject({ group_by: 'Year', agg: 'avg', agg_column: 'temperature_departure', group_type: 'INTEGER', missing_periods: [] });
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({
            groupBy: 'Year', agg: 'avg', aggColumn: 'temperature_departure', limit: 30, sortSql: '"key" DESC NULLS LAST'
        }));
    });

    it('reports null, blank and nonfinite dated metrics as gaps without converting them to zero', async () => {
        seed(timeProfile({ columns: [
            { id: 'Year', type: 'INTEGER', distinct: 7, nulls: 0 },
            { id: 'temperature_departure', type: 'NUMERIC', distinct: 20, nulls: 10 }
        ] }), { total: 7, records: [
            { key: 2026, value: null }, { key: 2025, value: '  ' },
            { key: 2024, value: 'Infinity' }, { key: 2023, value: NaN },
            { key: 2022, value: 0 }, { key: 2021, value: -1.25 }, { key: 2020, value: 0.125 }
        ] });
        const [item] = await fetchFeatured();
        expect(item.points.map(point => point.value)).toEqual([0.125, -1.25, 0]);
        expect(item.context).toMatchObject({
            total_groups: 7, displayed_groups: 3, limited: true,
            missing_periods: ['2023', '2024', '2025', '2026']
        });
    });

    it('normalizes typed period keys to ISO and keeps only known missing periods in the window', async () => {
        seed(timeProfile({ columns: [
            { id: 'Observation Date', type: 'DATE', distinct: 4, nulls: 0 },
            { id: 'Temperature Departure', type: 'NUMERIC', distinct: 10, nulls: 10 }
        ] }), { total: 4, records: [
            { key: new Date('2026-04-01T00:00:00.000Z'), value: 1.75 },
            { key: '2026-03-01', value: null },
            { key: '2026-02-01T00:00:00.000Z', value: 0 },
            { key: '2026-01-01', value: -0.125 }
        ] });
        const [item] = await fetchFeatured();
        expect(item.points.map(point => point.key)).toEqual([
            '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'
        ]);
        expect(item.points.map(point => point.label)).toEqual(['2026-01', '2026-02', '2026-04']);
        expect(item.context).toMatchObject({ bucket: 'month', missing_periods: ['2026-03-01T00:00:00.000Z'] });
    });

    it('selects the newest 30 groups, then returns their points in chronological order', async () => {
        const latest = Array.from({ length: 30 }, (_value, index) => ({ key: 2026 - index, value: String(index + 1) }));
        seed(timeProfile({ columns: [
            { id: 'Year', type: 'INTEGER', distinct: 50, nulls: 0 },
            { id: 'temperature_departure', type: 'NUMERIC', distinct: 60, nulls: 0 }
        ] }), { total: 50, records: latest });
        const [item] = await fetchFeatured();
        expect(item.points).toHaveLength(30);
        expect(item.points[0]).toEqual({ key: '1997', label: '1997', value: 30 });
        expect(item.points[29]).toEqual({ key: '2026', label: '2026', value: 1 });
        expect(item.context).toMatchObject({ total_groups: 50, displayed_groups: 30, limited: true, missing_periods: [] });
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ limit: 30, offset: 0, sortSql: '"key" DESC NULLS LAST' }));
    });

    it.each(['unknown', '2026-02-30', '2026-02-30T00:00:00Z', '2026-13-01', '2025/26', 12])('omits a time series containing an invalid period %s', async key => {
            seed(timeProfile(), { total: 3, records: [
                { key: 2025, value: 2.5 }, { key, value: 0 }, { key: 2023, value: -1.25 }
            ] });
            expect(await fetchFeatured()).toEqual([]);
        });

    it.each([1, 0, -2])('omits a nonvarying average series with value %s', async value => {
        seed(timeProfile(), { total: 3, records: [2025, 2024, 2023].map(key => ({ key, value })) });
        expect(await fetchFeatured()).toEqual([]);
    });

    it('uses record counts rather than averaging a measure across mixed currencies', async () => {
        const profile = timeProfile();
        profile.columns.push({ id: 'Currency', type: 'TEXT', distinct: 2, nulls: 0 });
        seed(profile, { total: 3, records: [
            { key: 2025, value: 60 }, { key: 2024, value: 30 }, { key: 2023, value: 10 }
        ] });
        const [item] = await fetchFeatured();
        expect(item.context).toMatchObject({ agg: 'count', agg_column: null });
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ agg: 'count', aggColumn: null }));
    });

    it.each(['Currency', 'Units'])('keeps counts when a recorded %s field falls beyond the 60-column profile', async id => {
        const profile = timeProfile();
        profile.columns.push(...Array.from({ length: 58 }, (_value, index) => ({
            id: 'Unpopulated field ' + index, type: 'TEXT', distinct: 0, nulls: 100
        })));
        seed(profile, { total: 3, records: [
            { key: 2025, value: 60 }, { key: 2024, value: 30 }, { key: 2023, value: 10 }
        ] });
        const recorded = [...profile.columns.map(({ id, type }) => ({ id, type })), { id, type: 'TEXT' }];
        catalog.getResourceById.mockResolvedValue({
            ingest_status: 'ready', table_name: 'r_aaa', ingested_at: PREPARED_AT, ingested_columns: recorded
        });
        const [item] = await fetchFeatured();
        expect(recorded).toHaveLength(61);
        expect(item.context).toMatchObject({ agg: 'count', agg_column: null });
        expect(store.profileStoreTable).toHaveBeenCalledTimes(1);
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(1);
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ agg: 'count', aggColumn: null }));
    });

    it('does not invent units or meaning for an unknown numeric measure', async () => {
        seed(timeProfile({ columns: [
            { id: 'Year', type: 'INTEGER', distinct: 3, nulls: 0 },
            { id: 'value', type: 'NUMERIC', distinct: 20, nulls: 0 }
        ] }), { total: 3, records: [
            { key: 2025, value: 60 }, { key: 2024, value: 30 }, { key: 2023, value: 10 }
        ] });
        const [item] = await fetchFeatured();
        expect(item.context.agg).toBe('count');
        expect(item.context.agg_column).toBeNull();
    });

    it.each([null, '', '   ', 'not a date'])('omits a chart without an actual snapshot timestamp: %s', async ingested_at => {
        seed();
        catalog.getResourceById.mockResolvedValue({
            ingest_status: 'ready', table_name: 'r_aaa', ingested_at,
            ingested_columns: categoryProfile().columns
        });
        expect(await fetchFeatured()).toEqual([]);
    });

    it('checks the current snapshot under the reader lock instead of trusting the candidate table', async () => {
        seed();
        catalog.getResourceById.mockResolvedValue({
            ingest_status: 'ready', table_name: 'r_bbb', ingested_at: PREPARED_AT,
            ingested_columns: [{ id: 'status', type: 'TEXT' }]
        });
        expect(await fetchFeatured()).toHaveLength(1);
        expect(store.profileStoreTable).toHaveBeenCalledWith({ tableName: 'r_bbb', columns: [{ id: 'status', type: 'TEXT' }] });
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'r_bbb', knownColumns: ['status'] }));
    });

    it('skips vanished or failed snapshots without querying their rows', async () => {
        seed();
        catalog.getResourceById.mockResolvedValueOnce(null).mockResolvedValueOnce({ ingest_status: 'failed' });
        topq.listIngestedTop.mockResolvedValue([candidate(), candidate({ dataset_id: 'd2', resource_id: 'r2' })]);
        expect(await fetchFeatured()).toEqual([]);
        expect(store.profileStoreTable).not.toHaveBeenCalled();
        expect(store.aggregateStoreTable).not.toHaveBeenCalled();
    });

    it('skips a failed candidate and returns a valid one with no retry or second aggregate', async () => {
        seed();
        topq.listIngestedTop.mockResolvedValue([candidate(), candidate({ dataset_id: 'd2', resource_id: 'r2' })]);
        store.aggregateStoreTable.mockRejectedValueOnce(new Error('snapshot unavailable'));
        const items = await fetchFeatured();
        expect(items.map(item => item.dataset_id)).toEqual(['d2']);
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(2);
    });

    it('bounds the scan to 24 resources and keeps at most 12 informative previews', async () => {
        const candidates = Array.from({ length: 24 }, (_value, index) => candidate({ dataset_id: 'd' + index, resource_id: 'r' + index }));
        seed(categoryProfile(), categoricalAggregate(), candidates);
        expect(await fetchFeatured()).toHaveLength(12);
        expect(topq.listIngestedTop).toHaveBeenCalledWith(24, 'en');
        expect(store.profileStoreTable).toHaveBeenCalledTimes(12);
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(12);
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(12);
    });

    it('caches responses by language while sharing computation for the same prepared representative', async () => {
        seed();
        const first = await fetchFeatured();
        expect(await fetchFeatured()).toEqual(first);
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(1);
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(1);
        await fetchFeatured('fr');
        expect(topq.listIngestedTop).toHaveBeenCalledWith(24, 'fr');
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(1);
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(2);
        expect(catalog.getResourceById).toHaveBeenCalledTimes(2);
    });

    it('reuses immutable snapshot work after a response expires, then recomputes after 24 hours', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
        seed();
        await service.featured('en');
        clock.mockReturnValue(10 * 60 * 1000);
        topq.listIngestedTop.mockResolvedValue([candidate({ title_en: 'Updated title' })]);
        expect((await service.featured('en'))[0].title.en).toBe('Updated title');
        expect(catalog.getResourceById).toHaveBeenCalledTimes(2);
        expect(store.profileStoreTable).toHaveBeenCalledTimes(1);
        clock.mockReturnValue(24 * 60 * 60 * 1000);
        await service.featured('en');
        expect(store.profileStoreTable).toHaveBeenCalledTimes(2);
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
    });

    it.each([
        { table_name: 'r_bbb' },
        { ingested_at: '2026-10-02T00:00:00Z' },
        { ingested_columns: [{ id: 'status', type: 'TEXT' }] }
    ])('recomputes when the serving snapshot identity or schema changes: %j', async change => {
        seed();
        await service.featured('en');
        catalog.getResourceById.mockResolvedValue({
            ingest_status: 'ready', table_name: 'r_aaa', ingested_at: PREPARED_AT,
            ingested_columns: categoryProfile().columns.map(({ id, type }) => ({ id, type })), ...change
        });
        await service.featured('fr');
        expect(store.profileStoreTable).toHaveBeenCalledTimes(2);
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(2);
    });

    it('rechecks eviction under the reader lock before using cached snapshot work', async () => {
        seed();
        await service.featured('en');
        catalog.getResourceById.mockResolvedValue({ ingest_status: null });
        expect(await service.featured('fr')).toEqual([]);
        expect(store.profileStoreTable).toHaveBeenCalledTimes(1);
        expect(snapshots.withSnapshot).toHaveBeenCalledTimes(2);
    });

    it('retries failed snapshot computation instead of retaining a false unchartable result', async () => {
        seed();
        store.profileStoreTable.mockRejectedValueOnce(new Error('temporary read failure'));
        expect(await service.featured('en')).toEqual([]);
        expect(await service.featured('fr')).toHaveLength(1);
        expect(store.profileStoreTable).toHaveBeenCalledTimes(2);
    });

    it('deduplicates simultaneous language misses and localizes NULL labels afterward', async () => {
        seed(categoryProfile(), { total: 3, records: [
            { key: null, value: 60 }, { key: 'Approved', value: 30 }, { key: 'Pending', value: 10 }
        ] });
        const [en, fr] = await Promise.all([service.featured('en'), service.featured('fr')]);
        expect(en[0].points[0].label).toBe('Not recorded');
        expect(fr[0].points[0].label).toBe('Non renseigné');
        expect(store.profileStoreTable).toHaveBeenCalledTimes(1);
        expect(store.aggregateStoreTable).toHaveBeenCalledTimes(1);
    });

    it('returns no charts when no representative is prepared', async () => {
        topq.listIngestedTop.mockResolvedValue([]);
        expect(await fetchFeatured('fr')).toEqual([]);
        expect(topq.listIngestedTop).toHaveBeenCalledWith(24, 'fr');
        expect(snapshots.withSnapshot).not.toHaveBeenCalled();
    });
});

describe('pure featured preview builder', () => {
    it('uses the same validated output for isolated browser fixtures without database activity', () => {
        const profile = categoryProfile();
        const spec = require('../services/featuredChart').pickChartSpec({ row_count: profile.rowCount, columns: profile.columns });
        const item = service.buildFeaturedPreview({
            candidate: candidate(), current: { ingested_at: PREPARED_AT },
            profile, spec, aggregate: categoricalAggregate(), lang: 'en'
        });
        expect(item.points[0]).toEqual({ key: 'Approved', label: 'Approved', value: 60 });
        expect(item.context.snapshot_at).toBe(PREPARED_AT);
        expect(store.aggregateStoreTable).not.toHaveBeenCalled();
        expect(snapshots.withSnapshot).not.toHaveBeenCalled();
    });
});
