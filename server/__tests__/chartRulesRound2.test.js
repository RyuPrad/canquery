// Rules from the second reading of real tables: two independent reviews of
// the engine's charts on 100 publisher tables found sums of figures that do
// not add up, codes as labels, totals beside their parts and periods the
// tables barely cover. Each test is a small table with the shape of one that
// showed the problem.
jest.mock('../db/pool', () => ({}));
jest.mock('../db/chartQueries', () => ({ readSample: jest.fn(), runBatch: jest.fn() }));

const queries = require('../db/chartQueries');
const engine = require('../services/charts/chartEngine');
const { samplePlan, profileSample } = require('../services/charts/profile');
const { buildTableModel } = require('../services/charts/model');
const { listCandidates } = require('../services/charts/candidates');
const { shapeCategory, shapeTime, latestPeriod } = require('../services/charts/validate');
const { codeLevel, codeLabels, labelKind, isMeasureLabel, isTotalLabel, isAllLabel, isGarbled, nameEvidence } = require('../services/charts/tokens');
const { parseNumber, detectNumberRule, prep } = require('../services/charts/numberFormats');
const { fakeQueries } = require('./fixtures/charts/evaluate');

const NOW = new Date('2026-11-12T00:00:00Z');
const text = id => ({ id, type: 'TEXT', original_label: id });
const integer = id => ({ id, type: 'INTEGER', original_label: id });
const numeric = id => ({ id, type: 'NUMERIC', original_label: id });
const date = id => ({ id, type: 'DATE', original_label: id });
const table = (columns, rows) => ({ columns, rows: rows.map((row, i) => [i + 1, ...row]) });
const range = count => Array.from({ length: count }, (_, i) => i);
const scatter = (i, span) => (i * 7919 + 4513) % span;

async function read(input) {
    const plan = samplePlan({ rowCount: input.rows.length, columns: input.columns });
    const profile = await profileSample({ columns: input.columns, rows: input.rows, plan });
    return { profile, model: buildTableModel(profile, { rowCount: input.rows.length, now: NOW }) };
}
const column = (model, id) => model.columns.find(entry => entry.id === id);
const reasons = (model, id) => column(model, id).reasons.map(reason => reason.code);

const tables = new Map();
let fake;
beforeEach(() => {
    engine.clearCaches();
    tables.clear();
    fake = fakeQueries(tables);
    queries.readSample.mockImplementation(fake.readSample);
    queries.runBatch.mockImplementation(fake.runBatch);
});
function analyze(name, input, options) {
    const tableName = 'r_' + Buffer.from(name).toString('hex').slice(0, 30);
    tables.set(tableName, input);
    return engine.analyzeSnapshot({ tableName, columns: input.columns, rowCount: input.rows.length, ingestedAt: '2026-01-01T00:00:00.000Z' }, options);
}

describe('labels a reader cannot read', () => {
    test('codes need a legend: single letters and digits, short capitals, symbols, slugs', () => {
        for (const label of ['U', '3', 'N', '*GD', 'J0K', '381A', 'dnd-mdn', 'T.Q.C', 'ML', 'MLSn', 'CMA/RMR']) expect(codeLevel(label)).toBe(2);
        for (const label of ['ESSF', 'DEMU']) expect(codeLevel(label)).toBe(1);
        for (const label of ['Ontario', 'ON', 'B.C.', 'Que.', 'Yes', 'NON', 'Rural', 'TORONTO', 'Active', '2021', 'Family class']) expect(codeLevel(label)).toBe(0);
        expect(codeLevel('F', { sex: true })).toBe(0);
        // A few words in capitals are words; a long list of four-letter capitals is a code list.
        expect(codeLabels(['URBAN', 'RURAL'])).toBe(false);
        expect(codeLabels(['DEMU', 'DEWT', 'BEAB', 'BEAG', 'MOOS', 'ELKS'])).toBe(true);
        expect(codeLabels(['1', '2', 'U', 'N'])).toBe(true);
    });

    test('a column of codes is grouped by in the builder only; text decoded wrongly is not charted', async () => {
        const { model } = await read(table([text('P_ISEV'), text('Région'), integer('Number of collisions')],
            range(120).map(i => [['1', '2', '3', 'U', 'N'][i % 5], ['Avocats salariés', 'privée', 'Région'][i % 3].replace('é', i % 2 ? 'Ž' : 'é'),
                String(10 + scatter(i, 40))])));
        expect(column(model, 'P_ISEV').category).toMatchObject({ breakdown: false });
        expect(reasons(model, 'Région')).toContain('garbled_text');
        expect(listCandidates(model).some(spec => spec.x.column === 'P_ISEV' || spec.x.column === 'Région')).toBe(false);
        expect(isGarbled('privŽe')).toBe(true);
        expect(isGarbled('privée')).toBe(false);
    });

    test('bare numbers are groups only when the column is named for a count or a thing numbered', async () => {
        const { model } = await read(table([integer('C_SEV'), integer('Bedrooms'), integer('Number of units')],
            range(200).map(i => [String(1 + (i % 3)), String(1 + (i % 4)), String(5 + scatter(i, 60))])));
        expect(column(model, 'C_SEV').category.breakdown).toBe(false);
        expect(column(model, 'Bedrooms').category.breakdown).toBe(true);
    });

    test('one value on nearly every row is no breakdown', async () => {
        const { model } = await read(table([text('Status'), text('Province'), integer('Number of permits')],
            range(400).map(i => [i < 390 ? 'Dissolved' : 'Active', ['Ontario', 'Quebec', 'Alberta'][i % 3], String(1 + scatter(i, 30))])));
        expect(reasons(model, 'Status')).toContain('one_value_dominates');
        expect(column(model, 'Status').category.breakdown).toBe(false);
        expect(column(model, 'Province').category.breakdown).toBe(true);
    });
});

