// From computed groups to a chart or a reason not to draw one: the checks of
// services/charts/validate.js, on hand-made results of a table scan.
const { shapeCategory, shapeTime, shapeWide, detectTotalMembers, SEPARATOR } = require('../services/charts/validate');

const figure = (sum, n, extra = {}) => ({ sum, n: sum === null ? 0 : n, min: sum, max: sum, blank: 0, missing: 0, other: 0, ...extra });
// One group of a set: label, rows, then one sum per measure.
const group = (label, n, sums = [], extra = {}) => ({ key: String(label).toLowerCase(), label: String(label), spellings: 1, n, nx: 0, groups: 0,
    measures: sums.map(sum => figure(sum, n)), ...extra });
const setOf = groups => groups.map(entry => ({ ...entry, groups: groups.length }));
// The grand-total row that goes with a complete set.
function grandOf(groups, measures = {}) {
    const width = groups[0] ? groups[0].measures.length : 0;
    return { n: groups.reduce((sum, entry) => sum + entry.n, 0), nx: groups.reduce((sum, entry) => sum + entry.nx, 0),
        measures: Array.from({ length: width }, (_, j) => ({
            sum: groups.reduce((sum, entry) => sum + (entry.measures[j].sum || 0), 0), n: groups.reduce((sum, entry) => sum + entry.measures[j].n, 0),
            min: null, max: null, blank: 0, missing: 0, other: 0, ...(measures[j] || {}) })) };
}

const category = (extra = {}) => ({ id: 'Region', label: 'Region', type: 'TEXT', role: 'category', category: { strip_code_prefix: false }, ...extra });
const measure = (extra = {}) => ({ id: 'Value', label: 'Value', type: 'INTEGER', role: 'measure',
    measure: { additive: 'yes', integer: true, text: false, clean: null, percent: false, currency: false, ambiguous: false, unit: null, ...extra } });
const spec = (extra = {}) => ({ id: 'c_test', template: 'share_by_category', kind: 'donut', x: { type: 'category', column: 'Region' },
    y: { agg: 'sum', column: 'Value' }, limit: 12, score: 50, generic: false, ...extra });
const counts = (extra = {}) => spec({ template: 'records_by_category', y: { agg: 'count' }, ...extra });

function shares(groups, options = {}) {
    const set = setOf(groups);
    return shapeCategory(options.spec || spec(), set, options.grand || grandOf(set), { column: category(), measure: measure(), j: 0, ...options.context });
}
function tally(groups, options = {}) {
    const set = setOf(groups);
    return shapeCategory(options.spec || counts(), set, options.grand || grandOf(set), { column: category(), measure: null, j: null, ...options.context });
}
const codes = chart => chart.notes.map(note => note.code);

