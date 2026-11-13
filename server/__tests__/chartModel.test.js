const { samplePlan, profileSample } = require('../services/charts/profile');
const { buildTableModel, publicModel, hiddenTwin } = require('../services/charts/model');
const fixtures = require('./fixtures/charts/tables');

const NOW = new Date('2026-11-12T00:00:00Z');
async function modelOf(table) {
    const plan = samplePlan({ rowCount: table.rows.length, columns: table.columns });
    const profile = await profileSample({ columns: table.columns, rows: table.rows, plan });
    return buildTableModel(profile, { rowCount: table.rows.length, now: NOW });
}
const column = (model, id) => model.columns.find(c => c.id === id);
const roles = model => Object.fromEntries(model.columns.map(c => [c.id, c.role]));

describe('table model', () => {
    test('a measure stored as text behind "--" is a measure, with its cleaning rule', async () => {
        const model = await modelOf(fixtures.suppressedCounts());
        const total = column(model, 'TOTAL');
        expect(total.role).toBe('measure');
        expect(total.measure).toMatchObject({ additive: 'yes', reason: 'name', text: true, integer: true,
            clean: { core: 'plain', symbols: '', codes: [], paren: false, missing: ['--'] } });
        expect(total.measure.missing_share).toBeGreaterThan(0.7);
        expect(total.reasons.map(r => r.code)).toEqual(expect.arrayContaining(['numeric_text', 'numbers_in_text', 'missing_tokens']));
        // Figures the publisher added up: rows are not counted.
        expect(model.shape).toBe('statistics');
        expect(model.records).toBe(false);
    });

    test('language twins are recorded on both sides and hidden by the reader\'s language', async () => {
        const model = await modelOf(fixtures.suppressedCounts());
        const en = column(model, 'EN_PROVINCE/TERRITORY');
        const fr = column(model, 'FR_PROVINCE/TERRITOIRE');
        expect(en.twin).toMatchObject({ of: 'FR_PROVINCE/TERRITOIRE', lang: 'en' });
        expect(fr.twin).toMatchObject({ of: 'EN_PROVINCE/TERRITORY', lang: 'fr' });
        expect(hiddenTwin(en, 'en')).toBe(false);
        expect(hiddenTwin(fr, 'en')).toBe(true);
        expect(hiddenTwin(en, 'fr')).toBe(true);
        expect(hiddenTwin(column(model, 'TOTAL'), 'en')).toBe(false);
    });

    test('a year column and its month names form a monthly axis', async () => {
        const model = await modelOf(fixtures.suppressedCounts());
        expect(roles(model)).toMatchObject({ EN_YEAR: 'time', EN_MONTH: 'time_part', FR_ANNEE: 'time', FR_MOIS: 'time_part' });
        expect(model.time_axes).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 't:EN_YEAR', grain: 'year', composite: false }),
            expect.objectContaining({ id: 't:EN_YEAR+EN_MONTH', columns: ['EN_YEAR', 'EN_MONTH'], grain: 'month', composite: true })
        ]));
        const parts = await modelOf(fixtures.yearAndParts());
        expect(parts.time_axes.map(axis => axis.id)).toEqual(['t:Year', 't:Year+Month', 't:Year+Quarter']);
    });

    test('every way a number is written becomes a measure with the right additivity', async () => {
        const model = await modelOf(fixtures.numberFormats());
        expect(roles(model)).toEqual({ Unit: 'category', Visits: 'measure', Cost: 'measure', Share: 'measure', Taux: 'measure', Balance: 'measure',
            Montant: 'measure', Guess: 'measure' });
        expect(column(model, 'Visits').measure).toMatchObject({ additive: 'yes', clean: { core: 'thousands_comma' } });
        expect(column(model, 'Cost').measure).toMatchObject({ additive: 'yes', reason: 'currency', currency: true });
        expect(column(model, 'Share').measure).toMatchObject({ additive: 'no', reason: 'percent', percent: true });
        expect(column(model, 'Taux').measure).toMatchObject({ additive: 'no', clean: { core: 'decimal_comma' } });
        expect(column(model, 'Balance').measure).toMatchObject({ additive: 'unknown', clean: { paren: true } });
        expect(column(model, 'Montant').measure).toMatchObject({ additive: 'yes', clean: { core: 'thousands_space' } });
        // "1,234" beside plain numbers is read as thousands, but only as a guess.
        expect(column(model, 'Guess')).toMatchObject({ confidence: 'low', measure: { ambiguous: true } });
        expect(column(model, 'Guess').reasons.map(r => r.code)).toContain('number_format_assumed');
    });

    test('codes are something to group by, never a quantity', async () => {
        const model = await modelOf(fixtures.codes());
        expect(roles(model)).toEqual({ C_MNTH: 'code', WMU: 'code', Occupation: 'category', Positions: 'measure' });
        expect(column(model, 'C_MNTH').reasons[0].code).toBe('leading_zeros');
        expect(column(model, 'WMU').reasons[0].code).toBe('same_length_numbers');
        expect(column(model, 'Occupation').category.strip_code_prefix).toBe(true);
    });

    test('row numbers, keys, constants, empty columns and names are told apart', async () => {
        const model = await modelOf(fixtures.identifiers());
        expect(roles(model)).toEqual({ '#': 'row_number', 'Corporation number': 'identifier', BN: 'identifier', 'Form ID': 'constant',
            Notes: 'empty', column_9: 'empty', 'Legal name': 'label', Status: 'category', 'Total Gifts': 'measure' });
        expect(model.shape).toBe('records');
        expect(model.records).toBe(true);
    });

    test('a measure that happens to be sorted and unique is still a measure', async () => {
        const model = await modelOf(fixtures.risingSeries());
        expect(roles(model)).toEqual({ Year: 'time', Population: 'measure', Rank: 'measure', 'Urban share': 'measure' });
        expect(column(model, 'Population').measure.additive).toBe('yes');
        expect(column(model, 'Rank').measure.additive).toBe('no');
        expect(column(model, 'Urban share').measure).toMatchObject({ additive: 'no', percent: true });
    });

    test('periods written as text are time axes with their grain', async () => {
        const model = await modelOf(fixtures.textPeriods());
        expect(column(model, 'Fiscal Quarter').time).toMatchObject({ kind: 'text_period', format: 'quarter_year', grain: 'quarter' });
        expect(column(model, 'Fiscal Year').time).toMatchObject({ kind: 'text_period', format: 'fiscal_year', grain: 'fiscal_year' });
        expect(column(model, 'Month').time).toMatchObject({ kind: 'text_period', format: 'month_year', grain: 'month' });
        expect(column(model, 'Year').time).toMatchObject({ kind: 'year_number', grain: 'year', text: true });
        expect(column(model, 'Cases').role).toBe('measure');
    });

    test('a wide table: period columns, a verified total, row labels', async () => {
        const model = await modelOf(fixtures.widePeriods());
        expect(model.shape).toBe('wide');
        expect(column(model, 'Country of Birth').role).toBe('label');
        expect(model.wide_groups).toEqual([expect.objectContaining({ id: 'w0', grain: 'month', additive: 'yes',
            total: { id: '2023 Total', verified: true } })]);
        expect(model.wide_groups[0].columns).toHaveLength(12);
        expect(column(model, '2023 / 07')).toMatchObject({ role: 'measure', wide: 'w0' });
        expect(column(model, '2023 Total')).toMatchObject({ role: 'measure', wide_total: 'w0', measure: { additive: 'yes', reason: 'verified_total' } });
    });

    test('a code is charted through its wording, and wordings pair by language', async () => {
        const model = await modelOf(fixtures.twins());
        expect(column(model, 'ER_Code')).toMatchObject({ role: 'code', label_columns: expect.arrayContaining(['ER_Name']) });
        expect(column(model, 'ER_Name').twin).toMatchObject({ of: 'Nom_RE', lang: 'en' });
        expect(column(model, 'Nom_RE').twin).toMatchObject({ of: 'ER_Name', lang: 'fr' });
        expect(column(model, 'answer_f').twin).toMatchObject({ of: 'answer_e', lang: 'fr' });
        expect(column(model, 'Median_Wage').measure.additive).toBe('no');
    });

    test('a report-style table: non-data rows are excluded by _id, units and totals are kept', async () => {
        const model = await modelOf(fixtures.reportStyle());
        expect(model.excluded_rows).toEqual([1, 2, 19, 37, 38]);
        expect(model.findings).toEqual(expect.arrayContaining([{ code: 'notes_rows', count: 2 }, { code: 'header_rows', count: 2 },
            { code: 'unit_rows', count: 1 }, { code: 'total_rows', count: 1 }]));
        expect(roles(model)).toEqual({ Year: 'time', Emissions: 'measure', Concentration: 'measure', Region: 'category' });
        expect(column(model, 'Emissions').measure).toMatchObject({ unit: 'kg', additive: 'yes', text: true });
        expect(column(model, 'Concentration').measure).toMatchObject({ unit: 'mg', clean: { missing: ['n/a'] } });
        expect(column(model, 'Region').category.total_members).toEqual(['total']);
    });

    test('untidy spellings are flagged on the category', async () => {
        const model = await modelOf(fixtures.untidyCategories());
        expect(column(model, 'Stream').category).toMatchObject({ distinct: 3, variants: true, breakdown: true });
        expect(column(model, 'City').category).toMatchObject({ distinct: 2, variants: true });
    });

    test('a measure-name table blocks its value column across the names', async () => {
        const model = await modelOf(fixtures.measureNames());
        expect(model.shape).toBe('long_measures');
        expect(column(model, 'Measure Value').measure.blocked_by).toEqual([expect.objectContaining({ column: 'Data Point Label', why: 'mixed_measures' })]);
    });

    test('two currencies block the amount across the currency column', async () => {
        const model = await modelOf(fixtures.twoCurrencies());
        expect(model.shape).toBe('long_measures');
        expect(column(model, 'Max rate').measure.blocked_by).toEqual([{ column: 'Currency', why: 'units' }]);
    });

    test('rates, ratios and indexes are never additive; a count beside them is', async () => {
        const model = await modelOf(fixtures.ratesAndCounts());
        expect(column(model, 'Employees').measure.additive).toBe('yes');
        for (const id of ['Unemployment rate', 'Male ratio', 'Price index']) expect(column(model, id).measure.additive).toBe('no');
    });

    test('coordinates, contact details and geometry attributes are never measures or groups', async () => {
        const model = await modelOf(fixtures.places());
        expect(roles(model)).toEqual({ Name: 'label', Latitude: 'coordinate', Longitude: 'coordinate', 'Postal Code': 'identifier',
            Website: 'identifier', Shape__Area: 'geometry', Type: 'category' });
    });

    test('a clean typed table of events is records with a dated axis', async () => {
        const model = await modelOf(fixtures.cleanEvents());
        expect(model.shape).toBe('records');
        expect(roles(model)).toEqual({ 'Corporation number': 'identifier', 'Incorporation date': 'time', Jurisdiction: 'category', Status: 'category',
            'Share capital': 'measure' });
        expect(column(model, 'Incorporation date').time).toMatchObject({ kind: 'typed', grain: 'year', grains: ['day', 'month', 'quarter', 'year'] });
        expect(model.time_axes).toEqual([expect.objectContaining({ id: 't:Incorporation date', grain: 'year' })]);
    });

    test('a number column the loader gave up on is recovered, strays and all', async () => {
        const model = await modelOf(fixtures.castFailed());
        const volume = column(model, 'Volume');
        expect(volume.role).toBe('measure');
        expect(volume.measure.clean.missing).toEqual(['x']);
        expect(volume.measure.unreadable_share).toBeGreaterThan(0);
        expect(volume.measure.unreadable_share).toBeLessThan(0.02);
    });

    test('a panel of rates is figures, not records: every year heads the same number of rows', async () => {
        const model = await modelOf(fixtures.balancedPanel(12));
        expect(model.shape).toBe('statistics');
        expect(model.records).toBe(false);
    });

    test('years that step with the row are a time axis, not a row number', async () => {
        const rows = Array.from({ length: 12 }, (_, i) => [i + 1, String(2010 + i), String(1 + i), String(500 + ((i * 37) % 90))]);
        const columns = [{ id: 'Year', type: 'INTEGER' }, { id: 'Month', type: 'INTEGER' }, { id: 'Cases', type: 'INTEGER' }];
        const profile = await profileSample({ columns, rows, plan: samplePlan({ rowCount: 12, columns }) });
        const model = buildTableModel(profile, { rowCount: 12, now: NOW });
        expect(column(model, 'Year').role).toBe('time');
        expect(column(model, 'Month')).toMatchObject({ role: 'code', reasons: [{ code: 'period_part' }] });
        expect(column(model, 'Cases').role).toBe('measure');
    });

    test('an amount that falls between 1800 and 2100 is not a year', async () => {
        const rows = Array.from({ length: 60 }, (_, i) => [i + 1, 'Org ' + (i % 6), String(1800 + ((i * 53) % 300))]);
        const columns = [{ id: 'Org', type: 'TEXT' }, { id: 'amount', type: 'INTEGER' }];
        const profile = await profileSample({ columns, rows, plan: samplePlan({ rowCount: 60, columns }) });
        expect(column(buildTableModel(profile, { rowCount: 60, now: NOW }), 'amount').role).toBe('measure');
    });

    test('census years five apart are a time axis', async () => {
        const rows = [];
        for (const year of [1996, 2001, 2006, 2011, 2016, 2021]) for (const region of ['East', 'West', 'North']) rows.push([rows.length + 1, String(year), region, String(1000 + rows.length * 7)]);
        const columns = [{ id: 'Census', type: 'INTEGER' }, { id: 'Region', type: 'TEXT' }, { id: 'Population', type: 'INTEGER' }];
        const profile = await profileSample({ columns, rows, plan: samplePlan({ rowCount: rows.length, columns }) });
        expect(column(buildTableModel(profile, { rowCount: rows.length, now: NOW }), 'Census')).toMatchObject({ role: 'time', time: { kind: 'year_number' } });
    });

    test('the public model carries roles and reasons, not the cleaning internals', async () => {
        const model = await modelOf(fixtures.suppressedCounts());
        const open = publicModel(model, 'en');
        expect(open.columns.find(c => c.id === 'TOTAL')).toEqual({ id: 'TOTAL', label: 'TOTAL', type: 'TEXT', role: 'measure', confidence: 'medium',
            reasons: expect.any(Array), measure: { additive: 'yes', text: true, percent: false, blocked_by: [] } });
        expect(open.columns.find(c => c.id === 'FR_PROVINCE/TERRITOIRE').twin).toEqual({ of: 'EN_PROVINCE/TERRITORY', hidden: true });
        expect(publicModel(model, 'fr').columns.find(c => c.id === 'FR_PROVINCE/TERRITOIRE').twin.hidden).toBe(false);
        expect(JSON.stringify(open)).not.toContain('"clean"');
    });
});