describe('figures that do not add up across rows', () => {
    test('nothing is averaged on the engine\'s own initiative, and a table of records adds up only what is known to add up', async () => {
        const { model } = await read(table([text('Make'), text('Model'), integer('LHT'), integer('Number of seats'), numeric('Price ($)')],
            range(300).map(i => ['Make ' + (i % 6), 'Model ' + i, String(4000 + scatter(i, 1500)), String(2 + (i % 5)), '$' + (20000 + scatter(i, 30000))])));
        expect(model.records).toBe(true);
        const specs = listCandidates(model);
        expect(specs.some(spec => spec.y.agg === 'avg' || spec.y.agg === 'max')).toBe(false);
        // A length per model is a size, not an amount; prices do not add up either.
        expect(specs.some(spec => ['LHT', 'Price ($)'].includes(spec.y.column))).toBe(false);
        expect(specs.some(spec => spec.y.column === 'Number of seats')).toBe(true);
    });

    test('limits, bounds and sizes of one thing never add up; "n" and money by other names do', () => {
        for (const name of ['Nombre minimal d’administrateurs', 'LL', 'Upper CI', 'Pad Width (ft.)', 'DIAMETER__VALVE_', 'Hour', 'Lower Middle Total assets'])
            expect([name, nameEvidence(name).nonAdditive]).toEqual([name, true]);
        for (const name of ['n', 'Crédit établi de l’ACT (dollars)', 'Benefits paid', 'RESIDENT DAYS']) expect([name, nameEvidence(name).additive]).toEqual([name, true]);
    });

    test('a column of measure names blocks the value column, whatever the column is called', async () => {
        const items = ['Number of taxable returns', 'Total income assessed', 'Number of non-taxable returns', 'Average income', 'Employment income', 'Net income'];
        const { model } = await read(table([text('Section'), text('Line'), integer('Amount')],
            range(120).map(i => [['A', 'B'][i % 2], items[i % 6], String(1000 + scatter(i, 90000))])));
        expect(reasons(model, 'Line')).toContain('measure_names');
        expect(column(model, 'Amount').measure.blocked_by).toEqual([{ column: 'Line', why: 'mixed_measures' }]);
        expect(isMeasureLabel('Revenue ($)')).toBe(true);
        expect(isMeasureLabel('Employment income')).toBe(false);
    });

    test('a column that lists several kinds of breakdown, or places at several levels, blocks every sum across it', async () => {
        const details = ['Permis unique', '0 à 14 ans', '15 à 29 ans', '30 à 44 ans', 'Femmes', 'Hommes', 'Montréal', 'Laval', 'Français', 'Anglais'];
        const { model } = await read(table([text('Type'), text('Detail'), integer('Students')],
            range(60).map(i => [['Permis', 'Âge', 'Sexe', 'Région', 'Langue'][Math.floor((i % 10) / 2)], details[i % 10], String(100 + scatter(i, 900))])));
        expect(reasons(model, 'Detail')).toContain('mixed_levels');
        expect(column(model, 'Students').measure.blocked_by).toEqual(expect.arrayContaining([{ column: 'Detail', why: 'levels' }]));
        expect(listCandidates(model).filter(spec => spec.y.column === 'Students')).toEqual([]);
        expect([labelKind('0 à 14 ans'), labelKind('Hommes'), labelKind('Nova Scotia'), labelKind('Montréal')]).toEqual(['age', 'sex', 'place', null]);

        const places = ['Canada', 'Atlantic Canada', 'Nova Scotia', 'New Brunswick', 'Ontario', 'Halifax County', 'Kings County', 'Ottawa', 'Toronto'];
        const nested = await read(table([text('Geography'), integer('Population')], range(90).map(i => [places[i % 9], String(1000 + scatter(i, 90000))])));
        expect(reasons(nested.model, 'Geography')).toContain('mixed_levels');
    });

    test('a column whose every value splits the same people another way: the rows are figures, nothing adds up across it', async () => {
        // Characteristic: Age (3 bands), Sex (2), Region (4); each adds up to the same 1,803 people.
        const rows = [];
        const split = (name, parts) => parts.forEach(([label, value]) => rows.push([name, label, String(value)]));
        split('Âge', [['Moins de 25 ans', 601], ['25 à 44 ans', 700], ['45 ans et plus', 502]]);
        split('Sexe', [['Femmes', 950], ['Hommes', 853]]);
        split('Région', [['Montréal', 900], ['Québec', 400], ['Laval', 300], ['Gatineau', 203]]);
        const { model, profile } = await read(table([text('Caractéristique'), text('Catégorie'), integer('Personnes')], rows));
        expect(profile.groups.partitions).toEqual([{ by: 'Caractéristique', measure: 'Personnes', groups: 3 }]);
        expect(model.records).toBe(false);
        expect(column(model, 'Personnes').measure.blocked_by).toEqual(expect.arrayContaining([{ column: 'Caractéristique', why: 'breakdowns' }]));
        expect(listCandidates(model)).toEqual([]);
    });

    test('periods written as labels block sums across them in a table of figures', async () => {
        const periods = range(6).map(i => 'Claim period ' + (i + 1) + ' (' + ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'][i] + ' 2020)');
        const { model } = await read(table([text('Claim period'), text('Industry'), integer('Count of properties')],
            range(36).map(i => [periods[i % 6], ['Retail', 'Farming', 'Mining'][Math.floor(i / 12)], String(100 + scatter(i, 900))])));
        expect(reasons(model, 'Claim period')).toContain('period_labels');
        expect(column(model, 'Count of properties').measure.blocked_by).toEqual(expect.arrayContaining([{ column: 'Claim period', why: 'periods' }]));
    });

    test('dates written as numbers, people\'s names and record-keeping dates are not charted', async () => {
        const { model } = await read(table([integer('DATE_SURV'), text('First name'), date('Last updated'), date('Collision date'), integer('Number of vehicles')],
            range(200).map(i => [String(20200101 + (i % 12) * 100 + (i % 28)), ['John', 'Mary', 'Ali', 'Jean'][i % 4],
                '2024-0' + (1 + (i % 3)) + '-15', '2023-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 27)).padStart(2, '0'),
                String(1 + (i % 4))])));
        expect(column(model, 'DATE_SURV')).toMatchObject({ role: 'code', reasons: [{ code: 'date_numbers' }] });
        expect(column(model, 'First name')).toMatchObject({ role: 'text', reasons: [{ code: 'person_names' }] });
        expect(reasons(model, 'Last updated')).toContain('maintenance_date');
        expect(model.time_axes.map(axis => axis.id)).toEqual(['t:Collision date']);
    });

    test('a data dictionary gets no charts', async () => {
        const { model } = await read(table([text('Field name'), text('Data type'), text('Description'), integer('Field order')],
            range(12).map(i => ['field_' + i, ['Text', 'Integer', 'Date'][i % 3], 'What field ' + i + ' holds', String(i + 1)])));
        expect(model.shape).toBe('dictionary');
        expect(listCandidates(model)).toEqual([]);
    });
});

describe('cells that hold no figure', () => {
    test('all nines far above every figure, or a negative code in a column of positives, are placeholders', async () => {
        const values = range(80).map(i => (i % 10 === 0 ? '99999.9' : i % 13 === 0 ? '-999' : String(1000 + scatter(i, 5000))));
        const { profile } = await read(table([text('Industry'), numeric('Assets')], range(80).map(i => ['Industry ' + (i % 4), values[i]])));
        const stat = profile.columns.find(entry => entry.id === 'Assets');
        expect(stat.missing.sentinels.sort()).toEqual([-999, 99999.9]);
        expect(stat.number.max).toBeLessThan(99999.9);
    });

    test('a sum leaves the placeholder figures out, typed or written as text', async () => {
        const rows = range(60).map(i => ['Firm ' + (i + 1), 'Sector ' + (i % 4), i % 6 === 0 ? '99999.9' : String(100 + (i % 5) * 10)]);
        const expected = rows.filter(row => row[2] !== '99999.9').reduce((sum, row) => sum + Number(row[2]), 0);
        for (const type of [numeric('Total assets'), text('Total assets')]) {
            const analysis = await analyze('sentinel-' + type.type, table([text('Firm'), text('Sector'), type], rows));
            const chart = analysis.charts.find(entry => entry.y.column === 'Total assets' && entry.x.type === 'category');
            expect(chart.points.reduce((sum, point) => sum + point.value, 0)).toBe(expected);
            expect(chart.notes.find(note => note.code === 'placeholders_left_out')).toMatchObject({ cells: 10 });
        }
    });

    test('a footnote mark after a number does not hide the number', () => {
        const rule = detectNumberRule([[prep('2,605*'), 1], [prep('311 †'), 1], [prep('1,234'), 3], [prep('12,345,678'), 1]]).rule;
        expect(rule).toMatchObject({ core: 'thousands_comma', marks: true });
        expect([parseNumber('2,605*', rule), parseNumber('311 †', rule), parseNumber('1,234¹', rule), parseNumber('*', rule)]).toEqual([2605, 311, 1234, null]);
    });

    test('rows with nothing in them are not records', async () => {
        const rows = range(30).map(i => (i % 10 === 9 ? ['', '', ''] : ['Office ' + (i % 3), ['Open', 'Closed'][i % 2], String(i)]));
        const { model } = await read(table([text('Office'), text('Status'), integer('Visits')], rows));
        expect(model.excluded_rows).toEqual([10, 20, 30]);
        expect(model.excluded_notes).toBe(0);
    });
});

