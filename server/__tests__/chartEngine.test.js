// The chart engine end to end on small tables, one per way publisher files
// go wrong. The table scan is computed in JavaScript (fixtures/charts/evaluate.js);
// integration/chartParity.test.cjs checks that PostgreSQL computes the same.
jest.mock('../db/pool', () => ({}));
jest.mock('../db/chartQueries', () => ({ readSample: jest.fn(), runBatch: jest.fn() }));

const queries = require('../db/chartQueries');
const engine = require('../services/charts/chartEngine');
const fixtures = require('./fixtures/charts/tables');
const { fakeQueries } = require('./fixtures/charts/evaluate');
const { addUpLongTables } = require('./fixtures/charts/sums');

// These tests are about what the engine does when it adds figures up in long tables too.
addUpLongTables();

const tables = new Map();
let fake;
const tableOf = (name, fixture = fixtures[name]()) => {
    const tableName = 'r_' + Buffer.from(name).toString('hex').slice(0, 30);
    tables.set(tableName, fixture);
    return { tableName, columns: fixture.columns, rowCount: fixture.rows.length, ingestedAt: '2026-01-01T00:00:00.000Z' };
};
const analyze = (name, options) => engine.analyzeSnapshot(tableOf(name), options);
const codes = chart => chart.notes.map(note => note.code);
const labels = chart => chart.points.map(point => (point.blank ? null : point.label ?? point.start));
const by = (analysis, template, column) => analysis.charts.find(chart => chart.template === template && (!column || chart.x.column === column));
const cell = (row, columns, id) => row[columns.findIndex(column => column.id === id) + 1];

beforeEach(() => {
    engine.clearCaches();
    tables.clear();
    fake = fakeQueries(tables);
    queries.readSample.mockImplementation(fake.readSample);
    queries.runBatch.mockImplementation(fake.runBatch);
});

