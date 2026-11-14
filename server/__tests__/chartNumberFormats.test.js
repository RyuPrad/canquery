const { FORMATS, SPACE_FROM, SPACE_TO, prep, parseNumber, detectNumberRule, sqlPrep, sqlStrip, sqlValue, sqlTypedValue } = require('../services/charts/numberFormats');

// The entries a profile hands over: prepped distinct values with their counts.
function column(values) {
    const counts = new Map();
    for (const value of values) counts.set(prep(value), (counts.get(prep(value)) || 0) + 1);
    return detectNumberRule(counts.entries());
}
const read = values => { const found = column(values); return values.map(value => parseNumber(value, found.rule)); };

describe('numbers written as text', () => {
    test('the character maps of both sides have the same length', () => {
        expect(SPACE_FROM).toHaveLength(SPACE_TO.length);
    });

    test('plain numbers, signs, decimals and exponents', () => {
        const found = column(['12', '3.5', '-7', '+4', '1e3', '.5']);
        expect(found.rule).toEqual({ core: 'plain', symbols: '', codes: [], paren: false });
        expect(read(['12', '3.5', '-7', '+4', '1e3', '.5'])).toEqual([12, 3.5, -7, 4, 1000, 0.5]);
        expect(found.parsed).toBe(6);
    });

    test('long decimal fractions are numbers', () => {
        expect(read(['3.0968189475701234', '101509.35888012345678'])).toEqual([Number('3.0968189475701234'), Number('101509.35888012345678')]);
    });

    test('odd spaces and the typographic minus are read as a space and a minus', () => {
        expect(prep('\u00a01\u202f234\u2009')).toBe('1 234');
        expect(read(['\u22125', '1\u00a0234', '3'])).toEqual([-5, 1234, 3]);
    });

    test('commas that group thousands', () => {
        const values = ['1,234', '12,345', '987', '123,456', '8,901', '2,345', '1,234,567.5'];
        const found = column(values);
        expect(found.rule.core).toBe('thousands_comma');
        expect(found.ambiguous).toBe(false);
        expect(read(values)).toEqual([1234, 12345, 987, 123456, 8901, 2345, 1234567.5]);
    });

    test('five different "1,234"-shaped values settle on thousands; fewer are a guess', () => {
        expect(column(['1,234', '2,345', '3,456', '4,567', '5,678', '90']).ambiguous).toBe(false);
        const guess = column(['1,234', '950']);
        expect(guess.rule.core).toBe('thousands_comma');
        expect(guess.ambiguous).toBe(true);
    });

    test('a comma is a decimal mark beside "12,5", "0,125" or "1234,5"', () => {
        expect(column(['12,5', '3', '1,234']).rule.core).toBe('decimal_comma');
        expect(column(['0,125', '1,250']).rule.core).toBe('decimal_comma');
        expect(read(['12,5', '0,75', '3', '1234,56'])).toEqual([12.5, 0.75, 3, 1234.56]);
    });

    test('long plain integers beside "1,234" say the comma does not group thousands', () => {
        const found = column(['1,234', '1500', '2,345']);
        expect(found.rule.core).toBe('decimal_comma');
        expect(found.ambiguous).toBe(true);
    });

    test('spaces that group thousands, with either decimal mark', () => {
        expect(read(['1 234', '12 345,5', '3', '1\u00a0000', '2 000.25'])).toEqual([1234, 12345.5, 3, 1000, 2000.25]);
        expect(column(['1 103 931 000', '15 423 455 000']).rule.core).toBe('thousands_space');
    });

    test('currency signs and accounting parentheses', () => {
        const values = ['$1,234.50', '$12.00', '($300.00)', '$1,000,000', '1 234,50 $'];
        const dollars = column(values.slice(0, 4));
        expect(dollars.rule).toEqual({ core: 'thousands_comma', symbols: '$', codes: [], paren: true });
        expect(dollars.currency).toBe(true);
        expect(values.slice(0, 4).map(value => parseNumber(value, dollars.rule))).toEqual([1234.5, 12, -300, 1000000]);
        expect(read(['1 234,50 $', '12,00 $'])).toEqual([1234.5, 12]);
        expect(read(['CAD 1,250.00', 'CAD 90.00'])).toEqual([1250, 90]);
    });

    test('percent signs mark the column and keep the figure', () => {
        const found = column(['12%', '3.5 %', '100%']);
        expect(found.percent).toBe(true);
        expect(found.rule.symbols).toBe('%');
        expect(read(['12%', '3.5 %', '100%'])).toEqual([12, 3.5, 100]);
    });

    test('what is not a number stays unread and is counted', () => {
        const found = column(['12', 'abc', '15', 'Total', '12']);
        expect(found.parsed).toBe(3);
        expect(found.cells).toBe(5);
        expect(parseNumber('abc', found.rule)).toBeNull();
        expect(parseNumber('', found.rule)).toBeNull();
        expect(parseNumber(null, found.rule)).toBeNull();
        expect(parseNumber('1'.repeat(70), found.rule)).toBeNull();
        expect(column(['abc', 'Ontario'])).toBeNull();
    });

    test('codes are reported: leading zeros and a fixed number of digits', () => {
        const codes = column(['007', '012', '345']);
        expect(codes.leadingZeroShare).toBeCloseTo(2 / 3);
        expect(codes.fixedWidth).toBe(3);
        expect(column(['12', '345']).fixedWidth).toBeNull();
        expect(column(['2019', '2020', '2021']).fixedWidth).toBe(4);
    });

    test('integers, negatives and the range are reported', () => {
        const found = column(['1', '2', '2', '-3.5']);
        expect(found.integerShare).toBeCloseTo(0.75);
        expect(found.negativeShare).toBeCloseTo(0.25);
        expect(found.min).toBe(-3.5);
        expect(found.max).toBe(2);
        expect(found.distinct).toBe(3);
    });

    describe('SQL', () => {
        const params = [];
        const param = value => { params.push(value); return '$' + params.length; };
        beforeEach(() => { params.length = 0; });

        test('the prepped cell maps the same characters and trims', () => {
            expect(sqlPrep('"Total"', param)).toBe('btrim(translate("Total", $1, $2))');
            expect(params).toEqual([SPACE_FROM, SPACE_TO]);
        });

        test('modifiers are removed as parameters, parentheses become a minus', () => {
            const sql = sqlStrip('p0', { core: 'thousands_comma', symbols: '$%', codes: ['CAD'], paren: true }, param);
            expect(params).toEqual(['$%', 'CAD']);
            expect(sql).toContain('translate(p0, $1, \'\')');
            expect(sql).toContain('replace(');
            expect(sql).toContain('THEN \'-\' || substr(');
            expect(sqlStrip('p0', { core: 'plain', symbols: '', codes: [], paren: false }, param)).toBe('p0');
        });

        test('the cast is guarded by the format and a length bound, with the pattern as a parameter', () => {
            expect(sqlValue('d0', { core: 'thousands_comma' }, param))
                .toBe('(CASE WHEN length(d0) BETWEEN 1 AND 64 AND d0 ~ $1 THEN replace(d0, \',\', \'\')::float8 END)');
            expect(params).toEqual([FORMATS.thousands_comma.pattern]);
            expect(sqlValue('d0', { core: 'thousands_space' }, param)).toContain('replace(replace(d0, \' \', \'\'), \',\', \'.\')::float8');
            expect(sqlTypedValue('c0', 'INTEGER')).toBe('c0::float8');
            expect(sqlTypedValue('c0', 'NUMERIC')).toBe('(CASE WHEN c0 = 0 OR abs(c0) < 1e-300 THEN 0::float8 WHEN abs(c0) <= 1e300 THEN c0::float8 END)');
        });

        test('patterns stay inside the syntax both engines share', () => {
            for (const format of Object.values(FORMATS)) {
                expect(format.pattern).not.toMatch(/\\[dswb]|\(\?[=!<]/);
                expect(format.pattern.startsWith('^')).toBe(true);
                expect(format.pattern.endsWith('$')).toBe(true);
            }
        });
    });
});