describe('totals, remainders and rankings', () => {
    const figure = (sum, n) => ({ sum, n, min: sum, max: sum, blank: 0, missing: 0, other: 0 });
    const group = (label, n, sum) => ({ key: String(label).toLowerCase(), label: String(label), spellings: 1, n, nx: 0, groups: 0, measures: [figure(sum, n)] });
    const setOf = groups => groups.map(entry => ({ ...entry, groups: groups.length }));
    const grandOf = (groups, min = null) => ({ n: groups.reduce((sum, entry) => sum + entry.n, 0), nx: 0,
        measures: [{ sum: groups.reduce((sum, entry) => sum + entry.measures[0].sum, 0), n: groups.reduce((sum, entry) => sum + entry.n, 0), min, max: null, blank: 0, missing: 0, other: 0 }] });
    const region = { id: 'Region', label: 'Region', type: 'TEXT', role: 'category', category: { strip_code_prefix: false } };
    const amount = { id: 'Total', label: 'Total', type: 'INTEGER', role: 'measure', measure: { additive: 'yes', integer: true, text: false, clean: null, percent: false,
        currency: false, ambiguous: false, unit: null } };
    const spec = extra => ({ id: 'c_test', template: 'share_by_category', kind: 'bars', x: { type: 'category', column: 'Region' }, y: { agg: 'sum', column: 'Total' },
        limit: 12, score: 50, ...extra });
    const shape = (groups, extra = {}, grand) => { const set = setOf(groups); return shapeCategory(spec(extra), set, grand || grandOf(set), { column: region, measure: amount, j: 0 }); };

    test('"Total Atlantic" is a total; so is an unnamed row equal to the named ones', () => {
        for (const label of ['Total Atlantic', 'Total Canada', 'Total des provinces', 'Total, all ages']) expect([label, isTotalLabel(label)]).toEqual([label, true]);
        for (const label of ['Total assets', 'Total income', 'Total-factor productivity']) expect([label, isTotalLabel(label)]).toEqual([label, false]);
        const result = shape([group('Maritimes', 3, 6093), group('Gulf', 3, 5305), group('Newfoundland', 1, 3409), group('Quebec', 1, 1278), group('', 1, 16085)]);
        expect(result.ok).toBe(true);
        expect(result.chart.points.map(point => point.label)).toEqual(['Maritimes', 'Gulf', 'Newfoundland', 'Quebec']);
        expect(result.chart.total).toBe(16085);
        expect(result.chart.notes.map(note => note.code)).toContain('total_left_out');
    });

    test('a ranking of named rows leaves the unnamed ones out, and says so', () => {
        const result = shape([group('Nova Scotia', 1, 5195), group('Newfoundland', 1, 3409), group('P.E.I.', 1, 2486), group('', 2, 2819)],
            { template: 'top_labels_by_measure' });
        expect(result.chart.points.map(point => point.label)).toEqual(['Nova Scotia', 'Newfoundland', 'P.E.I.']);
        expect(result.chart.notes.find(note => note.code === 'unnamed_rows_left_out')).toMatchObject({ rows: 2 });
    });

    test('what the other groups come to is said as it is, cuts included, and nothing is a share of a whole with parts below zero', () => {
        const groups = [group('Arts', 1, 70), group('Roads', 1, 52), group('Fire', 1, 39), ...range(20).map(i => group('Cut ' + i, 1, -5))];
        const set = setOf(groups);
        const result = shapeCategory(spec({ limit: 3 }), set, grandOf(set, -5), { column: region, measure: amount, j: 0 });
        expect(result.chart.other).toEqual({ groups: 20, value: -100 });
        expect(result.chart.points.every(point => point.share === undefined)).toBe(true);
    });

    test('a long label is a group like any other: notes were set aside with their rows', () => {
        const long = 'Toronto, Canada; Prestwick, Scotland; Kiev, Ukraine; Brussels, Belgium; Riga, Latvia; Keflavik, Iceland; Ottawa, Canada';
        const result = shape([group(long, 1, 29), group('Ottawa, Canada', 3, 12), group('Victoria, Canada', 2, 10)]);
        expect(result.chart.points[0].label).toBe(long);
        expect(result.chart.notes.map(note => note.code)).not.toContain('notes_rows_left_out');
    });

    test('one group with nearly everything is no comparison; labels in code are none either', () => {
        expect(shape([group('Contract', 10, 960), group('Grant', 2, 30), group('Other', 1, 10)]).reason).toBe('one_group');
        expect(shape([group('*GD', 4, 400), group('*SRV', 4, 300), group('*CNST', 4, 200)]).reason).toBe('code_labels');
    });
});

describe('periods a table barely covers', () => {
    const axis = { id: 't:year', kind: 'year_number', columns: ['year'] };
    const year = { id: 'year', label: 'year', type: 'INTEGER', role: 'time', time: { kind: 'year_number', grain: 'year' } };
    const counts = (pairs) => pairs.map(([key, n]) => ({ key: String(key), label: String(key), spellings: 1, n, nx: 0, groups: pairs.length, measures: [] }));
    const spec = { id: 'c_t', template: 'records_over_time', kind: 'line', x: { type: 'time', axis: 't:year', grain: 'year' }, y: { agg: 'count' }, limit: 60, score: 46 };
    const run = (pairs, now = Date.parse('2026-11-12T00:00:00Z')) => shapeTime(spec, counts(pairs),
        { n: pairs.reduce((sum, [, n]) => sum + n, 0), nx: 0, measures: [] }, { axis, columns: [year], measure: null, j: null, ordered: true, now });

    test('years at the edges with a sliver of the rows are left out, and so is the year in progress', () => {
        const result = run([[2016, 625], [2017, 169643], [2018, 188577], [2019, 194089], [2020, 185709], [2021, 198212], [2025, 186207], [2026, 150000]]);
        expect(result.chart.points.map(point => point.start.slice(0, 4))).toEqual(['2017', '2018', '2019', '2020', '2021', '2025']);
        expect(result.chart.notes.find(note => note.code === 'sparse_periods_left_out')).toMatchObject({ periods: 1, rows: 625 });
        expect(result.chart.notes.find(note => note.code === 'partial_period_left_out')).toMatchObject({ start: '2026-01-01' });
    });

    test('nearly every record on one date is a load date, not a history', () => {
        expect(run([[2000, 9000], [2001, 100], [2002, 120], [2003, 90], [2004, 110]]).reason).toBe('one_period');
    });

    test('groups of a table of monthly figures are compared over the latest year it fills, not a month and not a year in progress', () => {
        const composite = { id: 't:Y+M', kind: 'composite', columns: ['Y', 'M'], grain: 'month' };
        const columns = [{ id: 'Y', type: 'INTEGER', time: { kind: 'year_number' } }, { id: 'M', type: 'TEXT', part: 'month' }];
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const groups = [];
        for (const y of [2024, 2025]) months.forEach(m => groups.push({ key: y + String.fromCharCode(31) + m, n: 10, measures: [{ sum: 5, n: 10 }] }));
        months.slice(0, 8).forEach(m => groups.push({ key: 2026 + String.fromCharCode(31) + m, n: 10, measures: [{ sum: 5, n: 10 }] }));
        const latest = latestPeriod(groups, { axis: composite, columns, grain: 'month', j: 0, now: Date.parse('2026-11-12T00:00:00Z') });
        expect(latest).toMatchObject({ start: '2025-01-01', grain: 'year' });
        expect(latest.keys).toHaveLength(12);
    });
});

