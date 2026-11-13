// Rules that came out of reading real publisher tables. Each test is a small
// table with the shape of the one that showed the problem.
const { samplePlan, profileSample } = require('../services/charts/profile');
const { buildTableModel, pinnedModel } = require('../services/charts/model');
const { listCandidates, pickDiverse } = require('../services/charts/candidates');
const { validateSpec } = require('../services/charts/spec');
const { nameEvidence } = require('../services/charts/tokens');
const fixtures = require('./fixtures/charts/tables');

const NOW = new Date('2026-11-12T00:00:00Z');
const text = id => ({ id, type: 'TEXT', original_label: id });
const integer = id => ({ id, type: 'INTEGER', original_label: id });
const numeric = id => ({ id, type: 'NUMERIC', original_label: id });
const table = (columns, rows) => ({ columns, rows: rows.map((row, i) => [i + 1, ...row]) });
const range = count => Array.from({ length: count }, (_, i) => i);
const scatter = (i, span) => (i * 7919 + 4513) % span;

async function read(input) {
    const plan = samplePlan({ rowCount: input.rows.length, columns: input.columns });
    const profile = await profileSample({ columns: input.columns, rows: input.rows, plan });
    return { profile, model: buildTableModel(profile, { rowCount: input.rows.length, now: NOW }) };
}
const column = (model, id) => model.columns.find(entry => entry.id === id);
const roles = model => Object.fromEntries(model.columns.map(entry => [entry.id, entry.role]));

