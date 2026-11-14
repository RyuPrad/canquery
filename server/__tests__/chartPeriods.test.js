const { readings, decidePeriodFormat, parsePeriod, parsePart, parsePeriodName, periodStart, ordinalOfStart, toGrain, sqlDateKey,
    monthCandidates } = require('../services/charts/periods');

function decide(values) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return decidePeriodFormat(counts.entries());
}
const starts = values => { const decided = decide(values); return values.map(value => { const p = parsePeriod(value, decided); return p ? periodStart(p.grain, p.ord) : null; }); };

describe('periods written as text', () => {
    test('years, also with a decimal zero', () => {
        expect(decide(['2017', '2018', '2019'])).toMatchObject({ format: 'year', grain: 'year', distinct: 3, min: 2017, max: 2019 });
        expect(decide(['2017.0', '2018.0', '2019.00'])).toMatchObject({ format: 'year', distinct: 3, min: 2017, max: 2019 });
        expect(readings('2019.5')).toEqual([]);
        expect(readings('1599')).toEqual([]);
        expect(readings('12345')).toEqual([]);
    });

    test('fiscal years in every spelling sort by their first year', () => {
        const values = ['2015-2016', '2016/2017', '2017/18', 'FY2018-19', 'AF 2019-2020', '2020–21'];
        expect(decide(values)).toMatchObject({ format: 'fiscal_year', grain: 'fiscal_year', distinct: 6 });
        expect(starts(values)).toEqual(['2015-01-01', '2016-01-01', '2017-01-01', '2018-01-01', '2019-01-01', '2020-01-01']);
        // Not consecutive: not a fiscal year.
        expect(readings('2015-2019')).toEqual([]);
    });

    test('"2009-10" is a fiscal year only when every value is one', () => {
        expect(decide(['2009-10', '2010-11', '2011-12'])).toMatchObject({ format: 'fiscal_year' });
        const months = decide(['2009-10', '2009-11', '2009-12', '2010-01']);
        expect(months).toMatchObject({ format: 'month_year', grain: 'month', distinct: 4 });
        expect(starts(['2009-10', '2010-01'])).toEqual(['2009-10-01', '2010-01-01']);
    });

    test('quarters, English and French, either order', () => {
        const values = ['Q4 - 2017', 'Q1 2018', 'T2 2018', '2018 Q3', '2018-T4', '2019Q1'];
        expect(decide(values)).toMatchObject({ format: 'quarter_year', grain: 'quarter', distinct: 6 });
        expect(starts(values)).toEqual(['2017-10-01', '2018-01-01', '2018-04-01', '2018-07-01', '2018-10-01', '2019-01-01']);
    });

    test('months as numbers and as names in both languages', () => {
        const values = ['2023 / 01', '2023-02', 'Mar 2023', 'avril 2023', 'Mai-23', 'juin 2023', 'Juil. 2023', 'août 2023', 'Sept 2023',
            'October 2023', 'nov. 2023', 'Déc 2023', '01/2024'];
        expect(decide(values)).toMatchObject({ format: 'month_year', grain: 'month', distinct: 13 });
        expect(starts(values)).toEqual(['2023-01-01', '2023-02-01', '2023-03-01', '2023-04-01', '2023-05-01', '2023-06-01', '2023-07-01',
            '2023-08-01', '2023-09-01', '2023-10-01', '2023-11-01', '2023-12-01', '2024-01-01']);
    });

    test('dates as text, with or without a time, and only real calendar days', () => {
        expect(decide(['2021-03-04', '2021-03-05T10:00:00Z', '2021/03/06', '2021-03-07 00:00:00+00'])).toMatchObject({ format: 'iso_date', grain: 'day', distinct: 4 });
        expect(readings('2021-02-30')).toEqual([]);
        expect(readings('2021-13-01')).toEqual([]);
    });

    test('day-month-year order is settled only by a component above twelve', () => {
        expect(decide(['31/01/2021', '05/02/2021'])).toMatchObject({ format: 'day_month_year', order: 'dmy', grain: 'day' });
        expect(decide(['01/31/2021', '02/05/2021 09:30'])).toMatchObject({ format: 'day_month_year', order: 'mdy' });
        expect(starts(['31/01/2021', '05/02/2021'])).toEqual(['2021-01-31', '2021-02-05']);
        // Nothing above twelve, or both orders at once: not read as dates.
        expect(decide(['01/02/2021', '03/04/2021'])).toBeNull();
        expect(decide(['31/01/2021', '01/31/2021'])).toBeNull();
    });

    test('month and quarter names alone are parts of a year', () => {
        expect(decide(['Jan', 'février', 'mars', 'Dec'])).toMatchObject({ format: 'month_name', part: 'month', distinct: 4 });
        expect(decide(['Q1', 'T2', 'Q3'])).toMatchObject({ format: 'quarter_name', part: 'quarter', distinct: 3 });
        expect(parsePart('juil.', 'month')).toBe(7);
        expect(parsePart('Sept', 'month')).toBe(9);
        expect(parsePart('08', 'month')).toBe(8);
        expect(parsePart('13', 'month')).toBeNull();
        expect(parsePart('T3', 'quarter')).toBe(3);
        expect(parsePart('4', 'quarter')).toBe(4);
        expect(parsePart('5', 'quarter')).toBeNull();
    });

    test('what is not a period is not read', () => {
        expect(decide(['abc', 'Ontario', '12'])).toBeNull();
        expect(readings('')).toEqual([]);
        expect(readings(null)).toEqual([]);
    });

    test('ordinals convert to coarser grains and back to period starts', () => {
        const day = { grain: 'day', ord: ordinalOfStart('day', '2021-08-17') };
        expect(periodStart('month', toGrain(day, 'month'))).toBe('2021-08-01');
        expect(periodStart('quarter', toGrain(day, 'quarter'))).toBe('2021-07-01');
        expect(periodStart('year', toGrain(day, 'year'))).toBe('2021-01-01');
        expect(toGrain({ grain: 'year', ord: 2021 }, 'month')).toBeNull();
        expect(toGrain({ grain: 'fiscal_year', ord: 2021 }, 'year')).toBeNull();
        for (const [grain, start] of [['day', '1999-12-31'], ['month', '2004-02-01'], ['quarter', '2010-10-01'], ['year', '1987-01-01']]) {
            expect(periodStart(grain, ordinalOfStart(grain, start))).toBe(start);
        }
    });

    describe('period columns of wide tables', () => {
        test('reads the period out of a label and keeps the rest as the stem', () => {
            expect(parsePeriodName('2023 / 01')).toMatchObject({ grain: 'month', stem: '' });
            expect(parsePeriodName('2023 Total')).toMatchObject({ grain: 'year', ord: 2023, stem: 'total' });
            expect(parsePeriodName('Population 2019')).toMatchObject({ grain: 'year', ord: 2019, stem: 'population' });
            expect(parsePeriodName('FY 2021-22 Budget')).toMatchObject({ grain: 'fiscal_year', ord: 2021, stem: 'fy budget' });
            expect(parsePeriodName('Q3 2020 Sales')).toMatchObject({ grain: 'quarter', stem: 'sales' });
            expect(parsePeriodName('2024_Q2')).toMatchObject({ grain: 'quarter', stem: '' });
            expect(parsePeriodName('March 2024')).toMatchObject({ grain: 'month', stem: '' });
            expect(parsePeriodName('2018-04-15T00:00:00.00')).toMatchObject({ grain: 'day', stem: '' });
        });

        test('reads month ranges as quarters, also with shortened French months', () => {
            const quarters = ['Jan-Mar2025', 'Avr-Jui2025', 'Jui-Sep2025', 'Oct-Déc2025'].map(label => parsePeriodName(label));
            expect(quarters.map(q => q.grain)).toEqual(['quarter', 'quarter', 'quarter', 'quarter']);
            expect(quarters.map(q => periodStart('quarter', q.ord))).toEqual(['2025-01-01', '2025-04-01', '2025-07-01', '2025-10-01']);
            expect(monthCandidates('jui')).toEqual([6, 7]);
        });

        test('a label with two years, or none, is not a period column', () => {
            expect(parsePeriodName('2019 to 2021 change')).toBeNull();
            expect(parsePeriodName('Province/Territoire')).toBeNull();
            expect(parsePeriodName('')).toBeNull();
        });
    });

    describe('SQL for date buckets', () => {
        test('typed dates are truncated to the grain, timestamps in UTC, dates out of every period left without a bucket', () => {
            expect(sqlDateKey('"d"', 'DATE', 'month')).toBe('(CASE WHEN "d" BETWEEN \'1600-01-01\'::date AND \'9999-12-31\'::date THEN ' +
                'to_char(date_trunc(\'month\', "d"::timestamp), \'YYYY-MM-DD\') END)');
            expect(sqlDateKey('"t"', 'TIMESTAMPTZ', 'year')).toBe('(CASE WHEN "t" BETWEEN \'1600-01-01 00:00:00+00\'::timestamptz AND ' +
                '\'9999-12-31 00:00:00+00\'::timestamptz THEN to_char(date_trunc(\'year\', ("t" AT TIME ZONE \'UTC\')), \'YYYY-MM-DD\') END)');
        });

        test('text dates are cast only behind a shape check and a validity check', () => {
            const sql = sqlDateKey('p3', 'iso_date', 'quarter');
            expect(sql).toContain('~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\'');
            expect(sql).toContain('pg_input_is_valid(');
            expect(sql).toMatch(/^\(CASE WHEN .* THEN .* END\)$/);
        });

        test('unknown grains and types are refused', () => {
            expect(() => sqlDateKey('"d"', 'DATE', 'week')).toThrow();
            expect(() => sqlDateKey('"d"', 'TEXT', 'year')).toThrow();
        });
    });
});