describe('one chart per finding', () => {
    test('the same groups in the same proportions are one chart: hectares beside square metres', async () => {
        // One row per zone and year: a table of figures.
        const rows = range(120).map(i => ['Zone ' + (i % 6), String(2001 + Math.floor(i / 6)), 10 + (i % 6) * 3 + scatter(i, 7)])
            .map(([zone, year, hectares]) => [zone, year, String(hectares), String(hectares * 10000)]);
        const analysis = await analyze('proportional', table([text('Zone'), integer('Year'), integer('Fire area in hectares'), integer('Fire area (m2)')], rows));
        const byZone = analysis.charts.filter(chart => chart.x.column === 'Zone');
        expect(byZone).toHaveLength(1);
        expect(analysis.skipped.map(skip => skip.reason)).toContain('same_as_other_chart');
    });

    test('groups of a table of records say which years they count', async () => {
        const rows = range(240).map(i => ['Type ' + (i % 4), (2019 + (i % 5)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), String(100 + scatter(i, 500)), 'P-' + (100000 + i)]);
        const analysis = await analyze('span', table([text('Type'), date('Issued'), integer('Number of units'), text('Permit')], rows));
        const share = analysis.charts.find(chart => chart.x.column === 'Type');
        expect(share.span).toEqual({ grain: 'year', first: '2019-01-01', last: '2023-01-01' });
    });
});