describe('members that add the others up', () => {
    const detect = (groups, table) => { const set = setOf(groups); return detectTotalMembers(set, grandOf(set), groups[0].measures.length ? 0 : null, table); };

    test('a member named Total is one, with or without numbers to go by', () => {
        expect(detect([group('Total', 1, [900]), group('East', 3, [500]), group('West', 3, [400])]).totals)
            .toEqual([{ key: 'total', label: 'Total', by: 'name' }]);
        expect(detect([group('Grand total', 1), group('East', 3), group('West', 3)]).totals.map(total => total.by)).toEqual(['name']);
    });

    test('"Total expenditures" and "Ontario Total" are totals in a table of figures, real members in a table of things', () => {
        const groups = [group('Total expenditures', 1, [700]), group('Labour', 1, [400]), group('Ontario Total', 1, [300]), group('Rent', 1, [90])];
        expect(detect(groups).totals.map(total => total.label)).toEqual(['Total expenditures', 'Ontario Total']);
        expect(detect(groups, { records: true }).totals).toEqual([]);
    });

    test('"Both sexes" is a total in a table of figures whatever its numbers; in a table of things they must agree within half a percent', () => {
        const sexes = both => [group('Both sexes', 10, [both]), group('Males', 10, [5200]), group('Females', 10, [4810])];
        expect(detect(sexes(10000)).totals).toEqual([{ key: 'both sexes', label: 'Both sexes', by: 'sum_of_others' }]);
        // Suppressed cells or a group not listed: still the total beside its parts.
        expect(detect(sexes(11000)).totals).toEqual([{ key: 'both sexes', label: 'Both sexes', by: 'name' }]);
        expect(detect(sexes(10000), { records: true }).totals).toEqual([{ key: 'both sexes', label: 'Both sexes', by: 'sum_of_others' }]);
        expect(detect(sexes(11000), { records: true }).totals).toEqual([]);
        // What is left once the others are named is a member.
        expect(detect([group('All other countries', 10, [900]), group('France', 10, [500]), group('Italy', 10, [450])]).totals).toEqual([]);
    });

    test('without a name to go by, only an exact sum of the others counts, and not among small numbers', () => {
        expect(detect([group('North', 4, [6000]), group('East', 4, [3500]), group('West', 4, [2500])]).totals.map(total => total.label)).toEqual(['North']);
        expect(detect([group('North', 4, [6000]), group('East', 4, [3500]), group('West', 4, [2490])]).totals).toEqual([]);
        expect(detect([group('Alpha', 4, [5]), group('Beta', 4, [3]), group('Gamma', 4, [2])]).totals).toEqual([]);
    });

    test('"Canada" beside the provinces is their total even when suppressed cells make it larger, and regions go with it', () => {
        const groups = [group('Canada', 5, [1000]), group('Atlantic', 5, [150]), group('Ontario', 5, [400]), group('Québec', 5, [250]),
            group('British Columbia', 5, [150]), group('Nova Scotia', 5, [90]), group('New Brunswick', 5, [40])];
        expect(detect(groups).totals.map(total => total.label)).toEqual(['Canada', 'Atlantic']);
        // Not the largest member: a place among places.
        const events = [group('Canada', 5, [10]), group('Ontario', 5, [400]), group('Quebec', 5, [250]), group('Alberta', 5, [150])];
        expect(detect(events).totals).toEqual([]);
        // A table of events needs more provinces beside it.
        expect(detect(groups.slice(0, 5), { records: true }).totals).toEqual([]);
        expect(detect(groups, { records: true }).totals.map(total => total.label)).toContain('Canada');
    });

    test('a total, subtotals and their parts in one column are reported as mixed levels', () => {
        const groups = [group('All regions', 1, [1200]), group('East', 1, [800]), group('West', 1, [400]), group('Halifax', 1, [500]), group('Moncton', 1, [300]),
            group('Calgary', 1, [250]), group('Regina', 1, [150])];
        // Named for all of them, and its subtotals beneath it are found as well.
        expect(detect(groups)).toEqual({ totals: [{ key: 'all regions', label: 'All regions', by: 'name' }], levels: true });
        const unnamed = [group('Every region', 1, [1200]), ...groups.slice(1)];
        expect(detect(unnamed)).toEqual({ totals: [], levels: true });
    });

    test('blank groups and groups already set aside are not members', () => {
        const groups = [group('', 4, [9000]), group('Total', 0, [null], { nx: 2 }), group('East', 4, [500]), group('West', 4, [400]), group('North', 4, [300])];
        expect(detect(groups)).toEqual({ totals: [], levels: false });
    });
});

