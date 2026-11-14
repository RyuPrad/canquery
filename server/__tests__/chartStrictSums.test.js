// What the engine draws on its own initiative by default: counts of records,
// and tables with periods as columns. Adding a number column up over the rows
// of a long table is where its charts misled most on tables nobody had read,
// so those sums are left to the chart builder, and the answer says so.
jest.mock('../db/pool', () => ({}));
jest.mock('../db/chartQueries', () => ({ readSample: jest.fn(), runBatch: jest.fn() }));

const queries = require('../db/chartQueries');
const engine = require('../services/charts/chartEngine');
const { listCandidates, withheldSums, LONG_SUMS } = require('../services/charts/candidates');
const { samplePlan, profileSample } = require('../services/charts/profile');
const { buildTableModel } = require('../services/charts/model');
const { fakeQueries } = require('./fixtures/charts/evaluate');

const NOW = new Date('2026-11-12T00:00:00Z');
const text = id => ({ id, type: 'TEXT', original_label: id });
const integer = id => ({ id, type: 'INTEGER', original_label: id });
const date = id => ({ id, type: 'DATE', original_label: id });
const table = (columns, rows) => ({ columns, rows: rows.map((row, i) => [i + 1, ...row]) });
const range = count => Array.from({ length: count }, (_, i) => i);
const scatter = (i, span) => (i * 7919 + 4513) % span;

const tables = new Map();
let before;
beforeAll(() => {
    before = process.env.CHART_AUTO_SUMS;
    delete process.env.CHART_AUTO_SUMS;
});
afterAll(() => {
    if (before !== undefined) process.env.CHART_AUTO_SUMS = before;
});
beforeEach(() => {
    engine.clearCaches();
    tables.clear();
    const fake = fakeQueries(tables);
    queries.readSample.mockImplementation(fake.readSample);
    queries.runBatch.mockImplementation(fake.runBatch);
});
function describeOf(name, input) {
    const tableName = 'r_' + Buffer.from(name).toString('hex').slice(0, 30);
    tables.set(tableName, input);
    return { tableName, columns: input.columns, rowCount: input.rows.length, ingestedAt: '2026-01-01T00:00:00.000Z' };
}
const analyze = (name, input, options) => engine.analyzeSnapshot(describeOf(name, input), options);
async function modelOf(input) {
    const plan = samplePlan({ rowCount: input.rows.length, columns: input.columns });
    const profile = await profileSample({ columns: input.columns, rows: input.rows, plan });
    return buildTableModel(profile, { rowCount: input.rows.length, now: NOW });
}

// Admissions by year and province: a long table of figures.
function figures() {
    const rows = [];
    [2019, 2020, 2021, 2022, 2023].forEach((year, y) => ['Ontario', 'Quebec', 'Alberta', 'Manitoba'].forEach((province, p) => {
        rows.push([String(year), province, String(1000 + y * 120 + p * 310)]);
    }));
    return table([integer('Year'), text('Province'), integer('Number of admissions')], rows);
}
// Contracts, one per row: a list of records with an amount.
function records() {
    const rows = range(240).map(i => ['C-' + (1000 + i), ['Goods', 'Services', 'Construction'][i % 7 < 3 ? 0 : i % 7 < 6 ? 1 : 2],
        (2019 + (i % 5)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), String(5000 + scatter(i, 90000))]);
    return table([text('Contract'), text('Commodity type'), date('Award date'), integer('Contract amount')], rows);
}
// Sectors by year: periods as columns.
function wide() {
    const years = ['2015', '2016', '2017', '2018', '2019'];
    const sectors = ['Manufacturing', 'Professional services', 'Information', 'Wholesale trade', 'Mining', 'Finance', 'Construction', 'Retail trade'];
    return table([text('Sector'), ...years.map(text)], sectors.map((sector, i) => [sector, ...years.map((_, y) => String(500 + i * 200 + y * 30))]));
}