describe('third reading: files that are not one table, and figures that move for other reasons', () => {
    test('blocks stacked without a column that names them are not added up: an all-ages block over its age groups', async () => {
        const items = ['Number of taxable returns', 'Employment income', 'Net income', 'Total income assessed'];
        const rows = [];
        // The same lines once for all ages, then once per age group, with nothing that says which.
        for (let block = 0; block < 4; block += 1) items.forEach((item, line) => rows.push([item, String(line + 1), String(2010), String(1000 * (4 - block) + line)]));
        const { model, profile } = await read(table([text('Item'), integer('Line'), integer('Year'), integer('Amount')], rows));
        expect(profile.groups.duplicate_keys).toBe(1);
        expect(model.shape).toBe('stacked');
        expect(listCandidates(model)).toEqual([]);
    });

    test('a breakdown with a member named for a total on many rows makes the rows figures, whatever key they carry', async () => {
        const places = ['Canada', 'Nova Scotia', 'New Brunswick', 'Ontario', 'Halifax County', 'Kings County', 'Ottawa'];
        const rows = [];
        places.forEach((place, p) => ['Female', 'Male', 'Total'].forEach((sex, s) => rows.push(['G' + p, place, sex, String(1000 + p * 10 + (s === 2 ? 1000 : s))])));
        const { model } = await read(table([text('GeoCode'), text('GeogName'), text('Sex'), integer('Count of persons')], rows));
        expect(model.records).toBe(false);
        expect(reasons(model, 'GeogName')).toContain('mixed_levels');
    });

    test('rates by their unit, totals run into their name, and totals past the most frequent values are found', async () => {
        for (const name of ['CO2 Emissions (g/km)', 'Fuel Consumption City (L/100 km)', 'Combined (mpg)', 'Cost ($/hour)']) {
            expect([name, nameEvidence(name).nonAdditive]).toEqual([name, true]);
        }
        expect([isTotalLabel('TOTALZONE 2'), isTotalLabel('SOUSTOTAL'), isTotalLabel('Totally Spies')]).toEqual([true, true, false]);
        // "Total Expenditures" in 8 of 11 years, beneath payees that recur more often.
        const rows = [];
        for (let year = 0; year < 11; year += 1) {
            range(40).forEach(p => rows.push([String(2014 + year), 'Payee ' + p, String(1000 + p)]));
            if (year < 8) rows.push([String(2014 + year), 'Total Expenditures', String(99999)]);
        }
        const { model } = await read(table([integer('Year'), text('Payee'), integer('Amount')], rows));
        expect(column(model, 'Payee').category.total_members).toContain('total expenditures');
    });

    test('a column written once per block and blank below it groups nothing in a table of figures', async () => {
        const rows = [['Nova Scotia', 'Maritimes', '5195'], ['', 'Gulf', '796'], ['New Brunswick', 'Maritimes', '898'], ['', 'Gulf', '2023'],
            ['P.E.I.', 'Gulf', '2486'], ['Quebec', 'Quebec', '1278'], ['Newfoundland', 'Newfoundland', '3409']];
        const { model } = await read(table([text('Province'), text('Region'), integer('Total licences')], rows));
        expect(reasons(model, 'Province')).toContain('fill_down');
        expect(listCandidates(model).some(spec => spec.x.column === 'Province')).toBe(false);
        expect(listCandidates(model).some(spec => spec.x.column === 'Region')).toBe(true);
    });

    test('a date that stands for "no date" has no period, in SQL as in the profile', async () => {
        const rows = range(120).map(i => ['P-' + (1000 + i), i % 10 === 0 ? '1900-01-01' : (2015 + (i % 8)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), 'Type ' + (i % 3)]);
        const input = table([text('Permit'), date('Issued'), text('Type')], rows);
        const { model } = await read(input);
        expect(column(model, 'Issued').time).toMatchObject({ placeholders: ['1900-01-01'] });
        const analysis = await analyze('placeholder-dates', input);
        const line = analysis.charts.find(chart => chart.x.type === 'time');
        expect(line.points[0].start.slice(0, 4)).toBe('2015');
        expect(line.notes.find(note => note.code === 'rows_without_period')).toMatchObject({ rows: 12 });
    });

    test('a year still in progress is left out of a line even with all its rows; so is a thin last year', () => {
        const axis = { id: 't:year', kind: 'year_number', columns: ['year'] };
        const year = { id: 'year', label: 'year', type: 'INTEGER', role: 'time', time: { kind: 'year_number', grain: 'year' } };
        const amount = { id: 'Claims', label: 'Claims', type: 'INTEGER', role: 'measure', measure: { additive: 'yes', integer: true, text: false, clean: null, percent: false,
            currency: false, ambiguous: false, unit: null } };
        const groups = pairs => pairs.map(([key, n, sum]) => ({ key: String(key), label: String(key), spellings: 1, n, nx: 0, groups: pairs.length,
            measures: [{ sum, n, min: 0, max: sum, blank: 0, missing: 0, other: 0 }] }));
        const spec = { id: 'c_y', template: 'measure_over_time', kind: 'line', x: { type: 'time', axis: 't:year', grain: 'year' }, y: { agg: 'sum', column: 'Claims' },
            limit: 60, score: 60 };
        const run = pairs => { const set = groups(pairs); return shapeTime(spec, set, { n: set.reduce((sum, g) => sum + g.n, 0), nx: 0,
            measures: [{ sum: set.reduce((sum, g) => sum + g.measures[0].sum, 0), n: set.reduce((sum, g) => sum + g.n, 0), min: 0, max: null, blank: 0, missing: 0,
                other: 0 }] }, { axis, columns: [year], measure: amount, j: 0, ordered: true, now: Date.parse('2026-11-12T00:00:00Z') }); };
        const result = run([[2021, 12, 90000], [2022, 12, 95000], [2023, 12, 99000], [2024, 12, 104000], [2025, 12, 113005], [2026, 12, 37745]]);
        expect(result.chart.points.map(point => point.start.slice(0, 4))).toEqual(['2021', '2022', '2023', '2024', '2025']);
        const thin = run([[2018, 600, 9000], [2019, 520, 9500], [2020, 610, 9900], [2021, 69, 570]]);
        expect(thin.chart.points.map(point => point.start.slice(0, 4))).toEqual(['2018', '2019', '2020']);
        expect(thin.chart.notes.map(note => note.code)).toContain('sparse_periods_left_out');
    });

    test('a sum over time whose suppressed cells come and go is no trend; a steady share of them is', () => {
        const axis = { id: 't:year', kind: 'year_number', columns: ['year'] };
        const year = { id: 'year', label: 'year', type: 'INTEGER', role: 'time', time: { kind: 'year_number', grain: 'year' } };
        const amount = { id: 'Spending', label: 'Spending', type: 'TEXT', role: 'measure', measure: { additive: 'yes', integer: true, text: true,
            clean: { core: 'plain', missing: ['x'] }, percent: false, currency: false, ambiguous: false, unit: null } };
        const spec = { id: 'c_s', template: 'measure_over_time', kind: 'line', x: { type: 'time', axis: 't:year', grain: 'year' }, y: { agg: 'sum', column: 'Spending' },
            limit: 60, score: 60 };
        const run = missing => {
            const set = missing.map((m, i) => ({ key: String(1998 + i), label: String(1998 + i), spellings: 1, n: 100, nx: 0, groups: missing.length,
                measures: [{ sum: 1000 * (100 - m), n: 100 - m, min: 1, max: 9, blank: 0, missing: m, other: 0 }] }));
            const total = set.reduce((sum, g) => sum + g.measures[0].missing, 0);
            const parsed = set.reduce((sum, g) => sum + g.measures[0].n, 0);
            return shapeTime(spec, set, { n: 100 * set.length, nx: 0, measures: [{ sum: 1, n: parsed, min: 1, max: 9, blank: 0, missing: total, other: 0 }] },
                { axis, columns: [year], measure: amount, j: 0, ordered: true, now: Date.parse('2026-11-12T00:00:00Z') });
        };
        expect(run([5, 40, 6, 5, 7]).reason).toBe('suppressed_trend');
        expect(run([60, 62, 61, 63, 60]).ok).toBe(true);
    });

    test('a measure with figures below zero shows the largest either way', async () => {
        const rows = range(48).map(i => ['Item ' + (i + 1), 'Service ' + (i % 24), String(i % 2 ? 1000 * (i + 1) : -2000 * (i + 1))]);
        const analysis = await analyze('signed', table([text('Project'), text('Service'), integer('Capital budget ($)')], rows));
        const chart = analysis.charts.find(entry => entry.x.column === 'Service' && entry.y.agg === 'sum');
        expect(chart.points.some(point => point.value < 0)).toBe(true);
        expect(chart.points.map(point => point.value)).toEqual([...chart.points.map(point => point.value)].sort((a, b) => b - a));
    });

    test('a measure that is zero on nearly every row, segments of map lines, and lists of things are not charted', async () => {
        const rows = range(200).map(i => ['Seg-' + i, ['Bike lane', 'Path', 'Shared'][i % 3], String(10 + scatter(i, 900)), i < 4 ? String(5000 + i * 100) : '0',
            ['English ; French', 'English', 'French ; Spanish'][i % 3]]);
        const { model } = await read(table([text('Segment'), text('Type'), numeric('Shape__Length'), integer('Number of repairs'), text('Languages')], rows));
        expect(column(model, 'Number of repairs').measure.sparse).toBe(true);
        expect(model.lines).toBe(true);
        expect(column(model, 'Languages').category.flags).toContain('list_labels');
        const specs = listCandidates(model);
        expect(specs.some(spec => spec.y.agg === 'count' || spec.y.column === 'Number of repairs' || spec.x.column === 'Languages')).toBe(false);
    });

    test('a hierarchy flattened into one column, with figures by month, is a stack of blocks', async () => {
        const rows = [];
        ['Newfoundland and Labrador', 'Prince Edward Island', 'Nova Scotia', 'New Brunswick', 'Quebec'].forEach((province, p) => {
            const months = range(6).map(m => 100 + p * 40 + m * 3);
            rows.push([province, ...months.map(String)]);
            rows.push(['Bankruptcies/Faillites', ...months.map(value => String(Math.round(value * 0.2)))]);
            rows.push(['Proposals/Propositions', ...months.map(value => String(value - Math.round(value * 0.2)))]);
        });
        const columns = [text('column_1'), ...['jan/janv', 'feb/fév', 'mar', 'apr/avr', 'may/mai', 'jun/juin'].map(integer)];
        const { model } = await read(table(columns, rows));
        expect(model.shape).toBe('stacked');
    });

    test('a wide table whose rows are the lines of a report is not added up per period; map lines stored as text are segments', async () => {
        const lines = ['Formal requests received under the Privacy Act', 'Requests processed during the reporting period', 'Processed within 30 calendar days',
            'Processed in 31 to 60 calendar days', 'Complaints sent to the Office of the Privacy Commissioner'];
        const report = await read(table([text('Line'), integer('2008-2009'), integer('2009-2010'), integer('2010-2011'), integer('2011-2012')],
            lines.map((line, i) => [line, ...range(4).map(year => String(8000 / (i + 1) + year * 300))])));
        expect(report.model.wide_groups.length).toBe(1);
        expect(listCandidates(report.model).some(spec => spec.template === 'wide_totals_per_period')).toBe(false);

        const rows = range(200).map(i => ['Seg-' + i, ['Bike lane', 'Path', 'Shared'][i % 3], String(10 + scatter(i, 900)), 'LINESTRING(' + i + ' 0, ' + (i + 1) + ' 1)']);
        const { model } = await read(table([text('Segment'), text('Type'), numeric('LONGUEUR'), text('GEOM')], rows));
        expect(model.lines).toBe(true);
        expect(column(model, 'LONGUEUR').measure.additive).toBe('yes');
        const specs = listCandidates(model);
        expect(specs.some(spec => spec.y.agg === 'count')).toBe(false);
        expect(specs.some(spec => spec.y.column === 'LONGUEUR' && spec.x.column === 'Type')).toBe(true);
    });

    test('the years a chart of records counts are all its years, unless few rows have one', async () => {
        const type = i => 'Type ' + (i % 7 < 3 ? 0 : i % 7 < 5 ? 1 : i % 7 < 6 ? 2 : 3);
        const rows = range(240).map(i => ['P-' + (1000 + i), type(i), (2019 + (i % 5)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9)]);
        const analysis = await analyze('span-full', table([text('Permit'), text('Type'), date('Issued')], rows));
        expect(analysis.charts.find(chart => chart.x.column === 'Type').span).toEqual({ grain: 'year', first: '2019-01-01', last: '2023-01-01' });
        const sparse = range(240).map(i => ['P-' + (1000 + i), type(i), i % 4 === 0 ? (2019 + (i % 5)) + '-01-15' : null]);
        const few = await analyze('span-few', table([text('Permit'), text('Type'), date('Updated on')], sparse));
        expect(few.charts.find(chart => chart.x.column === 'Type').span).toBeUndefined();
    });
});