describe('chart engine', () => {
    test('a measure that is text because of "--" is read, and the chart says what it left out', async () => {
        const analysis = await analyze('suppressedCounts');
        // A table of monthly figures: the provinces are compared over the
        // latest year it covers in full, which a second scan reads.
        expect(fake.calls.batches).toHaveLength(2);
        expect(fake.calls.batches[1].scope.keys).toHaveLength(12);
        const share = by(analysis, 'share_by_category');
        expect(share.x.column).toBe('EN_PROVINCE/TERRITORY');
        expect(share.period).toEqual({ grain: 'year', start: '2022-01-01' });
        expect(codes(share)).toContain('latest_period_only');
        expect(share.y).toMatchObject({ agg: 'sum', column: 'TOTAL', lower_bound: true });
        expect(share.kind).toBe('donut');
        const of2022 = fixtures.suppressedCounts().rows.filter(row => row[1] === '2022');
        expect(share.scope.rows).toBe(of2022.length);
        expect(share.points.reduce((sum, point) => sum + point.value, 0)).toBe(of2022.reduce((sum, row) => sum + (row[7] === '--' ? 0 : Number(row[7])), 0));
        expect(share.points.reduce((sum, point) => sum + point.value, 0)).toBe(share.total);
        expect(share.points.reduce((sum, point) => sum + point.share, 0)).toBeCloseTo(1);
        const left = share.notes.find(note => note.code === 'placeholders_left_out');
        expect(left).toMatchObject({ level: 'caution', column: 'TOTAL', tokens: ['--'] });
        expect(left.cells).toBe(of2022.filter(row => row[7] === '--').length);

        const line = by(analysis, 'measure_over_time');
        expect(line.x).toMatchObject({ type: 'time', grain: 'month', columns: ['EN_YEAR', 'EN_MONTH'] });
        expect(line.points).toHaveLength(48);
        expect(line.points.map(point => point.start)).toEqual(line.points.map(point => point.start).slice().sort());
        expect(codes(line)).toContain('composite_time');
        // The French columns say the same thing: never a second chart.
        expect(analysis.charts.some(chart => /^FR_/.test(chart.x.column || ''))).toBe(false);
        expect(analysis.kpis.find(kpi => kpi.role === 'sum')).toMatchObject({ column: 'TOTAL', lower_bound: true });
    });

    test('numbers written with commas, spaces, currency signs and parentheses add up to the same figures', async () => {
        const table = tableOf('numberFormats');
        const analysis = await engine.analyzeSnapshot(table);
        const total = column => analysis.kpis.find(kpi => kpi.column === column)?.value;
        expect(total('Visits')).toBe(157340);
        // Cost is Visits plus fifty cents a row: drawn once, as one chart says it all; its own figures still read.
        const cost = await engine.customChart(table, { x: { column: 'Unit' }, y: { agg: 'sum', column: 'Cost' } });
        expect(cost.chart.points.reduce((sum, point) => sum + point.value, 0)).toBe(157360);
        // A percentage is averaged, and a column whose format is a guess is not charted by itself.
        expect(analysis.charts.some(chart => chart.y.column === 'Share' && chart.y.agg === 'sum')).toBe(false);
        expect(analysis.charts.some(chart => chart.y.column === 'Guess')).toBe(false);
        expect(analysis.model.columns.find(column => column.id === 'Guess').confidence).toBe('low');
    });

    test('codes are grouped by, never added up, and "6322 - Cooks" reads "Cooks"', async () => {
        const analysis = await analyze('codes');
        const share = by(analysis, 'share_by_category', 'Occupation');
        expect(labels(share).sort()).toEqual(['Cooks', 'Food service supervisors', 'Retail managers', 'Transport truck drivers']);
        expect(codes(share)).toContain('code_prefix_hidden');
        const summed = analysis.charts.filter(chart => chart.y.agg !== 'count').map(chart => chart.y.column);
        expect(new Set(summed)).toEqual(new Set(['Positions']));
    });

    test('row numbers, keys and constants are neither grouped by nor added up', async () => {
        const analysis = await analyze('identifiers');
        const used = analysis.charts.flatMap(chart => [chart.x.column, chart.y.column]);
        for (const id of ['#', 'Corporation number', 'BN', 'Form ID', 'Notes', 'column_9']) expect(used).not.toContain(id);
        expect(by(analysis, 'records_by_category', 'Status').points.map(point => point.value)).toEqual([67, 67, 66]);
        // A ranking of individually named rows stays off cards and posts.
        const ranking = by(analysis, 'top_labels_by_measure');
        expect(ranking.x.column).toBe('Legal name');
        expect(ranking.fit).toEqual({ tab: true, card: false, social: false });
        expect(ranking.other.groups).toBe(190);
    });

    test('periods written as text are read and put in order', async () => {
        const analysis = await analyze('textPeriods');
        const line = by(analysis, 'measure_over_time');
        expect(line.kind).toBe('line');
        expect(line.points.length).toBeGreaterThanOrEqual(4);
        expect(line.points.map(point => point.start)).toEqual(line.points.map(point => point.start).slice().sort());
        expect(line.points.reduce((sum, point) => sum + point.value, 0)).toBe(analysis.kpis.find(kpi => kpi.role === 'sum').value);
    });

    test('a year column and a month column make one time axis', async () => {
        const analysis = await analyze('yearAndParts');
        const line = by(analysis, 'measure_over_time');
        expect(line.x.columns).toEqual(['Year', 'Month']);
        expect(line.time).toMatchObject({ grain: 'month', first: '2020-01-01', last: '2022-12-01', periods_shown: 36 });
    });

    test('period columns of a wide table become one series, without their total column', async () => {
        const analysis = await analyze('widePeriods');
        const series = by(analysis, 'wide_totals_per_period');
        expect(series.points).toHaveLength(12);
        expect(series.x.columns).not.toContain('2023 Total');
        expect(series.y.lower_bound).toBe(true);
        expect(codes(series)).toEqual(expect.arrayContaining(['wide_periods', 'placeholders_left_out']));
        // Rows of a wide table are not counted.
        expect(analysis.charts.some(chart => chart.y.agg === 'count')).toBe(false);
    });

    test('of two columns that say the same thing, the reader\'s language is charted', async () => {
        const english = await analyze('twins', { lang: 'en' });
        const french = await analyze('twins', { lang: 'fr' });
        const columns = analysis => analysis.charts.map(chart => chart.x.column);
        expect(columns(english)).toEqual(expect.arrayContaining(['EN_PROVINCE/TERRITORY', 'answer_e']));
        expect(columns(english)).not.toEqual(expect.arrayContaining(['FR_PROVINCE/TERRITOIRE']));
        expect(columns(french)).toEqual(expect.arrayContaining(['FR_PROVINCE/TERRITOIRE', 'answer_f']));
        // A code with a name column is charted by its name.
        expect(columns(english)).not.toContain('ER_Code');
        expect(columns(english).some(column => column === 'ER_Name')).toBe(true);
        expect(english.model.columns.find(column => column.id === 'FR_PROVINCE/TERRITOIRE').twin).toEqual({ of: 'EN_PROVINCE/TERRITORY', hidden: true });
    });

    test('notes, repeated headers, unit rows and total rows of a report are left out of every figure', async () => {
        const analysis = await analyze('reportStyle');
        expect(analysis.scope.rows).toBe(32);
        expect(analysis.scope.note_rows_left_out).toBeGreaterThan(0);
        expect(analysis.charts.length).toBeGreaterThan(0);
        for (const chart of analysis.charts) {
            // Charts of the whole table say the total row was left out; a chart
            // of the latest year never had it (it has no year).
            if (!chart.period) expect(codes(chart)).toContain('total_left_out');
            expect(labels(chart).some(label => /total|note|source/i.test(String(label)))).toBe(false);
        }
    });

    test('spellings that differ by case or padding are one group', async () => {
        const analysis = await analyze('untidyCategories');
        const share = analysis.charts.find(chart => chart.x.column === 'Stream');
        expect(labels(share).map(label => label.toLowerCase()).sort()).toEqual(expect.arrayContaining(['global talent', 'low wage']));
        expect(new Set(labels(share).map(label => label.toLowerCase())).size).toBe(share.points.length);
        expect(codes(share)).toContain('variants_merged');
    });

    test('a value column that holds a different measure on each row is not added up; the page gets the measures to choose from', async () => {
        for (const [name, column, why] of [['measureNames', 'Data Point Label', 'mixed_measures'], ['twoCurrencies', 'Currency', 'units']]) {
            const analysis = await analyze(name);
            expect(analysis.status).toBe('no_charts');
            expect(analysis.model.shape).toBe('long_measures');
            expect(analysis.blocked[0]).toMatchObject({ column, why });
            expect(analysis.blocked[0].values.length).toBeGreaterThanOrEqual(2);
        }
    });

    test('filtered to one measure, the value column is charted', async () => {
        const table = tableOf('measureNames');
        const fixture = tables.get(table.tableName);
        fake.options.filter = (row, columns) => cell(row, columns, 'Data Point Label') === 'Net income';
        const analysis = await engine.analyzeSnapshot(table, { filters: [{ column: 'Data Point Label', op: 'eq', value: 'Net income' }] });
        expect(analysis.status).toBe('ok');
        expect(analysis.scope.pinned).toEqual(['Data Point Label']);
        expect(analysis.charts.every(chart => chart.y.column === 'Measure Value' && chart.x.column !== 'Data Point Label')).toBe(true);
        expect(analysis.scope.rows).toBeLessThan(fixture.rows.length);
        expect(analysis.blocked).toEqual([]);
    });

    test('counts are added up; rates, ratios and indexes are charted only on request', async () => {
        const table = tableOf('ratesAndCounts');
        const analysis = await engine.analyzeSnapshot(table);
        const agg = column => [...new Set(analysis.charts.filter(chart => chart.y.column === column).map(chart => chart.y.agg))];
        expect(agg('Employees')).toEqual(['sum']);
        // An average of rows that are themselves rates says little on its own initiative.
        for (const column of ['Unemployment rate', 'Male ratio', 'Price index']) expect(agg(column)).toEqual([]);
        const asked = await engine.customChart(table, { x: { column: 'Sector' }, y: { agg: 'avg', column: 'Unemployment rate' } });
        expect(asked.chart.notes.map(note => note.code)).toContain('unweighted_average');
    });

    test('coordinates and links are not charted, and a table with nothing to say gets no chart', async () => {
        const analysis = await analyze('places');
        expect(analysis.status).toBe('no_charts');
        expect(analysis.charts).toEqual([]);
        expect(analysis.skipped.every(skip => typeof skip.reason === 'string')).toBe(true);
    });

    test('a clean table of events keeps its counts and its sums', async () => {
        const analysis = await analyze('cleanEvents');
        expect(analysis.model.shape).toBe('records');
        const counts = by(analysis, 'records_over_time');
        // The dates stop on 20 July 2021: that year is half a year, left out and said so.
        const cut = counts.notes.find(note => note.code === 'cut_period_left_out');
        expect(cut).toMatchObject({ start: '2021-01-01', grain: 'year', date: '2021-07-20' });
        expect(counts.points.reduce((sum, point) => sum + point.value, 0)).toBe(300 - cut.rows);
        expect(by(analysis, 'measure_over_time').y).toMatchObject({ agg: 'sum', column: 'Share capital', lower_bound: false });
        expect(analysis.charts.every(chart => chart.notes.every(note => note.level !== 'caution'))).toBe(true);
    });

    test('a column the loader could not cast is read as numbers, its stray cells counted', async () => {
        const analysis = await analyze('castFailed');
        const share = by(analysis, 'share_by_category');
        expect(share.y.column).toBe('Volume');
        expect(share.notes.find(note => note.code === 'unreadable_left_out').cells).toBe(1);
        expect(share.notes.find(note => note.code === 'placeholders_left_out').tokens).toEqual(['x']);
    });

    test('the same figures under two columns are one chart', async () => {
        const fixture = fixtures.cleanEvents();
        const index = fixture.columns.findIndex(column => column.id === 'Jurisdiction');
        // A second column with other wording for the same groups, not a plain copy.
        const copy = { columns: [...fixture.columns, { id: 'Level', type: 'TEXT', original_label: 'Level' }],
            rows: fixture.rows.map(row => [...row, 'Level of ' + row[index + 1]]) };
        const analysis = await engine.analyzeSnapshot(tableOf('copy', copy));
        const groupings = analysis.charts.filter(chart => chart.y.column === 'Share capital' && ['Jurisdiction', 'Level'].includes(chart.x.column));
        expect(groupings).toHaveLength(1);
    });

    test('charts are chosen once per snapshot: a second request reads nothing', async () => {
        const table = tableOf('cleanEvents');
        expect(engine.isWarm(table)).toBe(false);
        const first = await engine.analyzeSnapshot(table);
        const scans = fake.calls.batches.length;
        expect(engine.isWarm(table)).toBe(true);
        const second = await engine.analyzeSnapshot(table);
        expect(fake.calls.batches).toHaveLength(scans);
        expect(fake.calls.samples).toBe(1);
        expect(second.charts.map(chart => chart.id)).toEqual(first.charts.map(chart => chart.id));
        // Another purpose picks from the same computed charts.
        const cards = await engine.analyzeSnapshot(table, { purpose: 'card', limit: 1 });
        expect(fake.calls.batches).toHaveLength(scans);
        expect(cards.charts).toHaveLength(1);
        expect(cards.charts[0].fit.card).toBe(true);
    });

    test('a search keeps the chosen charts and recomputes them on the rows in scope', async () => {
        const table = tableOf('cleanEvents');
        const whole = await engine.analyzeSnapshot(table);
        fake.options.filter = (row, columns) => cell(row, columns, 'Jurisdiction') === 'Federal';
        const narrowed = await engine.analyzeSnapshot(table, { q: 'Federal' });
        expect(narrowed.charts.map(chart => chart.id).sort()).toEqual(whole.charts.map(chart => chart.id).sort());
        expect(narrowed.scope).toMatchObject({ filtered: true, rows: 100 });
        const share = narrowed.charts.find(chart => chart.x.column === 'Jurisdiction');
        // One group left: under a search the chart stays, with what is there.
        expect(labels(share)).toEqual(['Federal']);
        expect(codes(share)).toContain('filtered_scope');
        expect(narrowed.kpis[0]).toEqual({ role: 'rows', value: 100 });
    });

    test('a scan that PostgreSQL cancels is reported as a timeout to retry, and not tried again for a minute', async () => {
        fake.options.fail = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        const table = tableOf('cleanEvents');
        await expect(engine.analyzeSnapshot(table)).rejects.toMatchObject({ statusCode: 503, publicCode: 'CHARTS_TIMEOUT', retryAfter: 30 });
        fake.options.fail = null;
        const scans = fake.calls.batches.length + fake.calls.samples;
        // Every visitor would otherwise start the same long scan: answered at once, without a slot.
        expect(engine.isWarm(table)).toBe(true);
        await expect(engine.analyzeSnapshot(table)).rejects.toMatchObject({ publicCode: 'CHARTS_TIMEOUT' });
        expect(fake.calls.batches.length + fake.calls.samples).toBe(scans);
        // A minute later it is tried again, and nothing half-computed was kept.
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 61 * 1000);
        try {
            await expect(engine.analyzeSnapshot(table)).resolves.toMatchObject({ status: 'ok' });
        } finally {
            clock.mockRestore();
        }
    });

    test('a later round that runs out of time answers with what holds, not with an error', async () => {
        // "Canada" beside the provinces is found to be their total in the first
        // round; the round that would compute the charts without it runs out of time.
        const rows = [];
        for (let year = 2015; year <= 2022; year += 1) {
            const values = [400, 300, 200, 100].map((base, p) => base + p * 10 + year - 2015);
            ['Ontario', 'Quebec', 'Alberta', 'Manitoba'].forEach((province, p) => rows.push([String(year), province, String(values[p])]));
            rows.push([String(year), 'Canada', String(values.reduce((sum, value) => sum + value, 0))]);
        }
        const table = tableOf('withTotals', { columns: [{ id: 'Year', type: 'INTEGER', original_label: 'Year' }, { id: 'Geography', type: 'TEXT', original_label: 'Geography' },
            { id: 'Population', type: 'INTEGER', original_label: 'Population' }], rows: rows.map((row, i) => [i + 1, ...row]) });
        const batch = fake.runBatch;
        let round = 0;
        queries.runBatch.mockImplementation(async plan => {
            round += 1;
            if (round === 2) throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
            return batch(plan);
        });
        const analysis = await engine.analyzeSnapshot(table);
        expect(round).toBe(2);
        // Figures that still hold the total are not shown.
        expect(analysis.charts.filter(chart => chart.y.column === 'Population')).toEqual([]);
        expect(analysis.skipped.map(skip => skip.reason)).toContain('totals_unresolved');
    });

    test('three scans run at once; a fourth waits briefly and is then told to retry', async () => {
        fake.options.delay = 60;
        const names = ['cleanEvents', 'codes', 'twins', 'identifiers'];
        const results = await Promise.allSettled(names.map((name, i) => engine.analyzeSnapshot(tableOf(name), { waitMs: i === 3 ? 5 : 3000 })));
        expect(results.slice(0, 3).map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        expect(results[3].status).toBe('rejected');
        expect(results[3].reason).toMatchObject({ statusCode: 503, publicCode: 'CHARTS_BUSY' });
        // The slots were all given back.
        fake.options.delay = 0;
        await expect(engine.analyzeSnapshot(tableOf('identifiers'), { waitMs: 5 })).resolves.toMatchObject({ status: 'ok' });
    });

    describe('a chart asked for by name', () => {
        test('is computed from the same cleaning, with only integrity checked', async () => {
            const table = tableOf('suppressedCounts');
            const { chart } = await engine.customChart(table, { kind: 'bars', x: { column: 'EN_MONTH' }, y: { agg: 'sum', column: 'TOTAL' } });
            expect(chart.points).toHaveLength(12);
            expect(chart.y.lower_bound).toBe(true);
            expect(chart.spec).toEqual({ kind: 'bars', x: { column: 'EN_MONTH' }, y: { agg: 'sum', column: 'TOTAL' }, limit: 12 });
            const again = await engine.customChart(table, { kind: 'bars', x: { column: 'EN_MONTH' }, y: { agg: 'sum', column: 'TOTAL' } });
            expect(again.chart.id).toBe(chart.id);
            expect(fake.calls.batches).toHaveLength(1);
        });

        test('a time column becomes a time axis at the grain asked for', async () => {
            const { chart } = await engine.customChart(tableOf('cleanEvents'), { x: { column: 'Incorporation date', grain: 'month' }, y: { agg: 'count' } });
            expect(chart.x).toMatchObject({ type: 'time', grain: 'month' });
            expect(chart.points.map(point => point.start)).toEqual(chart.points.map(point => point.start).slice().sort());
        });

        test('what the table does not have is refused before any scan', async () => {
            const table = tableOf('cleanEvents');
            const bad = [{ x: { column: 'nope' }, y: { agg: 'count' } }, { x: { column: 'Status' }, y: { agg: 'median', column: 'Share capital' } },
                { x: { column: 'Status' }, y: { agg: 'sum', column: 'Status' } }, { x: { column: 'Status', grain: 'year' }, y: { agg: 'count' } },
                { x: { column: 'Status' }, y: { agg: 'count' }, limit: 0 }, { kind: 'pie', x: { column: 'Status' }, y: { agg: 'count' } }, null, 'x'];
            for (const raw of bad) await expect(engine.customChart(table, raw)).rejects.toMatchObject({ statusCode: 400, publicCode: 'INVALID_CHART_SPEC' });
            expect(fake.calls.batches).toHaveLength(0);
        });

        test('a sum across different measures is refused with the reason, unless grouped by or filtered to one', async () => {
            const table = tableOf('measureNames');
            await expect(engine.customChart(table, { x: { column: 'Fiscal Year' }, y: { agg: 'sum', column: 'Measure Value' } }))
                .rejects.toMatchObject({ statusCode: 400, publicCode: 'CHART_REFUSED', hint: 'mixed_measures' });
            const grouped = await engine.customChart(table, { x: { column: 'Data Point Label' }, y: { agg: 'avg', column: 'Measure Value' } });
            expect(grouped.chart.points.length).toBeGreaterThanOrEqual(2);
            fake.options.filter = (row, columns) => cell(row, columns, 'Data Point Label') === 'Net income';
            const pinned = await engine.customChart(table, { x: { column: 'Fiscal Year' }, y: { agg: 'sum', column: 'Measure Value' } },
                { filters: [{ column: 'Data Point Label', op: 'eq', value: 'Net income' }] });
            expect(pinned.chart.scope.filtered).toBe(true);
        });
    });
});
