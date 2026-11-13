// Numbers that publishers wrote as text: "1,234", "1 234,5", "$5.00", "12%",
// "(300)". A column gets one format, decided from all of its values, never one
// per cell: "1,234" beside "12,5" is a decimal comma, beside "1,234,567" a
// thousands separator.
//
// Every format is one pattern used twice: by parseNumber() on sampled values
// and, as a guard around a cast, by the SQL that computes a chart. The
// patterns stay inside the syntax JavaScript and PostgreSQL read alike
// ([0-9], (?:), anchors) and, with the length bound beside them, admit only
// what fits a double: the guarded cast cannot throw. Runs of digits are left
// unbounded in the patterns on purpose; bounded repeats cost PostgreSQL twice
// the time on every row.

// Characters that are spaces or minus signs in publisher files.
const SPACE_FROM = '\u00a0\u202f\u2009\u2007\t\n\r\u2212';
const SPACE_TO = ' '.repeat(SPACE_FROM.length - 1) + '-';
const SPACE_RE = /[\u00a0\u202f\u2009\u2007\t\n\r]/g;
const SYMBOLS = '$€£%';
const CODES = ['CAD', 'USD', 'cad', 'usd'];
// Footnote marks after a number ("2,605*", "311 †", "1 234¹") and the flags
// statistical tables put there: E (use with caution), p (preliminary), r
// (revised), as in "635E" or "1,204p".
const MARKS = '*†‡§¹²³⁰⁴⁵⁶⁷⁸⁹Epr';
const MARK_END_RE = /[*†‡§¹²³⁰⁴⁵⁶⁷⁸⁹Epr]\s*$/;
const MAX_LENGTH = 64;

const FORMATS = {
    plain: {
        pattern: '^[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:[eE][+-]?[0-9]{1,2})?$',
        js: d => d,
        sql: d => d
    },
    thousands_comma: {
        pattern: '^[+-]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?$',
        js: d => d.split(',').join(''),
        sql: d => 'replace(' + d + ', \',\', \'\')'
    },
    thousands_space: {
        pattern: '^[+-]?(?:[0-9]{1,3}(?: [0-9]{3})+|[0-9]+)(?:[.,][0-9]+)?$',
        js: d => d.split(' ').join('').replace(',', '.'),
        sql: d => 'replace(replace(' + d + ', \' \', \'\'), \',\', \'.\')'
    },
    decimal_comma: {
        pattern: '^[+-]?[0-9]+(?:,[0-9]+)?$',
        js: d => d.replace(',', '.'),
        sql: d => 'replace(' + d + ', \',\', \'.\')'
    }
};
for (const format of Object.values(FORMATS)) format.re = new RegExp(format.pattern);

// The same trim PostgreSQL's btrim() does: plain spaces only.
// A loop: the equivalent regular expression takes quadratic time on long padding.
function trimSpaces(text) {
    let start = 0;
    let end = text.length;
    while (start < end && text.charCodeAt(start) === 32) start += 1;
    while (end > start && text.charCodeAt(end - 1) === 32) end -= 1;
    return start === 0 && end === text.length ? text : text.slice(start, end);
}

// A cell as both sides compare it: odd spaces and the typographic minus
// mapped, then trimmed.
function prep(value) {
    if (value === null || value === undefined) return '';
    return trimSpaces(String(value).replace(SPACE_RE, ' ').replace(/\u2212/g, '-'));
}

const removeAll = (text, piece) => text.split(piece).join('');

// The cell without footnote marks and spaces at its end: what PostgreSQL's
// rtrim(cell, marks || ' ') leaves.
function trimMarks(text) {
    let end = text.length;
    while (end > 0 && (text[end - 1] === ' ' || MARKS.includes(text[end - 1]))) end -= 1;
    return end === text.length ? text : text.slice(0, end);
}

// The digits of a prepped cell under a rule: footnote marks, currency and
// percent signs gone, accounting parentheses turned into a minus.
function strip(prepped, rule) {
    let d = prepped;
    if (rule.marks) d = trimMarks(d);
    if (rule.symbols) {
        for (const symbol of rule.symbols) d = removeAll(d, symbol);
        d = trimSpaces(d);
    }
    for (const code of rule.codes || []) d = trimSpaces(removeAll(d, code));
    if (rule.paren && d.length >= 2 && d[0] === '(' && d[d.length - 1] === ')') d = '-' + d.slice(1, -1);
    return d;
}

/**
 * The number a cell holds under a column's rule, or null.
 * @param {unknown} value
 * @param {{ core: string, symbols?: string, codes?: string[], paren?: boolean }} rule
 * @returns {number | null}
 */