describe('fourth reading: tables the rules had never seen', () => {
    test('a member named for all the others is a total in a table of figures, and a value like any other in a list', async () => {
        // Reported cases by sex, with "All" whose figure is not quite the sum of the others (suppressed cells).
        const rows = [];
        ['Salmonella', 'Pertussis', 'Mumps', 'Measles'].forEach((disease, d) => [2019, 2020, 2021, 2022].forEach(year => {
            const female = 400 + d * 90 + (year - 2019) * 7;
            const male = 380 + d * 70 + (year - 2019) * 5;
            rows.push([disease, 'Female', String(year), String(female)], [disease, 'Male', String(year), String(male)],
                [disease, 'Unknown', String(year), String(3 + d)], [disease, 'All', String(year), String(female + male + 3 + d + 9)]);
        }));
        const input = table([text('disease'), text('sex'), integer('year'), text('number-of-reported-cases')], rows);
        const { model } = await read(input);
        expect(model.records).toBe(false);
        expect(column(model, 'sex').category.total_members).toContain('all');
        const analysis = await analyze('all-member', input);
        const bySex = analysis.charts.find(chart => chart.x.column === 'sex');
        expect(bySex.points.map(point => point.label)).toEqual(['Female', 'Male', 'Unknown']);
        // "All" goes with the name of a breakdown: "All City facilities" is a kind of project.
        expect([isAllLabel('All ages'), isAllLabel('Tous les âges'), isAllLabel('Les deux'), isAllLabel('All City facilities'),
            isAllLabel('All other countries'), isAllLabel('Allergies')]).toEqual([true, true, true, false, false, false]);

        // A list of programmes: "All" is where a programme applies, not a total of the others.
        const programmes = range(90).map(i => ['PRG-' + (1000 + i), ['All', 'Ward 1', 'Ward 2', 'Ward 3'][i % 4], ['Grant', 'Loan', 'Rebate'][i % 3]]);
        const list = await read(table([text('Programme'), text('Eligible area'), text('Kind')], programmes));
        expect(list.model.records).toBe(true);
        expect(column(list.model, 'Eligible area').category.total_members || []).not.toContain('all');
    });

    test('bands that overlap are totals beside their parts, whatever they are called', async () => {
        const ages = ['0 à 18 ans', '19 ans et +', '19 à 30 ans', '31 à 50 ans', '51 à 70 ans', '71 ans et +', '1 an', '2 à 3 ans', '6 à 11 mois'];
        const rows = [];
        ['Légumes', 'Fruits', 'Viandes', 'Céréales'].forEach((food, f) => ['Femmes', 'Hommes', 'Les deux'].forEach((sex, s) => ages.forEach((age, a) => {
            rows.push([food, sex, age, String((s === 2 ? 2 : 1) * (300 + f * 40 + a * 13))]);
        })));
        const { model } = await read(table([text('Groupe d’aliments'), text('Sexe'), text('Âge'), text('Nombre de répondants')], rows));
        expect(reasons(model, 'Âge')).toContain('overlapping_bands');
        expect(column(model, 'Nombre de répondants').measure.blocked_by).toContainEqual({ column: 'Âge', why: 'levels' });
        expect(column(model, 'Sexe').category.total_members).toContain('les deux');
        // Bands that only touch are one breakdown.
        const clean = [];
        ['0 to 14', '15 to 24', '25 to 44', '45 to 64', '65 and over'].forEach((age, a) => ['Ontario', 'Quebec', 'Manitoba'].forEach((place, p) => {
            clean.push([place, age, String(1000 + a * 70 + p * 9)]);
        }));
        const plain = await read(table([text('Province'), text('Age group'), integer('Persons')], clean));
        expect(reasons(plain.model, 'Age group')).not.toContain('overlapping_bands');
        expect(column(plain.model, 'Persons').measure.blocked_by).toEqual([]);
    });

    test('figures flagged E, p or r are figures, so a survey table stays a table of figures', async () => {
        expect([parseNumber('635E', { core: 'plain', marks: true }), parseNumber('1,204p', { core: 'thousands_comma', marks: true }),
            parseNumber('12 r', { core: 'plain', marks: true })]).toEqual([635, 1204, 12]);
        const rows = [];
        ['19 to 30 years', '31 to 50 years', '51 to 70 years', '71 years and over'].forEach((age, a) => ['Males', 'Females', 'Both sexes'].forEach((sex, s) => {
            ['Yes', 'No'].forEach((answer, k) => rows.push([age, sex, answer, String(200 + a * 90 + s * 40 + k * 300), String(3000 + a * 50 + s * 9 + k),
                k ? String(140 + a * 3 + s) : (500 + a * 20 + s) + 'E']));
        }));
        const { model } = await read(table([text('Age group'), text('Sex'), text('High blood pressure'), text('n'), integer('Mean'), text('Mean_SE')], rows));
        expect(column(model, 'Mean_SE').role).toBe('measure');
        expect(model.records).toBe(false);
        expect(column(model, 'Sex').category.total_members).toContain('both sexes');
    });

    test('shapes on a map written as text are geometry, whatever the column is called', async () => {
        const shapes = ['POINT (-73 46)', 'POINT (-111.38 56.72)', 'POLYGON ((-114 51, -113 51, -113 52, -114 51))', 'MULTIPOLYGON (((-98 49, -97 49, -97 50, -98 49)))',
            'SRID=4326;POINT (-66.1 45.3)', '{"type":"LineString","coordinates":[[-79.4,43.6],[-79.3,43.7]]}'];
        const rows = range(60).map(i => ['EV-' + (100 + i), ['Flood', 'Wildfire', 'Storm'][i % 3], shapes[i % shapes.length], String(1000000 + scatter(i, 900) * 1000)]);
        const { model } = await read(table([text('Event'), text('Group'), text('GEOG_OBJ'), integer('Estimated total cost')], rows));
        expect(column(model, 'GEOG_OBJ').role).toBe('geometry');
        expect(listCandidates(model).some(spec => spec.x.column === 'GEOG_OBJ')).toBe(false);
    });

    test('a filter is offered only when it leads to a chart: a ratio or a measure named by a code is charted under none', async () => {
        const rows = [];
        ['Bank A', 'Bank B', 'Bank C', 'Bank D', 'Bank E'].forEach((bank, b) => [2021, 2022, 2023, 2024].forEach(year => {
            rows.push([bank, String(year), 'Net income', String(1000 + b * 300 + year)], [bank, String(year), 'Capital ratio', String(12 + b) + '.5'],
                [bank, String(year), 'Deposits', String(90000 + b * 7000 + year)]);
        }));
        const analysis = await analyze('offered-pins', table([text('Bank'), integer('Fiscal year'), text('Data point'), text('Measure value')], rows));
        const block = analysis.blocked.find(entry => entry.column === 'Data point');
        expect(Object.fromEntries(block.values.map(entry => [entry.value, entry.charts]))).toEqual({ 'Net income': true, 'Capital ratio': false, Deposits: true });
        expect(block.charts).toBe(true);

        const codes = rows.map(([bank, year, item, value]) => [bank, year, { 'Net income': '0300', 'Capital ratio': '0302', Deposits: '0317' }[item], value]);
        const coded = await analyze('offered-codes', table([text('Bank'), integer('Fiscal year'), text('Data point'), text('Measure value')], codes));
        const none = coded.blocked.find(entry => entry.column === 'Data point');
        expect(none.values.every(entry => entry.charts === false)).toBe(true);
        expect(none.charts).toBe(false);
    });

    test('bands of a count are what the rows are broken down by, and answers chosen from a list are groups however long', async () => {
        const holders = [11838120, 4646450, 1668360, 643650, 261400, 119470, 58810, 31540, 17520, 26040];
        const rows = holders.map((count, i) => [i < 9 ? String(i + 1) : '10 et plus', String(count)]);
        const input = table([text('Nombre de CELI ouverts'), integer('Nombre de titulaires de CELI')], rows);
        const { model } = await read(input);
        expect(column(model, 'Nombre de CELI ouverts')).toMatchObject({ role: 'code', reasons: [{ code: 'count_bands' }] });
        const analysis = await analyze('count-bands', input);
        expect(analysis.charts.find(chart => chart.x.column === 'Nombre de CELI ouverts' && chart.y.column === 'Nombre de titulaires de CELI')).toBeTruthy();
        // Numbers that do not run from 0 or 1 without a gap are not bands.
        const gaps = await read(table([text('Code'), integer('Amount')], [['1', '10'], ['2', '20'], ['5', '30'], ['10 et plus', '40']]));
        expect(column(gaps.model, 'Code').reasons[0].code).not.toBe('count_bands');

        const answers = ['My institution has full capacity to process unclassified paper records',
            'My institution has partial capacity to process unclassified paper records', 'My institution has no capacity to process unclassified paper records'];
        const survey = range(152).map(i => ['Institution ' + i, answers[i % 13 < 6 ? 0 : i % 13 < 11 ? 1 : 2]]);
        const answered = await read(table([text('Institution name'), text('4 a) Unclassified records')], survey));
        expect(column(answered.model, '4 a) Unclassified records').role).toBe('category');
        expect(listCandidates(answered.model).some(spec => spec.x.column === '4 a) Unclassified records' && spec.y.agg === 'count')).toBe(true);
    });

    test('a name in capitals that goes on from "TOTAL" is not a total', () => {
        expect([isTotalLabel('TOTALLY NUTS & MORE INC.'), isTotalLabel('TOTALITY'), isTotalLabel('TOTALZONE 2'), isTotalLabel('SOUSTOTAL')])
            .toEqual([false, false, true, true]);
    });

    test('records dated after today are left out, and so is a last month the dates stop inside', () => {
        const DAY = 86400000;
        const axis = { id: 't:Issued', columns: ['Issued'], kind: 'typed', grain: 'month', bucket: 'month' };
        const issued = last => ({ id: 'Issued', label: 'Issued', type: 'DATE', role: 'time', time: { kind: 'typed', grain: 'month', last } });
        const spec = { id: 'c_t', template: 'records_over_time', kind: 'line', x: { type: 'time', axis: 't:Issued', grain: 'month' }, y: { agg: 'count' },
            limit: 60, score: 46 };
        const months = counts => counts.map(([start, n]) => ({ key: start, label: start, spellings: 1, n, nx: 0, groups: counts.length, measures: [] }));
        const run = (counts, last, records) => { const set = months(counts); return shapeTime(spec, set, { n: set.reduce((sum, g) => sum + g.n, 0), nx: 0, measures: [] },
            { axis, columns: [issued(last)], measure: null, j: null, ordered: true, now: Date.parse('2026-11-13T00:00:00Z'), records }); };
        // Readings every hour at four stations: the count is the number of hours.
        const hourly = [['2025-08-01', 2976], ['2025-09-01', 2880], ['2025-10-01', 2976], ['2025-11-01', 2880], ['2025-12-01', 2976], ['2026-01-01', 1728]];
        expect(run(hourly, Date.parse('2026-01-31T00:00:00Z') / DAY, true).reason).toBe('flat');
        // Complaints up to 18 January.
        const air = [['2025-08-01', 3120], ['2025-09-01', 2710], ['2025-10-01', 2994], ['2025-11-01', 3305], ['2025-12-01', 2870], ['2026-01-01', 1728]];
        const cut = run(air, Date.parse('2026-01-18T00:00:00Z') / DAY, true);
        expect(cut.chart.points.map(point => point.start)).toEqual(['2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01']);
        expect(cut.chart.notes.find(note => note.code === 'cut_period_left_out')).toMatchObject({ start: '2026-01-01', date: '2026-01-18', rows: 1728 });
        // A month the dates run to the end of stays, however few its rows.
        expect(run(air, Date.parse('2026-01-31T00:00:00Z') / DAY, true).chart.points).toHaveLength(6);
        // Licences dated next month: not yet; this month is not over either.
        const licences = [['2026-05-01', 40], ['2026-06-01', 44], ['2026-07-01', 39], ['2026-08-01', 47], ['2026-09-01', 52], ['2026-10-01', 49], ['2026-11-01', 21],
            ['2026-12-01', 30]];
        const ahead = run(licences, Date.parse('2026-12-03T00:00:00Z') / DAY, true);
        expect(ahead.chart.points.map(point => point.start).slice(-1)).toEqual(['2026-10-01']);
        expect(ahead.chart.notes.map(note => note.code)).toEqual(expect.arrayContaining(['future_periods_left_out', 'partial_period_left_out']));
        // Figures of future periods are projections, and stay.
        expect(run(licences, Date.parse('2026-12-03T00:00:00Z') / DAY, false).chart.notes.map(note => note.code)).not.toContain('future_periods_left_out');
    });

    test('a list of records with each name written once above its block groups nothing by that name', async () => {
        const rows = range(131).map(i => [i % 6 === 1 ? 'Approver ' + Math.floor(i / 6) : '', 'PO-' + (5000 + i), ['Hydro', 'Bell', 'Uline', 'Grainger'][i % 4],
            (100 + scatter(i, 4000)) + '.25']);
        const { model } = await read(table([text('Approbateur'), text('Numéro bon'), text('Nom fournisseur'), text('Montant')], rows));
        expect(reasons(model, 'Approbateur')).toContain('fill_down');
        expect(listCandidates(model).some(spec => spec.x.column === 'Approbateur')).toBe(false);
    });

    test('a count over time shows a month with no record as a zero, and years a large file lacks as gaps', () => {
        const axis = { id: 't:year', kind: 'year_number', columns: ['year'] };
        const year = { id: 'year', label: 'year', type: 'INTEGER', role: 'time', time: { kind: 'year_number', grain: 'year' } };
        const spec = { id: 'c_c', template: 'records_over_time', kind: 'line', x: { type: 'time', axis: 't:year', grain: 'year' }, y: { agg: 'count' },
            limit: 60, score: 46 };
        const run = pairs => { const set = pairs.map(([key, n]) => ({ key: String(key), label: String(key), spellings: 1, n, nx: 0, groups: pairs.length, measures: [] }));
            return shapeTime(spec, set, { n: set.reduce((sum, g) => sum + g.n, 0), nx: 0, measures: [] },
                { axis, columns: [year], measure: null, j: null, ordered: true, now: Date.parse('2026-11-13T00:00:00Z'), records: true }); };
        const few = run([[2015, 3], [2016, 5], [2018, 2], [2019, 4], [2020, 6]]);
        expect(few.chart.points.map(point => [point.start.slice(0, 4), point.value])).toEqual([['2015', 3], ['2016', 5], ['2017', 0], ['2018', 2], ['2019', 4], ['2020', 6]]);
        const many = run([[2013, 880], [2014, 905], [2015, 900], [2016, 950], [2017, 990], [2020, 1010], [2021, 1040]]);
        expect(many.chart.points.map(point => point.start.slice(0, 4))).toEqual(['2013', '2014', '2015', '2016', '2017', '2020', '2021']);
        expect(many.chart.time.missing).toEqual(['2018-01-01', '2019-01-01']);
        // One row every second year: a survey taken every second year, drawn as it is.
        const biennial = run([[2010, 4], [2012, 6], [2014, 5], [2016, 7], [2018, 6], [2020, 8]]);
        expect(biennial.chart.points.map(point => point.value)).toEqual([4, 6, 5, 7, 6, 8]);
    });

    test('a question number, the respondent\'s device, answers in two languages and a period end are not what records are counted by', async () => {
        expect(['Q5_TRAVAIL_MTL', 'Q2a DropIn', 'Q1. How satisfied are you with the drop-in programs offered', 'Quarter', 'QC']
            .map(name => nameEvidence(name).questionCode)).toEqual([true, true, false, false, false]);
        const rows = range(120).map(i => ['R-' + (1000 + i), ['Windows', 'iOS', 'Android', 'Mac OS X'][i % 4], ['Oui', 'Yes', 'Non', 'No'][i % 4],
            ['Pool', 'Arena', 'Library'][i % 3], ['Yes', 'No'][i % 2], (2015 + (i % 8)) + '-03-31']);
        const { model } = await read(table([text('Response ID'), text('Operating System'), text('Q5_TRAVAIL_MTL'), text('Facility'), text('Q1 DropIn'),
            date('Fiscal period end')], rows));
        expect(column(model, 'Operating System').category.flags).toContain('paradata');
        expect(column(model, 'Q5_TRAVAIL_MTL').category.flags).toEqual(expect.arrayContaining(['question_code', 'mixed_languages']));
        expect(column(model, 'Q1 DropIn').category.flags).toContain('question_code');
        expect(reasons(model, 'Fiscal period end')).toContain('period_end_date');
        expect(model.time_axes).toEqual([]);
        const specs = listCandidates(model);
        expect(specs.map(spec => spec.x.column)).toEqual(['Facility']);
    });

    test('the lines of a statement are not ranked as groups of one whole', async () => {
        const lines = ['Number of taxable returns', 'Number of non-taxable returns', 'Total number of returns', 'Employment income', 'Commissions',
            'Old age security pension', 'Net rental income', 'Taxable capital gains', 'Net business income', 'Total income assessed', 'RRSP deduction',
            'Child care expenses', 'Net income', 'Taxable income assessed', 'Basic federal tax', 'Net federal tax'];
        const rows = lines.map((line, i) => [line, String(1000 + i * 937), String(50000 + i * 41013)]);
        const { model } = await read(table([text('Item'), integer('Grand total #'), integer('Grand total $ (000)')], rows));
        expect(column(model, 'Item').category.flags).toContain('statement_lines');
        expect(listCandidates(model).some(spec => spec.x.column === 'Item')).toBe(false);
    });

    test('fiscal years that lack some of their quarters are not drawn as whole years, nor compared as the latest', async () => {
        const quarters = { '2013-14': ['Q4'], '2014-15': ['Q1', 'Q2', 'Q3', 'Q4'], '2015-16': ['Q1', 'Q2', 'Q3', 'Q4'], '2016-17': ['Q1', 'Q2', 'Q3', 'Q4'],
            '2017-18': ['Q2', 'Q3', 'Q4'], '2018-19': ['Q1', 'Q2', 'Q3', 'Q4'], '2019-20': ['Q1', 'Q2', 'Q3', 'Q4'], '2020-21': ['Q1', 'Q2', 'Q3', 'Q4'],
            '2021-22': ['Q1', 'Q2', 'Q3'] };
        const rows = [];
        Object.entries(quarters).forEach(([year, list], y) => list.forEach(quarter => ['Patient protection', 'Product or device', 'Care management'].forEach((category, c) => {
            rows.push([category, year, quarter, String(5 + ((y * 7 + c * 3 + quarter.charCodeAt(1)) % 11))]);
        })));
        const input = table([text('Category'), text('Year'), text('Quarter'), integer('Quantity')], rows);
        const { model } = await read(input);
        expect(column(model, 'Year').time.incomplete).toEqual(['2013-14', '2017-18', '2021-22']);
        expect(column(model, 'Quarter').role).toBe('time_part');
        const analysis = await analyze('fiscal-quarters', input);
        const line = analysis.charts.find(chart => chart.x.type === 'time');
        expect(line.points.map(point => point.start.slice(0, 4))).toEqual(['2014', '2015', '2016', '2018', '2019', '2020']);
        expect(line.time.missing).toEqual(['2017-01-01']);
        expect(line.notes.find(note => note.code === 'incomplete_periods_left_out')).toMatchObject({ periods: 3 });
        const shares = analysis.charts.find(chart => chart.x.column === 'Category');
        expect(shares.period).toMatchObject({ start: '2020-01-01' });
    });

    test('"Numéro de permis" names a permit and "Nombre de permis" counts them', async () => {
        for (const name of ['Numéro de permis (LOPC)', 'No de dossier', 'N° de lot', '# de client', 'Numéro du lot']) {
            expect([name, nameEvidence(name).identifier, nameEvidence(name).additive]).toEqual([name, true, false]);
        }
        for (const name of ['Nombre de permis', 'Nb de cas', 'Nbre d’employés', 'Number of permits', 'No. of employees', '# of visits']) {
            expect([name, nameEvidence(name).identifier, nameEvidence(name).additive]).toEqual([name, false, true]);
        }
        const rows = [['1208', 'Imperial Oil Resources Limited'], ['1210', 'Imperial Oil Resources N.W.T. Limited'], ['1212', 'ExxonMobil Canada Ltd.'],
            ['1222', 'Canadian Natural Resources Limited'], ['1239', 'SHIHA Energy Transmission Ltd.'], ['1241', 'NXT Energy Solutions Inc.']];
        const { model } = await read(table([integer('Numéro de permis (LOPC)'), text('Société')], rows));
        expect(column(model, 'Numéro de permis (LOPC)').role).not.toBe('measure');
        expect(listCandidates(model).some(spec => spec.y.column === 'Numéro de permis (LOPC)')).toBe(false);
    });
});