describe('charts of groups', () => {
    test('shares of a complete, small set are a donut that adds up', () => {
        const { ok, chart } = shares([group('East', 4, [500]), group('West', 4, [300]), group('North', 2, [200])]);
        expect(ok).toBe(true);
        expect(chart).toMatchObject({ kind: 'donut', total: 1000, other: null, scope: { rows: 10, groups_total: 3, groups_shown: 3, complete: true } });
        expect(chart.points.map(point => [point.label, point.value, point.share])).toEqual([['East', 500, 0.5], ['West', 300, 0.3], ['North', 200, 0.2]]);
        expect(chart.fit).toEqual({ tab: true, card: true, social: true });
        expect(chart.title).toBeUndefined();
    });

    test('more groups than the limit: the largest, and what the rest add up to', () => {
        const groups = Array.from({ length: 20 }, (_, i) => group('Group ' + String(i).padStart(2, '0'), 2, [1000 - i * 10]));
        const { chart } = shares(groups, { spec: spec({ limit: 5 }) });
        expect(chart.kind).toBe('bars');
        expect(chart.points).toHaveLength(5);
        expect(chart.other).toEqual({ groups: 15, value: grandOf(groups).measures[0].sum - (1000 + 990 + 980 + 970 + 960) });
        expect(codes(chart)).toContain('limited_groups');
        // Two or three groups over the limit are shown rather than lumped together.
        const few = shares(groups.slice(0, 7), { spec: spec({ kind: 'bars', limit: 5 }) }).chart;
        expect(few.points).toHaveLength(7);
        expect(few.other).toBeNull();
    });

    test('blank and placeholder labels become one "Not recorded" group, last', () => {
        const groups = [group('East', 4, [500]), group('', 3, [100]), group('n/a', 1, [50]), group('--', 1, [25]), group('West', 4, [300]), group('NA', 2, [60])];
        const plain = shares(groups).chart;
        expect(plain.points.map(point => point.label)).toEqual(['East', 'West', 'NA', null]);
        expect(plain.points[3]).toMatchObject({ blank: true, value: 175, rows: 5 });
        expect(codes(plain)).toContain('not_recorded_group');
        // "NA" is a blank only where the table uses it as one.
        const table = shares(groups, { context: { blankTokens: new Set(['na']) } }).chart;
        expect(table.points.map(point => point.label)).toEqual(['East', 'West', null]);
        expect(table.points[2].value).toBe(235);
    });

    test('spellings that differ only by accents are one group, named by the more frequent', () => {
        const { chart } = tally([group('Québec', 185), group('Quebec', 12), group('Ontario', 90), group('Alberta', 40)]);
        expect(chart.points.map(point => [point.label, point.value])).toEqual([['Québec', 197], ['Ontario', 90], ['Alberta', 40]]);
        expect(chart.scope.groups_total).toBe(3);
        expect(codes(chart)).toContain('variants_merged');
    });

    test('a code written before its wording is hidden, unless two codes share a wording', () => {
        const column = category({ category: { strip_code_prefix: true } });
        const run = groups => { const set = setOf(groups); return shapeCategory(counts(), set, grandOf(set), { column, measure: null, j: null }).chart; };
        expect(run([group('6322 - Cooks', 9), group('0621 - Retail managers', 5)]).points.map(point => point.label)).toEqual(['Cooks', 'Retail managers']);
        expect(run([group('6322 - Cooks', 9), group('6321 - Cooks', 5)]).points.map(point => point.label)).toEqual(['6322 - Cooks', '6321 - Cooks']);
    });

    test('a chart that would say nothing is not drawn', () => {
        const reason = result => result.reason;
        expect(reason(tally([group('Only', 40)]))).toBe('too_few_groups');
        expect(reason(tally([group('Alpha', 10), group('Beta', 10), group('Gamma', 10)]))).toBe('flat');
        expect(reason(tally([group('Alpha', 1000), group('Beta', 995), group('Gamma', 990), group('Delta', 985)]))).toBe('flat');
        expect(reason(tally(Array.from({ length: 30 }, (_, i) => group('Name ' + i, i < 5 ? 2 : 1))))).toBe('id_like');
        expect(reason(tally([group('Alpha', 990), group('Beta', 6), group('Gamma', 4)]))).toBe('one_group');
        expect(reason(tally([group('', 60), group('Alpha', 30), group('Beta', 10)]))).toBe('mostly_blank');
        expect(reason(tally([group('https://example.org/a', 9), group('https://example.org/b', 5), group('Other', 3)]))).toBe('link_labels');
        expect(reason(tally([group('2034-04-30T00:00:00', 9), group('2035-04-30T00:00:00', 5)]))).toBe('date_labels');
        const long = 'A sentence that goes on for much longer than any category label would, well past eighty characters in all';
        expect(reason(tally([group(long + ' one', 9), group(long + ' two', 5)]))).toBe('long_labels');
    });

    test('bare numbers are labels only for a few values of a code', () => {
        const numbers = count => Array.from({ length: count }, (_, i) => group(String(150 + i), 20 - i));
        const run = (groups, column) => { const set = setOf(groups); return shapeCategory(counts(), set, grandOf(set), { column, measure: null, j: null }); };
        expect(run(numbers(5), category()).reason).toBe('numeric_labels');
        expect(run(numbers(5), category({ role: 'code' })).ok).toBe(true);
        expect(run(numbers(14), category({ role: 'code' })).reason).toBe('numeric_labels');
    });

    test('while a visitor searches, only integrity is checked: one group is still a chart', () => {
        const { ok, chart } = tally([group('Federal', 100)], { context: { gates: false, filtered: true } });
        expect(ok).toBe(true);
        expect(chart.points).toHaveLength(1);
        expect(chart.fit).toEqual({ tab: true, card: false, social: false });
        expect(codes(chart)).toContain('filtered_scope');
        expect(tally([], { grand: { n: 0, nx: 0, measures: [] }, context: { gates: false } }).reason).toBe('no_groups');
    });

    test('a measure that cannot be read is refused whatever else holds', () => {
        const groups = [group('East', 50, [500]), group('West', 50, [300])];
        const grand = extra => ({ n: 100, nx: 0, measures: [figure(800, 100, extra)] });
        const run = extra => shapeCategory(spec(), setOf(groups), grand(extra), { column: category(), measure: measure(), j: 0, gates: false }).reason;
        expect(run({ n: 0, sum: null })).toBe('no_numbers');
        expect(run({ n: 60, missing: 0, blank: 0 })).toBe('unreadable_values');
        expect(run({ n: 3, missing: 97 })).toBe('mostly_suppressed');
    });

    test('every chart says what it left out or assumed', () => {
        const groups = [group('East', 60, [500]), group('West', 40, [300])];
        const text = measure({ text: true, clean: { core: 'thousands_comma', missing: ['--', 'x'] }, ambiguous: true, additive: 'unknown',
            only: { column: 'Currency', value: 'CAD' } });
        const grand = { n: 100, nx: 4, measures: [figure(800, 70, { missing: 20, blank: 5, other: 3 })] };
        const { chart } = shapeCategory(spec(), setOf(groups), grand, { column: category(), measure: text, j: 0, filtered: true });
        expect(codes(chart)).toEqual(['placeholders_left_out', 'unreadable_left_out', 'blank_cells_left_out', 'number_format_assumed', 'numbers_read_from_text',
            'one_unit_only', 'total_left_out', 'sum_of_non_additive', 'filtered_scope']);
        expect(chart.notes[0]).toMatchObject({ level: 'caution', cells: 20, share: 0.2, tokens: ['--', 'x'] });
        expect(chart.notes.find(note => note.code === 'unreadable_left_out').cells).toBe(2);
        expect(chart.notes.find(note => note.code === 'one_unit_only')).toMatchObject({ level: 'caution', by: 'Currency', kept: 'CAD', rows: 3 });
        expect(chart.y).toMatchObject({ lower_bound: true, unit: 'CAD', additive: 'unknown' });
        const average = shapeCategory(spec({ template: 'average_by_category', kind: 'bars', y: { agg: 'avg', column: 'Value' } }), setOf(groups),
            grandOf(setOf(groups)), { column: category(), measure: measure({ additive: 'no' }), j: 0 }).chart;
        expect(codes(average)).toEqual(['unweighted_average']);
        expect(average.points.map(point => point.value)).toEqual([500 / 60, 300 / 40].sort((a, b) => b - a));
        expect(average.total).toBeNull();
    });

    test('rankings of named rows and unnamed columns stay off cards; so does a chart led by "Not recorded"', () => {
        const groups = [group('East', 4, [500]), group('West', 4, [300]), group('North', 2, [200])];
        expect(shares(groups, { spec: spec({ row_labels: true }) }).chart.fit).toEqual({ tab: true, card: false, social: false });
        expect(shares(groups, { spec: spec({ generic: true }) }).chart.fit.card).toBe(false);
        expect(shares(groups.slice(0, 2)).chart.fit.card).toBe(false);
        const led = tally([group('', 45), group('Alpha', 30), group('Beta', 25)]).chart;
        expect(led.fit.card).toBe(false);
        expect(led.score).toBe(36);
    });
});