function parseNumber(value, rule) {
    const format = FORMATS[rule.core];
    const d = strip(prep(value), rule);
    if (d.length < 1 || d.length > MAX_LENGTH || !format.re.test(d)) return null;
    const number = Number(format.js(d));
    return Number.isFinite(number) ? number : null;
}

const FULL_STRIP = { symbols: SYMBOLS, codes: CODES, paren: true, marks: true };
// Comma evidence, on fully stripped digits.
const TWO_GROUPS_RE = /^[+-]?[0-9]{1,3}(?:,[0-9]{3}){2,}(?:\.[0-9]+)?$/;
const GROUP_AND_DOT_RE = /^[+-]?[0-9]{1,3}(?:,[0-9]{3})+\.[0-9]+$/;
const ONE_COMMA_RE = /^[+-]?([0-9]+),([0-9]+)$/;
const SPACE_GROUPS_RE = /^[+-]?[0-9]{1,3}(?: [0-9]{3})+(?:[.,][0-9]+)?$/;
const LONG_INTEGER_RE = /^[+-]?[0-9]{4,}$/;
const SHORT_INTEGER_RE = /^[+-]?[0-9]{1,3}$/;
const LEADING_ZERO_RE = /^[+-]?0[0-9]+$/;
// This many different "1,234"-shaped values and nothing against it: a
// decimal column would not keep exactly three decimals that often.
const SETTLED_GROUPS = 5;

/**
 * Decides the one number format of a column from its distinct values.
 * @param {Iterable<[string, number]>} entries prepped value and its cell count,
 *   without blank cells and missing-value tokens
 * @returns {null | { rule: object, parsed: number, cells: number, distinct: number, ambiguous: boolean, settled: string | null, percent: boolean,
 *   currency: boolean, integerShare: number, negativeShare: number, leadingZeroShare: number, fixedWidth: number | null,
 *   min: number, max: number }}
 */
function detectNumberRule(entries) {
    const values = [];
    let cells = 0;
    let thousands = 0;       // "1,234,567" or "1,234.5": the comma groups thousands
    let decimals = 0;        // "12,5", "0,125", "1234,5": the comma is a decimal mark
    let grouped = 0;         // "1,234": either reading
    let groupedDistinct = 0;
    let spaced = 0;          // "1 234" or "1 234,5"
    let longIntegers = 0;    // "1500": someone who groups thousands would write "1,500"
    let shortDistinct = 0;   // "950": written the same either way
    let settled = null;
    for (const [value, count] of entries) {
        const d = strip(value, FULL_STRIP);
        values.push({ value, count, d });
        cells += count;
        if (TWO_GROUPS_RE.test(d) || GROUP_AND_DOT_RE.test(d)) thousands += count;
        else if (SPACE_GROUPS_RE.test(d)) spaced += count;
        else if (LONG_INTEGER_RE.test(d)) longIntegers += count;
        else if (SHORT_INTEGER_RE.test(d)) shortDistinct += 1;
        else {
            const comma = ONE_COMMA_RE.exec(d);
            if (!comma) continue;
            const whole = comma[1];
            if (comma[2].length !== 3 || whole.length > 3 || whole[0] === '0') decimals += count;
            else {
                grouped += count;
                groupedDistinct += 1;
            }
        }
    }
    if (!cells) return null;

    let core = 'plain';
    let ambiguous = false;
    if (spaced > 0 && spaced >= thousands) core = 'thousands_space';
    else if (thousands > 0 && thousands >= decimals) core = 'thousands_comma';
    else if (decimals > 0) core = 'decimal_comma';
    else if (grouped > 0) {
        // Only "1,234"-shaped commas. Long plain integers beside them say the
        // comma is not grouping thousands; otherwise it is, and a guess while
        // there are few such values.
        core = longIntegers > 0 ? 'decimal_comma' : 'thousands_comma';
        ambiguous = groupedDistinct < SETTLED_GROUPS;
        if (!ambiguous) settled = 'groups';
        // Whole numbers under a thousand beside them settle it too: a decimal
        // column would not mix exactly three decimals with none at all.
        if (ambiguous && longIntegers === 0 && shortDistinct >= 2 && groupedDistinct + shortDistinct >= SETTLED_GROUPS) {
            ambiguous = false;
            settled = 'short_integers';
        }
    }
    const format = FORMATS[core];

    const symbols = new Set();
    const codes = new Set();
    let paren = false;
    let marks = false;
    let parsed = 0;
    let distinct = 0;
    let integers = 0;
    let negatives = 0;
    let zeros = 0;
    let leadingZeros = 0;
    let withPercent = 0;
    let min = Infinity;
    let max = -Infinity;
    let width = null;
    for (const { value, count, d } of values) {
        if (d.length < 1 || d.length > MAX_LENGTH || !format.re.test(d)) continue;
        const number = Number(format.js(d));
        if (!Number.isFinite(number)) continue;
        parsed += count;
        distinct += 1;
        for (const symbol of SYMBOLS) if (value.includes(symbol)) symbols.add(symbol);
        for (const code of CODES) if (value.includes(code)) codes.add(code);
        if (value.includes('%')) withPercent += count;
        if (value.includes('(')) paren = true;
        if (MARK_END_RE.test(value)) marks = true;
        if (Number.isInteger(number)) integers += count;
        if (number < 0) negatives += count;
        if (number === 0) zeros += count;
        if (LEADING_ZERO_RE.test(d)) leadingZeros += count;
        if (number < min) min = number;
        if (number > max) max = number;
        const digits = /^[0-9]+$/.test(d) ? d.length : 0;
        if (width === null) width = digits;
        else if (width !== digits) width = 0;
    }
    if (!parsed) return null;
    return {
        rule: { core, symbols: SYMBOLS.split('').filter(symbol => symbols.has(symbol)).join(''), codes: CODES.filter(code => codes.has(code)), paren,
            ...(marks ? { marks } : {}) },
        parsed, cells, distinct,
        ambiguous, settled,
        percent: withPercent / parsed >= 0.2,
        currency: [...symbols].some(symbol => symbol !== '%') || codes.size > 0,
        integerShare: integers / parsed,
        negativeShare: negatives / parsed,
        zeroShare: zeros / parsed,
        leadingZeroShare: leadingZeros / parsed,
        fixedWidth: width || null,
        min, max
    };
}

