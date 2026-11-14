const { samplePlan, profileSample, numericLike, categoryLike } = require('../services/charts/profile');
const fixtures = require('./fixtures/charts/tables');

async function profileOf(table) {
    const plan = samplePlan({ rowCount: table.rows.length, columns: table.columns });
    return profileSample({ columns: table.columns, rows: table.rows, plan });
}
const column = (profile, id) => profile.columns.find(stat => stat.id === id);

describe('sample plan', () => {
    const columns = Array.from({ length: 11 }, (_, i) => ({ id: 'c' + i, type: 'TEXT' }));

    test('a table that fits is read whole', () => {
        expect(samplePlan({ rowCount: 5000, columns })).toMatchObject({ complete: true, head: 0, tail: 0, threshold: null, rows: 5000 });
    });

    test('a larger table gets its first and last rows and a hashed scatter of the rest', () => {
        const plan = samplePlan({ rowCount: 646006, columns });
        expect(plan).toMatchObject({ complete: false, head: 300, tail: 300, target: 20000, rows: 646006 });
        // The scatter's share of the remaining rows fills the target.
        expect(plan.threshold / 4294967296 * (646006 - 600)).toBeCloseTo(20000 - 600, -1);
    });

    test('wide tables are sampled by cells, not rows', () => {
        const wide = Array.from({ length: 120 }, (_, i) => ({ id: 'c' + i, type: 'TEXT' }));
        expect(samplePlan({ rowCount: 1000000, columns: wide }).target).toBe(2000);
        expect(samplePlan({ rowCount: 1000000, columns: [{ id: '_id' }, { id: 'a' }] }).target).toBe(20000);
    });

    test('an unknown row count reads the head only', () => {
        expect(samplePlan({ rowCount: null, columns })).toMatchObject({ complete: false, rows: null });
    });
});