describe('charts over time', () => {
    const axis = (extra = {}) => ({ id: 't:Date', columns: ['Date'], kind: 'typed', grain: 'year', bucket: 'year', ...extra });
    const dated = { id: 'Date', label: 'Date', type: 'DATE', role: 'time', time: { kind: 'typed', grain: 'year' } };
    const timeSpec = (extra = {}) => spec({ template: 'measure_over_time', kind: 'line', x: { type: 'time', axis: 't:Date', grain: 'year' }, limit: 60, ...extra });
    const years = (from, count, value = i => 100 + i * 10) => Array.from({ length: count }, (_, i) => group(from + i + '-01-01', 5, [value(i)]));
    const over = (groups, options = {}) => {
        const set = setOf(groups);
        return shapeTime(options.spec || timeSpec(), set, options.grand || grandOf(set), { axis: options.axis || axis(), columns: options.columns || [dated],
            measure: measure(), j: 0, ordered: true, ...options.context });
    };

    test('periods come out in order, whatever order the groups arrive in', () => {
        const { chart } = over(years(2015, 6).reverse());
        expect(chart.kind).toBe('line');
        expect(chart.points.map(point => point.start)).toEqual(['2015-01-01', '2016-01-01', '2017-01-01', '2018-01-01', '2019-01-01', '2020-01-01']);
        expect(chart.time).toMatchObject({ grain: 'year', first: '2015-01-01', last: '2020-01-01', periods_total: 6, periods_shown: 6, missing: [] });
        expect(chart.fit.card).toBe(true);
    });

    test('two or three periods are bars, not a line, and too few for a card', () => {
        const { chart } = over(years(2019, 3));
        expect(chart.kind).toBe('bars');
        expect(chart.fit).toEqual({ tab: true, card: false, social: false });
        expect(over(years(2019, 1)).reason).toBe('too_few_periods');
    });

    test('the latest periods are shown and the chart says how many there are', () => {
        const set = setOf(years(1950, 70));
        // The scan returned the 40 latest of 70.
        const returned = set.slice(-40);
        const { chart } = shapeTime(timeSpec({ limit: 30 }), returned, grandOf(set), { axis: axis(), columns: [dated], measure: measure(), j: 0, ordered: true });
        expect(chart.points).toHaveLength(30);
        expect(chart.time).toMatchObject({ first: '1990-01-01', last: '2019-01-01', periods_total: 70, periods_shown: 30 });
        expect(chart.notes.find(note => note.code === 'latest_periods')).toMatchObject({ shown: 30, total: 70 });
    });

    test('periods written as text cannot be cut short: all of them, or no chart', () => {
        const set = setOf(years(1950, 70)).slice(0, 40);
        expect(shapeTime(timeSpec(), set, grandOf(set), { axis: axis(), columns: [dated], measure: measure(), j: 0, ordered: false }).reason).toBe('too_many_periods');
    });

    test('a period with no number is a gap, and rows without a period are counted', () => {
        const groups = [...years(2015, 5), group('2020-01-01', 5, [null]), group('', 3, [40])];
        // The five rows of 2020 hold no number: blank cells, as the scan counts them.
        const grand = grandOf(setOf(groups), [{ blank: 5 }]);
        const { chart } = over(groups, { grand });
        expect(chart.points).toHaveLength(5);
        expect(chart.time.missing).toEqual(['2020-01-01']);
        expect(chart.notes.find(note => note.code === 'rows_without_period')).toMatchObject({ rows: 3, level: 'caution' });
        expect(over([...years(2015, 5), group('', 40, [40])]).reason).toBe('mostly_undated');
    });

    test('text periods are read by the column\'s format; unreadable ones are few or the axis is not one', () => {
        const fiscal = { id: 'FY', label: 'FY', type: 'TEXT', role: 'time', time: { kind: 'text_period', format: 'fiscal_year', grain: 'fiscal_year' } };
        const groups = [group('2015-2016', 5, [10]), group('fy2016-17', 5, [20]), group('2017/18', 5, [30]), group('2018-19', 5, [40])];
        const run = extra => over([...groups, ...extra], { spec: timeSpec({ x: { type: 'time', axis: 't:FY', grain: 'fiscal_year' } }),
            axis: axis({ id: 't:FY', columns: ['FY'], kind: 'text_period', grain: 'fiscal_year', bucket: null }), columns: [fiscal] });
        const { chart } = run([group('see note', 1, [5])]);
        expect(chart.points.map(point => point.start)).toEqual(['2015-01-01', '2016-01-01', '2017-01-01', '2018-01-01']);
        expect(codes(chart)).toEqual(expect.arrayContaining(['fiscal_year_start', 'periods_unreadable']));
        expect(run([group('various', 9, [5])]).reason).toBe('periods_unreadable');
    });

    test('a year column and a month column are read together, in either language', () => {
        const columns = [{ id: 'Year', label: 'Year', type: 'INTEGER', role: 'time', time: { kind: 'year_number' } },
            { id: 'Month', label: 'Month', type: 'TEXT', role: 'time_part' }];
        const groups = [group('2020' + SEPARATOR + 'janv.', 2, [1]), group('2020' + SEPARATOR + 'Feb', 2, [2]), group('2020' + SEPARATOR + 'mars', 2, [3]),
            group('2020' + SEPARATOR + '04', 2, [4]), group(SEPARATOR, 1, [9])];
        const { chart } = over(groups, { spec: timeSpec({ x: { type: 'time', axis: 't:Year+Month', grain: 'month' } }),
            axis: { id: 't:Year+Month', columns: ['Year', 'Month'], kind: 'composite', grain: 'month', bucket: null }, columns });
        expect(chart.points.map(point => point.start)).toEqual(['2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01']);
        expect(chart.x.label).toBe('Year + Month');
        expect(codes(chart)).toEqual(expect.arrayContaining(['composite_time', 'rows_without_period']));
    });

    test('rows per period that only differ at the edges are nothing to count', () => {
        const months = [9, 12, 12, 12, 12, 7].map((n, i) => group(2015 + i + '-01-01', n));
        const set = setOf(months);
        const result = shapeTime(timeSpec({ template: 'records_over_time', y: { agg: 'count' } }), set, grandOf(set),
            { axis: axis(), columns: [dated], measure: null, j: null, ordered: true });
        expect(result.reason).toBe('flat');
    });
});