/**
 * SQL for a prepped cell: the text column with odd spaces mapped and trimmed.
 * @param {string} column a quoted identifier or text expression
 * @param {(value: unknown) => string} param registers a query parameter and returns its placeholder
 */
function sqlPrep(column, param) {
    return 'btrim(translate(' + column + ', ' + param(SPACE_FROM) + ', ' + param(SPACE_TO) + '))';
}

/** SQL for strip(): takes the prepped cell (a column of an inner query). */
function sqlStrip(prepped, rule, param) {
    let d = prepped;
    if (rule.marks) d = 'rtrim(' + d + ', ' + param(MARKS + ' ') + ')';
    if (rule.symbols) d = 'btrim(translate(' + d + ', ' + param(rule.symbols) + ', \'\'))';
    for (const code of rule.codes || []) d = 'btrim(replace(' + d + ', ' + param(code) + ', \'\'))';
    if (rule.paren) {
        d = '(CASE WHEN length(' + d + ') >= 2 AND left(' + d + ', 1) = \'(\' AND right(' + d + ', 1) = \')\' ' +
            'THEN \'-\' || substr(' + d + ', 2, length(' + d + ') - 2) ELSE ' + d + ' END)';
    }
    return d;
}

/**
 * SQL for the number of a stripped cell (a column of an inner query), or
 * NULL. A double, as the charts' figures are in JavaScript: adding doubles up
 * is far cheaper than adding numerics, and nothing downstream is more exact.
 */
function sqlValue(stripped, rule, param) {
    const format = FORMATS[rule.core];
    return '(CASE WHEN length(' + stripped + ') BETWEEN 1 AND ' + MAX_LENGTH + ' AND ' + stripped + ' ~ ' + param(format.pattern) +
        ' THEN ' + format.sql(stripped) + '::float8 END)';
}

/**
 * SQL for the number of a typed column as a double, or NULL. A numeric too
 * large for a double is left out; one too small to tell from zero is zero
 * (PostgreSQL refuses to cast either, and one such cell would end the scan).
 */
function sqlTypedValue(column, type) {
    if (type === 'INTEGER') return column + '::float8';
    return '(CASE WHEN ' + column + ' = 0 OR abs(' + column + ') < 1e-300 THEN 0::float8 WHEN abs(' + column + ') <= 1e300 THEN ' + column + '::float8 END)';
}

module.exports = { FORMATS, SPACE_FROM, SPACE_TO, MARKS, MAX_LENGTH, prep, strip, trimSpaces, parseNumber, detectNumberRule, sqlPrep, sqlStrip, sqlValue,
    sqlTypedValue };