describe('profile of a sample', () => {
    test('counts blanks, missing-value tokens and what parses as a number', async () => {
        const profile = await profileOf(fixtures.suppressedCounts());
        const total = column(profile, 'TOTAL');
        expect(total.cells).toBe(288);
        expect(total.missing.tokens).toEqual({ '--': total.missing.cells });
        expect(total.missing.cells).toBeGreaterThan(200);
        expect(total.number.rule.core).toBe('plain');
        expect(total.number.parsed).toBe(total.real_cells);
        expect(total.other.cells).toBe(0);
        expect(numericLike(total)).toBe(true);
        expect(categoryLike(column(profile, 'EN_PROVINCE/TERRITORY'))).toBe(true);
    });

    test('reads each number format and flags the guess', async () => {
        const profile = await profileOf(fixtures.numberFormats());
        expect(column(profile, 'Visits').number.rule.core).toBe('thousands_comma');
        expect(column(profile, 'Cost').number).toMatchObject({ currency: true, rule: { core: 'thousands_comma', symbols: '$' } });
        expect(column(profile, 'Share').number.percent).toBe(true);
        expect(column(profile, 'Taux').number.rule.core).toBe('decimal_comma');
        expect(column(profile, 'Balance').number.rule.paren).toBe(true);
        expect(column(profile, 'Montant').number.rule.core).toBe('thousands_space');
        expect(column(profile, 'Guess').number.ambiguous).toBe(true);
    });

    test('sets note rows, repeated and second headers and unit rows aside by _id', async () => {
        const table = fixtures.reportStyle();
        const profile = await profileOf(table);
        const reasons = profile.rows.excluded.map(row => row.reason);
        expect(reasons.filter(reason => reason === 'note')).toHaveLength(2);
        expect(reasons.filter(reason => reason === 'unit')).toHaveLength(1);
        expect(reasons.filter(reason => reason === 'header' || reason === 'second_header')).toHaveLength(2);
        expect(profile.rows.excluded.map(row => row.id)).toEqual([1, 2, 19, 37, 38]);
        expect(profile.rows.units).toEqual({ Emissions: 'kg', Concentration: 'mg' });
        // With those rows aside the columns read as what they are.
        expect(column(profile, 'Year').period).toMatchObject({ format: 'year' });
        expect(column(profile, 'Emissions').other.cells).toBe(0);
        expect(profile.rows.total_labels.Region).toEqual(['total']);
        expect(profile.rows.total_rows).toBe(1);
    });

    test('a single stray note in a two-column table is still a note', async () => {
        const rows = [[1, 'A', '1'], [2, 'B', '2'], [3, 'Source: Statistics Canada, table 14-10-0287', null]];
        const profile = await profileSample({ columns: [{ id: 'k', type: 'TEXT' }, { id: 'v', type: 'TEXT' }], rows, plan: samplePlan({ rowCount: 3, columns: [{ id: 'k' }, { id: 'v' }] }) });
        expect(profile.rows.excluded).toEqual([{ id: 3, reason: 'note' }]);
    });

    test('pairs columns that say the same thing, by values and by name', async () => {
        const profile = await profileOf(fixtures.twins());
        const pair = (a, b) => profile.pairs.find(p => [p.a, p.b].sort().join() === [a, b].sort().join());
        expect(pair('EN_PROVINCE/TERRITORY', 'FR_PROVINCE/TERRITOIRE')).toMatchObject({ kind: 'language', en: 'EN_PROVINCE/TERRITORY', fr: 'FR_PROVINCE/TERRITOIRE' });
        expect(pair('answer_e', 'answer_f')).toMatchObject({ kind: 'language', en: 'answer_e', fr: 'answer_f' });
        expect(pair('ER_Code', 'ER_Name')).toMatchObject({ kind: 'code_label', code: 'ER_Code' });
        expect(pair('ER_Name', 'Nom_RE')).toMatchObject({ kind: 'language', en: 'ER_Name', fr: 'Nom_RE' });
        // A measure never pairs with a category.
        expect(profile.pairs.some(p => p.a === 'Median_Wage' || p.b === 'Median_Wage')).toBe(false);
    });

    test('typed copies are duplicates with their languages', async () => {
        const profile = await profileOf(fixtures.suppressedCounts());
        expect(profile.pairs.find(p => p.a === 'EN_YEAR' && p.b === 'FR_ANNEE')).toMatchObject({ kind: 'duplicate', en: 'EN_YEAR', fr: 'FR_ANNEE' });
        expect(profile.pairs.find(p => p.a === 'EN_MONTH' && p.b === 'FR_MOIS')).toMatchObject({ kind: 'language', en: 'EN_MONTH', fr: 'FR_MOIS' });
    });

    test('flag columns that are nearly always the same value do not pair', async () => {
        const rows = [];
        for (let i = 0; i < 400; i += 1) rows.push([i + 1, i % 97 === 0 ? 'Yes' : 'No', i % 89 === 0 ? 'Yes' : 'No', 'Group ' + (i % 5)]);
        const columns = [{ id: 'RRSP', type: 'TEXT' }, { id: 'Dental', type: 'TEXT' }, { id: 'Group', type: 'TEXT' }];
        const profile = await profileSample({ columns, rows, plan: samplePlan({ rowCount: 400, columns }) });
        expect(profile.pairs).toEqual([]);
    });

    test('number columns that line up by chance are not twins', async () => {
        const profile = await profileOf(fixtures.widePeriods());
        expect(profile.pairs.filter(p => p.kind !== 'duplicate')).toEqual([]);
    });

    test('finds the period columns of a wide table and verifies their total', async () => {
        const profile = await profileOf(fixtures.widePeriods());
        expect(profile.groups.wide).toHaveLength(1);
        const [group] = profile.groups.wide;
        expect(group).toMatchObject({ grain: 'month', stem: '' });
        expect(group.columns.map(c => c.id)).toEqual(['2023 / 01', '2023 / 02', '2023 / 03', '2023 / 04', '2023 / 05', '2023 / 06', '2023 / 07',
            '2023 / 08', '2023 / 09', '2023 / 10', '2023 / 11', '2023 / 12']);
        expect(group.total).toMatchObject({ id: '2023 Total', verified: true });
    });

    test('finds a year column with its month and quarter columns', async () => {
        const profile = await profileOf(fixtures.yearAndParts());
        expect(profile.groups.composite_time).toEqual(expect.arrayContaining([
            expect.objectContaining({ year: 'Year', part: 'Month', grain: 'month', periods: 36, years: 3 }),
            expect.objectContaining({ year: 'Year', part: 'Quarter', grain: 'quarter', periods: 12, years: 3 })
        ]));
    });

    test('finds a measure whose scale follows a column of measure names', async () => {
        const profile = await profileOf(fixtures.measureNames());
        expect(profile.groups.scale_mixed).toEqual(expect.arrayContaining([
            expect.objectContaining({ measure: 'Measure Value', by: 'Data Point Label', mixed_kinds: true })
        ]));
    });

    test('row numbers and sorted keys are told from their step with _id', async () => {
        const profile = await profileOf(fixtures.identifiers());
        expect(column(profile, '#').sequence).toMatchObject({ row_number_share: 1, offset: 0 });
        expect(column(profile, 'Corporation number').sequence.row_number_share).toBeLessThan(0.1);
        expect(column(profile, 'Corporation number').sequence.rising_share).toBe(1);
    });

    test('spellings that differ by case or padding are counted once, and reported', async () => {
        const profile = await profileOf(fixtures.untidyCategories());
        expect(column(profile, 'Stream')).toMatchObject({ distinct: 3 });
        expect(column(profile, 'Stream').spellings).toBeGreaterThan(0);
        expect(column(profile, 'Stream').padded).toBeGreaterThan(0);
        expect(column(profile, 'City').distinct).toBe(2);
    });

    test('a header cell repeated in a number column is not an unreadable number', async () => {
        const rows = [[1, 'a', '10'], [2, 'b', '20'], [3, 'c', 'Compte'], [4, 'd', '30'], [5, 'e', '40'], [6, 'f', '50']];
        const columns = [{ id: 'k', type: 'TEXT' }, { id: 'Compte', type: 'TEXT' }];
        const profile = await profileSample({ columns, rows, plan: samplePlan({ rowCount: 6, columns }) });
        expect(column(profile, 'Compte').other).toMatchObject({ cells: 0, echoes: 1 });
    });

    test('long values are reported as cut and never kept whole', async () => {
        const long = 'x'.repeat(121);
        const rows = Array.from({ length: 30 }, (_, i) => [i + 1, long + i, 'ok']);
        const columns = [{ id: 'Description', type: 'TEXT' }, { id: 'flag', type: 'TEXT' }];
        const profile = await profileSample({ columns, rows, plan: samplePlan({ rowCount: 30, columns }) });
        expect(column(profile, 'Description').patterns.cut).toBe(30);
        expect(column(profile, 'Description').top[0].v.length).toBeLessThanOrEqual(80);
    });

    test('stops when its request is aborted', async () => {
        const table = fixtures.suppressedCounts();
        const controller = new AbortController();
        controller.abort(new Error('gone'));
        // Enough rows that the profiler reaches a pause.
        const rows = Array.from({ length: 40 }, () => table.rows).flat().map((row, i) => [i + 1, ...row.slice(1)]);
        await expect(profileSample({ columns: table.columns, rows, plan: samplePlan({ rowCount: rows.length, columns: table.columns }) },
            { signal: controller.signal })).rejects.toThrow('gone');
    });
});