describe('by default the engine adds figures up only in tables with periods as columns', () => {
    test('a long table of figures gets no chart of its own, and the answer says its sums were left to the builder', async () => {
        const input = figures();
        const model = await modelOf(input);
        // What it would draw if told to add long tables up, and what it lists by default.
        expect(listCandidates(model, { sums: 'all' }).some(spec => LONG_SUMS.has(spec.template))).toBe(true);
        expect(listCandidates(model, { sums: 'wide' })).toEqual([]);
        expect(withheldSums(model)).toBe(true);
        const analysis = await analyze('strict-figures', input);
        expect(analysis.engine).toBe(3);
        expect(analysis).toMatchObject({ status: 'no_charts', charts: [], blocked: [], sums_withheld: true });
        // The builder opens on the sum it would have drawn first: the reader's to accept or change.
        expect(analysis.builder.default).toEqual({ kind: 'line', x: { time: 't:Year', grain: 'year' }, y: { agg: 'sum', column: 'Number of admissions' }, limit: 60 });
    });

    test('the builder still adds them up when asked', async () => {
        const asked = await engine.customChart(describeOf('strict-builder', figures()), { x: { column: 'Province' }, y: { agg: 'sum', column: 'Number of admissions' } });
        expect(asked.chart.points.map(point => point.label)).toEqual(['Alberta', 'Quebec', 'Ontario', 'Manitoba'].sort((a, b) =>
            ['Manitoba', 'Alberta', 'Quebec', 'Ontario'].indexOf(a) - ['Manitoba', 'Alberta', 'Quebec', 'Ontario'].indexOf(b)));
        expect(asked.chart.y).toMatchObject({ agg: 'sum', column: 'Number of admissions' });
    });

    test('a list of records keeps its counts; its amounts are not added up', async () => {
        const analysis = await analyze('strict-records', records());
        expect(analysis.charts.length).toBeGreaterThan(0);
        expect(analysis.charts.every(chart => chart.y.agg === 'count')).toBe(true);
        expect(analysis.sums_withheld).toBe(true);
        expect(analysis.kpis.some(kpi => kpi.role === 'sum')).toBe(false);
        expect(analysis.builder.default.y).toEqual({ agg: 'sum', column: 'Contract amount' });
    });

    test('a table with periods as columns keeps its line and its ranking', async () => {
        const analysis = await analyze('strict-wide', wide());
        expect(analysis.charts.map(chart => chart.template).sort()).toEqual(['wide_top_rows_latest', 'wide_totals_per_period']);
        expect(analysis.sums_withheld).toBe(false);
    });

    test('a table with nothing to add up has nothing withheld', async () => {
        const rows = range(90).map(i => ['Site ' + i, ['Park', 'Arena', 'Library'][i % 3], ['North', 'South'][i % 2]]);
        const analysis = await analyze('strict-none', table([text('Name'), text('Kind'), text('District')], rows));
        expect(analysis.sums_withheld).toBe(false);
    });

    test('told to add long tables up, it draws their sums again', async () => {
        process.env.CHART_AUTO_SUMS = 'all';
        try {
            engine.clearCaches();
            const analysis = await analyze('all-figures', figures());
            expect(analysis.charts.some(chart => chart.y.agg === 'sum')).toBe(true);
            expect(analysis.sums_withheld).toBe(false);
        } finally {
            delete process.env.CHART_AUTO_SUMS;
        }
    });

    test('in a table with periods as columns, rows nested in one another are offered one at a time, once for the table', async () => {
        const years = ['2014', '2015', '2016', '2017'];
        const leaf = (i, y) => 500 + i * 370 + y * 45;
        const sum = (list, y) => list.reduce((total, i) => total + leaf(i, y), 0);
        const rows = [
            ['Seafood', ...years.map((_, y) => String(sum([0, 1, 2], y)))], ['Commercial Fishing', ...years.map((_, y) => String(leaf(0, y)))],
            ['Aquaculture', ...years.map((_, y) => String(leaf(1, y)))], ['Fish Processing', ...years.map((_, y) => String(leaf(2, y)))],
            ['Offshore Oil & Gas', ...years.map((_, y) => String(leaf(3, y)))],
            ['Transportation', ...years.map((_, y) => String(sum([4, 5], y)))], ['Marine Transportation', ...years.map((_, y) => String(leaf(4, y)))],
            ['Support Activities', ...years.map((_, y) => String(leaf(5, y)))], ['Tourism & Recreation', ...years.map((_, y) => String(leaf(6, y)))]];
        const input = table([text('Industry'), ...years.map(text)], rows);
        const analysis = await analyze('strict-nested', input);
        expect(analysis.charts).toEqual([]);
        expect(analysis.blocked).toHaveLength(1);
        expect(analysis.blocked[0]).toMatchObject({ measure: null, column: 'Industry', charts: true });
        expect(analysis.blocked[0].values.every(entry => entry.charts)).toBe(true);
    });
});