describe('reading columns', () => {
    test('a year column with a stray "0" is still the time axis', async () => {
        const { model } = await read(table([integer('year'), text('org'), integer('contracts')],
            range(120).map(i => [i === 7 ? '0' : String(2016 + (i % 10)), 'org-' + (i % 6), String(scatter(i, 90))])));
        expect(column(model, 'year')).toMatchObject({ role: 'time', time: { kind: 'year_number', first: 2016, last: 2025 } });
    });

    test('forecast years run decades ahead, and one row per year means every number is a figure', async () => {
        const { model } = await read(table([integer('Year'), integer('City'), integer('Forecast - Low'), integer('Forecast - High')],
            range(49).map(i => [String(1993 + i), String(638300 + i * 3517), String(842800 + i * 811), String(1004000 + i * 10600)])));
        expect(column(model, 'Year').time).toMatchObject({ kind: 'year_number', last: 2041 });
        expect(roles(model)).toMatchObject({ City: 'measure', 'Forecast - Low': 'measure', 'Forecast - High': 'measure' });
        expect(listCandidates(model)[0]).toMatchObject({ template: 'measure_over_time', single: true });
    });

    test('a block of notes under the table is set aside, and "no production" is a placeholder', async () => {
        const rows = range(150).map(i => [String(1866 + i), i % 40 === 5 ? 'no production' : (30000 + i * 187000).toLocaleString('en-CA'),
            i % 40 === 5 ? 'no production' : '$' + (1000 + i * 39000).toLocaleString('en-CA')]);
        rows.push(['Metadata', '', ''], ['e', 'Preliminary estimates', ''], ['c', 'Confidential', ''], ['C$', 'Canadian dollars of the day (nominal)', ''],
            ['Source', 'British Columbia Ministry of Energy, Mines and Low Carbon Innovation', '']);
        const { model, profile } = await read(table([text('Year'), text('Coal_tonnes'), text('Coal_value_C$')], rows));
        expect(profile.rows.excluded.map(row => row.id)).toEqual([151, 152, 153, 154, 155]);
        expect(model.excluded_rows).toEqual([151, 152, 153, 154, 155]);
        expect(column(model, 'Year').role).toBe('time');
        expect(column(model, 'Coal_tonnes')).toMatchObject({ role: 'measure', measure: { clean: { core: 'thousands_comma', missing: ['no production'] } } });
        expect(column(model, 'Coal_value_C$').measure).toMatchObject({ currency: true, additive: 'yes' });
    });

    test('"1,072" beside small whole numbers groups thousands, unless the table writes decimals with commas', async () => {
        const counts = ['1,072', '113', '13', '144', '6', '88', '2,310', '45', '9', '301', '77', '18'];
        const english = await read(table([text('Type'), text('Total Received')], counts.map((value, i) => ['Type ' + (i % 3), value])));
        expect(column(english.model, 'Total Received')).toMatchObject({ role: 'measure', confidence: 'high', measure: { ambiguous: false, additive: 'yes' } });
        const french = await read(table([text('Type'), text('Total'), text('Taux')], counts.map((value, i) => ['Type ' + (i % 3), value, (i + 1) + ',5'])));
        expect(column(french.model, 'Total')).toMatchObject({ confidence: 'low', measure: { ambiguous: true } });
    });

    test('a slug beside its long title is the code of it; neither is charted when the title is too long and the code is a slug', async () => {
        const orgs = [['cer-rec', 'Canada Energy Regulator | Régie de l\'énergie du Canada, organisme de réglementation du secteur'],
            ['cihr-irsc', 'Canadian Institutes of Health Research | Instituts de recherche en santé du Canada, organisme fédéral'],
            ['cta-otc', 'Canadian Transportation Agency | Office des transports du Canada, tribunal quasi judiciaire indépendant'],
            ['tbs-sct', 'Treasury Board of Canada Secretariat | Secrétariat du Conseil du Trésor du Canada, organisme central']];
        const { model } = await read(table([text('owner_org'), text('owner_org_title'), integer('contracts_count')],
            range(120).map(i => [...orgs[i % 4], String(5 + scatter(i, 70))])));
        expect(column(model, 'owner_org').label_columns).toEqual(['owner_org_title']);
        expect(column(model, 'owner_org_title')).toMatchObject({ role: 'text', code_column: 'owner_org' });
        expect(column(model, 'owner_org').twin).toBeUndefined();
        // "cer-rec" needs a legend: a reader cannot tell the organizations apart by it.
        expect(column(model, 'owner_org').category.flags).toEqual(['code_labels']);
        expect(listCandidates(model).some(spec => spec.x.column === 'owner_org' || spec.x.column === 'owner_org_title')).toBe(false);
    });

    test('"(#)" over a column of counts is not a row number', async () => {
        const { model } = await read(table([text('FSA'), text('(#)'), text('($)')],
            range(60).map(i => ['K' + (i % 10) + String.fromCharCode(65 + Math.floor(i / 10)), String(40 + scatter(i, 900)), String(1000 + scatter(i, 90000))])));
        expect(column(model, '(#)').role).toBe('measure');
        expect(column(model, 'FSA')).toMatchObject({ role: 'identifier', rankable: true });
        // A short key ("K1A") names nothing a reader would recognise, and "(#)" says nothing of what it counts.
        expect(listCandidates(model).some(spec => spec.x.column === 'FSA' || spec.y.column === '(#)')).toBe(false);
    });

    test('a column of keys stays one however many rows are sampled', async () => {
        const { model, profile } = await read(table([integer('id_permis'), text('no_demande'), text('arrondissement'), integer('nb_logements')],
            range(6500).map(i => [String(3000000 + i * 3), 'D' + (100000 + i), 'Arr ' + (i % 19), String(i % 7)])));
        expect(profile.columns[0].distinct).toBe(6500);
        expect(profile.columns[1].est_distinct).toBeGreaterThanOrEqual(6500);
        expect(roles(model)).toMatchObject({ id_permis: 'identifier', no_demande: 'identifier', arrondissement: 'category' });
        expect(listCandidates(model).every(spec => !['id_permis', 'no_demande'].includes(spec.x.column) && spec.y.column !== 'id_permis')).toBe(true);
    });

    test('what a name says about its column', () => {
        const says = (name, kind) => nameEvidence(name)[kind];
        for (const name of ['locationid', 'CODEID', 'Permit No', 'no_demande', 'OBJECTID', 'Reference']) expect(says(name, 'identifier')).toBe(true);
        for (const name of ['EDU_NO_HIGHSCHOOL_15YR', 'No certificate', 'Number of permits', 'Paid', 'Valid']) expect(says(name, 'identifier')).toBe(false);
        for (const name of ['Ward', 'Zone', 'DataGroup_Order', 'Classe']) expect(says(name, 'nominal')).toBe(true);
        for (const name of ['COT (µg/L)', 'Height (cm)', 'Débit [m3/s]', 'Throughput (1000 m3/d)']) expect(says(name, 'unitInName')).toBe(true);
        for (const name of ['Total - %', 'Taux de chômage', 'Median_Wage']) expect(says(name, 'nonAdditive')).toBe(true);
        for (const name of ['nb_logements', 'Nombre de permis', 'Total Gifts']) expect(says(name, 'additive')).toBe(true);
        expect([says('count_id', 'additive'), says('count_id', 'identifier')]).toEqual([false, true]);
        for (const name of ['loc_x', 'DISPY', 'POINT_X', 'UTM Easting', 'Shape__Area']) expect(says(name, 'geometry')).toBe(true);
        for (const name of ['Code - NOC 2021 V1.0', 'Measure_Code', 'CSD UID']) expect(says(name, 'code')).toBe(true);
    });

    test('numbers that name things are grouped by only when few and known for what they are', async () => {
        const { model } = await read(table([integer('Class'), integer('Ward'), integer('LAHT'), integer('Code - NOC'), text('COT (µg/L)'), integer('Number of trips')],
            range(400).map(i => [String(1 + (i % 5)), String(1 + (i % 25)), String(150 + scatter(i, 90)), String([1, 10, 100, 10010, 21, 213][i % 6]),
                String(53 + (i % 7)), String(2000 + scatter(i, 30000))])));
        expect(column(model, 'Class')).toMatchObject({ role: 'code', category: { numeric: true, breakdown: true } });
        // Twenty-five wards are too many bare numbers for a chart; three-digit numbers that say nothing of what they are
        // are averaged, never added up, and never grouped by.
        expect(column(model, 'Ward')).toMatchObject({ role: 'code', reasons: [{ code: 'unit_name' }], category: { breakdown: false } });
        expect(column(model, 'LAHT')).toMatchObject({ role: 'measure', measure: { additive: 'unknown', reason: 'same_length_numbers' } });
        expect(column(model, 'Code - NOC')).toMatchObject({ role: 'code', reasons: [{ code: 'code_name' }] });
        // A unit in the name says the numbers measure something.
        expect(column(model, 'COT (µg/L)').role).toBe('measure');
        const grouped = new Set(listCandidates(model).map(spec => spec.x.column));
        expect([...grouped]).toEqual(expect.arrayContaining(['Class']));
        expect(grouped.has('Ward') || grouped.has('LAHT')).toBe(false);
    });

    test('three-digit counts are numbers, a "Long term" name is no longitude, and "Number" alone is no identifier', async () => {
        const { model } = await read(table([text('Route'), integer('Daily riders'), numeric('Long term care beds'), integer('Number')],
            range(200).map(i => ['R' + (i % 8), String(100 + scatter(i, 800)), String(20 + (i % 40)), String(1 + (i % 37))])));
        expect(roles(model)).toMatchObject({ 'Daily riders': 'measure', 'Long term care beds': 'measure', Number: 'measure' });
        // A grouping word after "by" does not make the column a number given to a thing.
        expect(nameEvidence('Riders by route').nominal).toBe(false);
        expect(nameEvidence('Route').nominal).toBe(true);
    });

    test('unique whole numbers with no name to go by are neither added up nor averaged on the engine\'s initiative', async () => {
        const { model } = await read(table([text('Ward'), integer('Permit')], range(300).map(i => ['Ward ' + (i % 10), String(500 + scatter(i, 99567))])));
        expect(column(model, 'Permit').measure).toMatchObject({ additive: 'unknown', reason: 'unique_whole_numbers', doubtful: true });
        expect(listCandidates(model).some(spec => spec.y.column === 'Permit')).toBe(false);
    });

    test('long headers and padded cells are read in linear time', () => {
        const header = '('.repeat(1000) + '/'.repeat(1000);
        const started = Date.now();
        for (let i = 0; i < 20; i += 1) nameEvidence(header + i);
        expect(Date.now() - started).toBeLessThan(200);
        const { isTotalLabel } = require('../services/charts/tokens');
        const { prep } = require('../services/charts/numberFormats');
        const padded = 'a' + ' '.repeat(5000) + 'b';
        const again = Date.now();
        for (let i = 0; i < 2000; i += 1) { isTotalLabel(padded); prep(padded); }
        expect(Date.now() - again).toBeLessThan(400);
        expect(isTotalLabel('Total-factor productivity')).toBe(false);
        expect(isTotalLabel('Total - Age groups')).toBe(true);
    });

    test('whole-degree latitudes are coordinates, not something to average', async () => {
        const { model } = await read(table([text('Language'), integer('LatitudeNorth_LatitudeNord'), integer('LongitudeEast_LongitudeEst')],
            range(80).map(i => [['English', 'French'][i % 2], String(45 + (i % 30)), String(-140 + (i % 80))])));
        expect(roles(model)).toMatchObject({ LatitudeNorth_LatitudeNord: 'coordinate', LongitudeEast_LongitudeEst: 'coordinate' });
    });

    test('a figure repeated on every row of something larger is not added up over the rows', async () => {
        const projects = range(40).map(p => ({ name: 'Project ' + p, turbines: 3 + (p * 7) % 60, province: ['Ontario', 'Québec', 'Alberta'][p % 3] }));
        const rows = [];
        projects.forEach((project, p) => range(4 + (p % 5)).forEach(i => rows.push([project.name, project.province, String(project.turbines), String(1500 + ((p + i) % 6) * 250)])));
        const { model, profile } = await read(table([text('Project name'), text('Province'), integer('Number of turbines in project'), integer('Turbine rated capacity (kW)')], rows));
        expect(profile.groups.repeated).toEqual([{ measure: 'Number of turbines in project', by: 'Project name', groups: 40 }]);
        expect(column(model, 'Number of turbines in project').measure).toMatchObject({ additive: 'no', reason: 'repeated_per_group' });
        expect(column(model, 'Turbine rated capacity (kW)').measure.additive).not.toBe('no');
        const aggs = Object.fromEntries(listCandidates(model).filter(spec => spec.y.column).map(spec => [spec.y.column, spec.y.agg]));
        // Neither added up nor averaged on the engine's own initiative.
        expect(aggs['Number of turbines in project']).toBeUndefined();
    });

    test('amounts that are nearly all in one currency are read in that currency, and the table is still a list of things', async () => {
        const { model } = await read(table([text('reference'), text('supplier'), text('currency'), numeric('amount'), text('method')],
            range(300).map(i => ['REF-' + (10000 + i), 'Supplier ' + (i % 40), i % 60 === 0 ? 'USD' : 'CAD', String(1000 + scatter(i, 900000)), ['Open', 'Limited', 'Sole'][i % 3]])));
        expect(column(model, 'amount').measure).toMatchObject({ blocked_by: [], only: { column: 'currency', value: 'CAD', why: 'units' } });
        expect(model).toMatchObject({ shape: 'records', records: true });
        expect(listCandidates(model).map(spec => spec.template)).toEqual(expect.arrayContaining(['share_by_category', 'records_by_category']));
    });

    test('hourly and annual wages in one column, told apart by a flag, are not averaged together', async () => {
        const rows = range(400).map(i => {
            const annual = i % 40 === 0;
            return ['NOC ' + (i % 50), ['ON', 'QC', 'BC', 'AB'][i % 4], annual ? '1' : '0', String(annual ? 60000 + scatter(i, 40000) : 18 + (scatter(i, 300) / 10))];
        });
        const { model, profile } = await read(table([text('occupation'), text('prov'), integer('Annual_Wage_Flag'), numeric('Median_Wage')], rows));
        expect(profile.groups.scale_mixed).toEqual([expect.objectContaining({ measure: 'Median_Wage', by: 'Annual_Wage_Flag', separate: true })]);
        // Nearly every row is hourly: the wage is read on those rows alone.
        expect(column(model, 'Median_Wage').measure.only).toMatchObject({ column: 'Annual_Wage_Flag', value: '0' });
    });

    test('one quantity with a long tail is not mistaken for several', async () => {
        const makers = ['Vestas', 'GE', 'Siemens', 'Enercon', 'Senvion', 'Nordex'];
        const { profile } = await read(table([text('Manufacturer'), numeric('Project capacity (MW)')],
            range(360).map(i => [makers[i % 6], String(Number((0.05 * (1 + (i % 6) * 40) * (1 + scatter(i, 97))).toFixed(2)))])));
        expect(profile.groups.scale_mixed.filter(mix => mix.separate)).toEqual([]);
    });

    test('"Account" heads a ledger\'s categories as often as a statement\'s measures: the values decide', async () => {
        const accounts = ['Advertising', 'Telephone', 'Printing', 'Travel', 'Stationery'];
        const ledger = await read(table([text('Member'), text('Account'), numeric('Amount')],
            range(400).map(i => ['Member ' + (i % 15), accounts[i % 5], String(Number((5 + scatter(i, 2000) * (1 + (i % 5))).toFixed(2)))])));
        expect(column(ledger.model, 'Amount').measure.blocked_by).toEqual([]);
        expect(listCandidates(ledger.model).map(spec => spec.x.column)).toContain('Account');
        const lines = [['Total assets', 1e9], ['Net income', 5e6], ['Capital ratio', 0.14], ['Number of branches', 40]];
        const statement = await read(table([text('Institution'), text('Account'), numeric('Amount')],
            range(400).map(i => ['Bank ' + (i % 5), lines[i % 4][0], String(Number((lines[i % 4][1] * (1 + (i % 7) / 10)).toPrecision(6)))])));
        expect(column(statement.model, 'Amount').measure.blocked_by).toEqual([expect.objectContaining({ column: 'Account', why: 'mixed_measures' })]);
    });

    test('headers repeated where a file stacks several tables are set aside', async () => {
        const rows = [];
        range(4).forEach(block => {
            if (block > 0) rows.push(['Age group ' + block + ' males #', 'Age group ' + block + ' males $', 'item_e', 'code1', 'taxyr']);
            range(30).forEach(i => rows.push([String(1000 + scatter(block * 30 + i, 90000)), String(50000 + scatter(i + block, 900000)), 'Item ' + i, 'ABC'[i % 3], '2010']));
        });
        const { model, profile } = await read(table([text('Grand total males #'), text('Grand total males $'), text('item_e'), text('code1'), text('taxyr')], rows));
        expect(profile.rows.headers).toBe(3);
        expect(roles(model)).toMatchObject({ 'Grand total males #': 'measure', 'Grand total males $': 'measure' });
    });

    test('a member named like a total is one in a table of figures', async () => {
        const types = ['Total Expenditures', 'Labour', 'Other Operating Expenses', 'Net Expenditures', 'Ontario Total'];
        const { model } = await read(table([text('Department'), text('Expense Type'), integer('2017 Actuals')],
            range(100).map(i => ['Dept ' + (i % 20), types[i % 5], String(1000 + scatter(i, 90000))])));
        expect(model.records).toBe(false);
        expect(column(model, 'Expense Type').category.total_members.sort()).toEqual(['ontario total', 'total expenditures']);
    });

    test('a placeholder that several columns share is the table\'s blank', async () => {
        const shared = await read(table([text('Language'), text('Level'), integer('Vacancies')],
            range(90).map(i => [i % 3 === 0 ? 'NA' : ['English', 'French'][i % 2], i % 4 === 0 ? 'NA' : ['Federal', 'Provincial'][i % 2], String(1 + (i % 9))])));
        expect(shared.model.blank_tokens).toEqual(['na']);
        const single = await read(table([text('Region code'), text('Level'), integer('Vacancies')],
            range(90).map(i => [['NA', 'EU', 'AS'][i % 3], ['Federal', 'Provincial'][i % 2], String(1 + (i % 9))])));
        expect(single.model.blank_tokens).toEqual([]);
    });

    test('a table with no quantity is a list of things; one whose rows are different measures is not', async () => {
        const list = await read(table([text('Office'), text('Flow'), text('Updated')], range(200).map(i => ['Office ' + (i % 20), ['No delay', '5 minutes', '10 minutes'][i % 3], 'Day ' + (i % 50)])));
        expect(list.model).toMatchObject({ shape: 'records', records: true });
        const mixed = await read(fixtures.measureNames());
        expect(mixed.model).toMatchObject({ shape: 'long_measures', records: false });
        expect(listCandidates(mixed.model)).toEqual([]);
        // Held to one measure, whose name says whether it adds up.
        const income = pinnedModel(mixed.model, [{ column: 'Data Point Label', op: 'eq', value: 'Net income' }]);
        expect(listCandidates(income, { pinned: ['Data Point Label'] }).length).toBeGreaterThan(0);
        const ratio = pinnedModel(mixed.model, [{ column: 'Data Point Label', op: 'eq', value: 'Capital ratio' }]);
        expect(listCandidates(ratio, { pinned: ['Data Point Label'] })).toEqual([]);
        const wide = await read(fixtures.widePeriods());
        expect(wide.model).toMatchObject({ shape: 'wide', records: false });
    });

    test('in a short table too, digits and letters run together are a key', async () => {
        const { model } = await read(table([text('reference_number'), text('minister'), numeric('hours')],
            range(12).map(i => ['C-2022-P1' + (i % 3) + '-0000' + i, ['PM', 'MND', 'GG'][i % 3], String(5 + i * 1.5)])));
        expect(column(model, 'reference_number').role).toBe('identifier');
    });
});