describe('period columns of a wide table', () => {
    const wide = { id: 'w0', grain: 'year', stem: 'budget', additive: 'yes', columns: [2019, 2020, 2021, 2022, 2023].map(year => ({ id: 'y' + year, ord: year })) };
    const column = (year, extra = {}) => ({ id: 'y' + year, label: String(year), type: 'TEXT', role: 'measure',
        measure: { additive: 'yes', integer: true, text: true, clean: { core: 'plain', missing: ['--'] }, percent: false, currency: false, ...extra } });
    const wideSpec = spec({ template: 'wide_totals_per_period', kind: 'line', x: { type: 'wide', group: 'w0', grain: 'year' }, y: { agg: 'sum', group: 'w0' } });

    test('each column is a period; a column with no number is a gap; only the columns computed are shown', () => {
        const columns = [2020, 2021, 2022, 2023].map(year => column(year));
        const grand = { n: 10, nx: 1, measures: [figure(100, 10), figure(null, 0, { missing: 10 }), figure(140, 8, { missing: 2 }), figure(180, 10)] };
        const { chart } = shapeWide(wideSpec, grand, { group: wide, columns, indexes: [0, 1, 2, 3] });
        expect(chart.points.map(point => [point.start, point.value, point.column])).toEqual([['2020-01-01', 100, 'y2020'], ['2022-01-01', 140, 'y2022'],
            ['2023-01-01', 180, 'y2023']]);
        expect(chart.kind).toBe('bars');
        expect(chart.time).toMatchObject({ periods_total: 5, periods_shown: 4, missing: ['2021-01-01'] });
        expect(chart.y).toMatchObject({ agg: 'sum', label: 'budget', lower_bound: true });
        expect(codes(chart)).toEqual(['placeholders_left_out', 'total_left_out', 'wide_periods', 'latest_periods', 'missing_periods']);
    });
});