describe('choosing which charts to try', () => {
    test('sums of a table of events come first, then its counts; attributes are not averaged', async () => {
        const { model } = await read(fixtures.cleanEvents());
        const templates = listCandidates(model).map(spec => spec.template);
        expect(templates.slice(0, 3)).toContain('measure_over_time');
        expect(templates.indexOf('share_by_category')).toBeLessThan(templates.indexOf('records_by_category'));
        expect(templates).toEqual(expect.arrayContaining(['share_by_category', 'records_over_time', 'records_by_category']));
        const rates = await read(table([text('Name'), text('Province'), numeric('Hub height (m)')],
            range(300).map(i => ['Turbine ' + i, ['ON', 'QC', 'AB', 'NS'][i % 4], String(60 + (i % 50))])));
        const ranked = listCandidates(rates.model);
        expect(ranked.some(spec => spec.template === 'records_by_category')).toBe(true);
        expect(ranked.some(spec => spec.y.agg === 'avg')).toBe(false);
    });

    test('the charts shown do not repeat themselves', async () => {
        const { model } = await read(fixtures.cleanEvents());
        const picked = pickDiverse(listCandidates(model), { limit: 6 });
        expect(picked.length).toBeLessThanOrEqual(6);
        expect(picked.filter(spec => spec.x.type !== 'category').length).toBeLessThanOrEqual(2);
        expect(picked.filter(spec => spec.y.agg === 'count').length).toBeLessThanOrEqual(3);
        expect(new Set(picked.map(spec => spec.id)).size).toBe(picked.length);
        // Two measures: two charts each at most.
        const two = await read(fixtures.numberFormats());
        const perMeasure = {};
        for (const spec of pickDiverse(listCandidates(two.model), { limit: 6 })) perMeasure[spec.y.column] = (perMeasure[spec.y.column] || 0) + 1;
        expect(Math.max(...Object.values(perMeasure))).toBeLessThanOrEqual(2);
    });

    test('a spec keeps its id from one request to the next', async () => {
        const first = listCandidates((await read(fixtures.codes())).model).map(spec => spec.id);
        const second = listCandidates((await read(fixtures.codes())).model).map(spec => spec.id);
        expect(second).toEqual(first);
        expect(first.every(id => /^c_[0-9a-f]{12}$/.test(id))).toBe(true);
    });

    test('a chart request names what the table has, in the builder\'s words', async () => {
        const { model } = await read(fixtures.yearAndParts());
        expect(validateSpec({ x: { time: 't:Year+Month' }, y: { agg: 'sum', column: 'Permits' } }, model))
            .toMatchObject({ template: 'custom', kind: 'line', x: { type: 'time', axis: 't:Year+Month', grain: 'month' }, y: { agg: 'sum', column: 'Permits' }, limit: 60 });
        expect(validateSpec({ x: { time: 't:Year+Month', grain: 'year' }, y: { agg: 'count' } }, model).x.grain).toBe('year');
        expect(validateSpec({ kind: 'donut', x: { column: 'Region' }, y: { agg: 'count' }, limit: 500 }, model)).toMatchObject({ kind: 'donut', limit: 50 });
        // A year column by itself is its own axis.
        expect(validateSpec({ x: { column: 'Year' }, y: { agg: 'max', column: 'Permits' } }, model).x).toEqual({ type: 'time', axis: 't:Year', grain: 'year' });
        const refuse = raw => { try { validateSpec(raw, model); return null; } catch (error) { return error.publicCode; } };
        expect(refuse({ x: { time: 't:Nope' }, y: { agg: 'count' } })).toBe('INVALID_CHART_SPEC');
        expect(refuse({ x: { time: 't:Year+Month', grain: 'day' }, y: { agg: 'count' } })).toBe('INVALID_CHART_SPEC');
        expect(refuse({ x: { column: 'Region' }, y: { agg: 'sum', column: 'Region' } })).toBe('INVALID_CHART_SPEC');
        expect(refuse({ x: { wide: 'w0' }, y: { agg: 'sum' } })).toBe('INVALID_CHART_SPEC');
        const wide = (await read(fixtures.widePeriods())).model;
        expect(validateSpec({ x: { wide: 'w0' }, y: { agg: 'sum' } }, wide)).toMatchObject({ x: { type: 'wide', group: 'w0' }, y: { agg: 'sum', group: 'w0' } });
    });
});
