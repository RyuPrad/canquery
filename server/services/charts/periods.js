// Periods that publishers wrote as text: "2017", "2015-2016", "Q4 - 2017",
// "T3 2019", "2023 / 01", "Jan 2023", "janv. 2023", and the labels of period
// columns in wide tables ("2023 / 01", "Jan-Mar2025"). One parser serves the
// profile (what is this column?) and the execution (which period is this
// group?): SQL groups by the spelling, JavaScript reads the spellings.
//
// A period is a grain and an ordinal, so periods of one grain sort and compare
// as integers: year y; fiscal year, its first year; quarter 4y + q - 1; month
// 12y + m - 1; day, days since 1970-01-01 (UTC).

const MONTH_NAMES = {
    jan: 1, january: 1, janv: 1, janvier: 1,
    feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2,
    mar: 3, march: 3, mars: 3,
    apr: 4, april: 4, avr: 4, avril: 4,
    may: 5, mai: 5,
    jun: 6, june: 6, juin: 6,
    jul: 7, july: 7, juil: 7, juillet: 7,
    aug: 8, august: 8, aout: 8,
    sep: 9, sept: 9, september: 9, septembre: 9,
    oct: 10, october: 10, octobre: 10,
    nov: 11, november: 11, novembre: 11,
    dec: 12, december: 12, decembre: 12
};
const FULL_MONTHS = ['january', 'janvier', 'february', 'fevrier', 'march', 'mars', 'april', 'avril', 'may', 'mai', 'june', 'juin',
    'july', 'juillet', 'august', 'aout', 'september', 'septembre', 'october', 'octobre', 'november', 'novembre', 'december', 'decembre'];

const YEAR = '(?:19|20)[0-9]{2}';
const DAY_MS = 86400000;

// Lower case, accents dropped, odd spaces as spaces: "Févr. 2023" reads "fevr. 2023".
function fold(text) {
    return String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u00a0\u202f\u2009\u2007\t\n\r]/g, ' ').replace(/[\u2012-\u2015\u2212]/g, '-')
        .replace(/\s+/g, ' ').trim().toLowerCase();
}

const monthOf = token => MONTH_NAMES[String(token).replace(/\.$/, '')] || null;

// Months a shortened token can stand for: "jui" is juin or juillet.
function monthCandidates(token) {
    const word = String(token).replace(/\.$/, '');
    if (MONTH_NAMES[word]) return [MONTH_NAMES[word]];
    if (word.length < 3) return [];
    return [...new Set(FULL_MONTHS.filter(name => name.startsWith(word)).map(name => MONTH_NAMES[name]))];
}

const fullYear = two => {
    const year = Number(two);
    if (year >= 100) return year;
    // A two-digit year is this century unless that would be well in the future.
    return year <= (new Date().getUTCFullYear() % 100) + 10 ? 2000 + year : 1900 + year;
};

function dayOrdinal(year, month, day) {
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return Math.round(time / DAY_MS);
}

const year = y => ({ format: 'year', grain: 'year', ord: y });
const fiscal = y => ({ format: 'fiscal_year', grain: 'fiscal_year', ord: y });
const quarter = (y, q) => ({ format: 'quarter_year', grain: 'quarter', ord: 4 * y + q - 1 });
const month = (y, m) => ({ format: 'month_year', grain: 'month', ord: 12 * y + m - 1 });

const RE = {
    // "2019.0": a year column written by a program that keeps a decimal.
    year: new RegExp('^(1[6-9][0-9]{2}|' + YEAR + '|21[0-9]{2})(?:\\.0+)?$'),
    span: new RegExp('^(?:fy|af|ef|exercice)? ?(' + YEAR + ') ?[-/] ?(' + YEAR + '|[0-9]{2})$'),
    quarterFirst: new RegExp('^[qt]([1-4])[ ,/-]{0,3}(' + YEAR + ')$'),
    quarterLast: new RegExp('^(' + YEAR + ')[ ,/-]{0,3}[qt]([1-4])$'),
    yearMonth: new RegExp('^(' + YEAR + ') ?[-/ ] ?(0?[1-9]|1[0-2])$'),
    monthYear: new RegExp('^(0?[1-9]|1[0-2])[-/](' + YEAR + ')$'),
    nameYear: new RegExp('^([a-z]{3,9})\\.?[ ,-]{0,2}(' + YEAR + '|[0-9]{2})$'),
    yearName: new RegExp('^(' + YEAR + ')[ ,-]{0,2}([a-z]{3,9})\\.?$'),
    isoDate: /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[t ][0-9:.+z-]*)?$/,
    slashDate: /^([0-9]{4})\/([0-9]{2})\/([0-9]{2})$/,
    dayMonthYear: new RegExp('^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-](' + YEAR + ')(?:[ t][0-9:.apm ]{0,14})?$'),
    quarterOnly: /^[qt]([1-4])$/,
    monthName: /^([a-z]{3,9})\.?$/
};

/**
 * Every reading a cell allows. Most cells have one; "2009-10" is a fiscal year
 * and a month, "03/04/2021" a day in either order, and the column decides.
 * @param {unknown} value
 * @returns {Array<{ format: string, grain?: string, ord?: number, part?: string, value?: number, a?: number, b?: number, year?: number }>}
 */
function readings(value) {
    const text = fold(value);
    if (!text || text.length > 40) return [];
    let m;
    if ((m = RE.year.exec(text))) return [year(Number(m[1]))];
    if ((m = RE.isoDate.exec(text)) || (m = RE.slashDate.exec(text))) {
        const ord = dayOrdinal(Number(m[1]), Number(m[2]), Number(m[3]));
        return ord === null || Number(m[1]) < 1600 ? [] : [{ format: 'iso_date', grain: 'day', ord }];
    }
    const out = [];
    if ((m = RE.span.exec(text))) {
        const first = Number(m[1]);
        const second = Number(m[2]);
        const consecutive = m[2].length === 2 ? second === (first + 1) % 100 : second === first + 1;
        if (consecutive) out.push(fiscal(first));
    }
    if ((m = RE.yearMonth.exec(text))) out.push(month(Number(m[1]), Number(m[2])));
    if (out.length) return out;
    if ((m = RE.quarterFirst.exec(text))) return [quarter(Number(m[2]), Number(m[1]))];
    if ((m = RE.quarterLast.exec(text))) return [quarter(Number(m[1]), Number(m[2]))];
    if ((m = RE.monthYear.exec(text))) return [month(Number(m[2]), Number(m[1]))];
    if ((m = RE.nameYear.exec(text)) && monthOf(m[1])) return [month(fullYear(m[2]), monthOf(m[1]))];
    if ((m = RE.yearName.exec(text)) && monthOf(m[2])) return [month(Number(m[1]), monthOf(m[2]))];
    if ((m = RE.dayMonthYear.exec(text))) return [{ format: 'day_month_year', a: Number(m[1]), b: Number(m[2]), year: Number(m[3]) }];
    if ((m = RE.quarterOnly.exec(text))) return [{ format: 'quarter_name', part: 'quarter', value: Number(m[1]) }];
    if ((m = RE.monthName.exec(text)) && monthOf(m[1])) return [{ format: 'month_name', part: 'month', value: monthOf(m[1]) }];
    return [];
}

/**
 * Decides how a column writes its periods, from its distinct values.
 * @param {Iterable<[string, number]>} entries value and its cell count, without blank cells
 * @returns {null | { format: string, grain?: string, part?: string, order?: 'dmy' | 'mdy', parsed: number, cells: number,
 *   distinct: number, min?: number, max?: number }}
 */
function decidePeriodFormat(entries) {
    const tally = new Map();
    let cells = 0;
    let dayFirst = 0;
    let monthFirst = 0;
    const parsedValues = [];
    for (const [value, count] of entries) {
        cells += count;
        const list = readings(value);
        if (!list.length) continue;
        parsedValues.push({ list, count });
        for (const reading of list) {
            tally.set(reading.format, (tally.get(reading.format) || 0) + count);
            if (reading.format === 'day_month_year') {
                if (reading.a > 12) dayFirst += count;
                if (reading.b > 12) monthFirst += count;
            }
        }
    }
    if (!cells || !tally.size) return null;
    // A span such as "2009-10" is a fiscal year only when every value is one;
    // otherwise the column is months and the fiscal reading was a coincidence.
    if (tally.has('fiscal_year') && tally.has('month_year') && tally.get('fiscal_year') < tally.get('month_year')) tally.delete('fiscal_year');
    // Most cells first; on a tie, fiscal years, then by name, whatever the order of the values.
    const [format, parsed] = [...tally.entries()].sort((a, b) => b[1] - a[1] ||
        Number(b[0] === 'fiscal_year') - Number(a[0] === 'fiscal_year') || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0];
    const result = { format, parsed, cells, distinct: 0 };
    if (format === 'month_name' || format === 'quarter_name') {
        result.part = format === 'month_name' ? 'month' : 'quarter';
        result.distinct = new Set(parsedValues.flatMap(({ list }) => list.filter(r => r.format === format).map(r => r.value))).size;
        return result;
    }
    let order = null;
    if (format === 'day_month_year') {
        // Only a component above 12 settles the order; without one, or with
        // both, the column is not read as dates.
        if (dayFirst > 0 === monthFirst > 0) return null;
        order = dayFirst > 0 ? 'dmy' : 'mdy';
        result.order = order;
        result.grain = 'day';
    }
    const ords = new Set();
    for (const { list } of parsedValues) {
        const reading = list.find(r => r.format === format);
        if (!reading) continue;
        const ord = format === 'day_month_year'
            ? dayOrdinal(reading.year, order === 'dmy' ? reading.b : reading.a, order === 'dmy' ? reading.a : reading.b)
            : reading.ord;
        if (ord !== null) ords.add(ord);
    }
    if (!ords.size) return null;
    if (format !== 'day_month_year') result.grain = parsedValues.flatMap(({ list }) => list).find(r => r.format === format).grain;
    result.distinct = ords.size;
    result.min = Math.min(...ords);
    result.max = Math.max(...ords);
    return result;
}

/**
 * The period a cell names under its column's decided format, or null.
 * @param {unknown} value
 * @param {{ format: string, order?: 'dmy' | 'mdy' }} decided
 * @returns {null | { grain: string, ord: number }}
 */
function parsePeriod(value, decided) {
    const reading = readings(value).find(r => r.format === decided.format);
    if (!reading) return null;
    if (decided.format === 'day_month_year') {
        const ord = dayOrdinal(reading.year, decided.order === 'dmy' ? reading.b : reading.a, decided.order === 'dmy' ? reading.a : reading.b);
        return ord === null ? null : { grain: 'day', ord };
    }
    return reading.ord === undefined ? null : { grain: reading.grain, ord: reading.ord };
}

/** The month (1-12) or quarter (1-4) a cell names, or null. */
function parsePart(value, part) {
    const text = fold(value);
    if (part === 'quarter') {
        const m = RE.quarterOnly.exec(text) || /^([1-4])$/.exec(text);
        return m ? Number(m[1]) : null;
    }
    const m = RE.monthName.exec(text);
    if (m && monthOf(m[1])) return monthOf(m[1]);
    const number = /^(0?[1-9]|1[0-2])$/.exec(text);
    return number ? Number(number[1]) : null;
}

// Coarser ordinals of a finer one.
const GRAIN_RANK = { day: 0, month: 1, quarter: 2, fiscal_year: 3, year: 3 };
function toGrain(period, grain) {
    if (period.grain === grain) return period.ord;
    if (GRAIN_RANK[grain] < GRAIN_RANK[period.grain] || period.grain === 'fiscal_year' || grain === 'fiscal_year') return null;
    let y;
    let m;
    if (period.grain === 'day') {
        const date = new Date(period.ord * DAY_MS);
        y = date.getUTCFullYear();
        m = date.getUTCMonth() + 1;
    } else if (period.grain === 'month') {
        y = Math.floor(period.ord / 12);
        m = (period.ord % 12) + 1;
    } else {
        y = Math.floor(period.ord / 4);
        m = (period.ord % 4) * 3 + 1;
    }
    if (grain === 'year') return y;
    if (grain === 'quarter') return 4 * y + Math.floor((m - 1) / 3);
    return 12 * y + m - 1;
}

/** The first day of a period, as YYYY-MM-DD: what clients sort and label by. */
function periodStart(grain, ord) {
    const pad = n => String(n).padStart(2, '0');
    if (grain === 'day') return new Date(ord * DAY_MS).toISOString().slice(0, 10);
    if (grain === 'month') return Math.floor(ord / 12) + '-' + pad((ord % 12) + 1) + '-01';
    if (grain === 'quarter') return Math.floor(ord / 4) + '-' + pad((ord % 4) * 3 + 1) + '-01';
    return ord + '-01-01';
}

/** The ordinal of a YYYY-MM-DD period start, the inverse of periodStart(). */
function ordinalOfStart(grain, start) {
    const m = /^(-?[0-9]{1,6})-([0-9]{2})-([0-9]{2})/.exec(String(start));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (grain === 'day') return dayOrdinal(y, mo, Number(m[3]));
    if (grain === 'month') return 12 * y + mo - 1;
    if (grain === 'quarter') return 4 * y + Math.floor((mo - 1) / 3);
    return y;
}

const NAME_RE = {
    isoDate: /(?<![0-9])([0-9]{4})-([0-9]{2})-([0-9]{2})(?:t[0-9:.]*z?)?(?![0-9])/,
    monthRange: new RegExp('(?<![a-z])([a-z]{3,9})\\.? ?[-/] ?([a-z]{3,9})\\.? ?[-,]? ?(' + YEAR + ')(?![0-9])'),
    quarterFirst: new RegExp('(?<![a-z0-9])[qt]([1-4]) ?[-/,]? ?(' + YEAR + ')(?![0-9])'),
    quarterLast: new RegExp('(?<![0-9])(' + YEAR + ') ?[-/,]? ?[qt]([1-4])(?![0-9a-z])'),
    span: new RegExp('(?<![0-9])(' + YEAR + ') ?[-/] ?(' + YEAR + '|[0-9]{2})(?![0-9])'),
    yearMonth: new RegExp('(?<![0-9])(' + YEAR + ') ?[-/] ?(0[1-9]|1[0-2])(?![0-9])'),
    nameYear: new RegExp('(?<![a-z])([a-z]{3,9})\\.?[ ,-]{0,2}(' + YEAR + ')(?![0-9])'),
    yearName: new RegExp('(?<![0-9])(' + YEAR + ')[ ,-]{0,2}([a-z]{3,9})(?![a-z])'),
    year: new RegExp('(?<![0-9])(' + YEAR + ')(?![0-9])')
};

// What is left of a label once its period is taken out: "2023 Total" keeps
// "total", "Population 2019" keeps "population".
const stemOf = (text, match) => (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
    .replace(/[\s_\-/.:,()]+/g, ' ').trim();

/**
 * The period a column label names, for wide tables ("2023 / 01", "Jan-Mar2025",
 * "Population 2019", "2018-04-15T00:00:00.00").
 * @param {unknown} label
 * @returns {null | { grain: string, ord: number, stem: string }}
 */
function parsePeriodName(label) {
    const text = fold(label).replace(/_+/g, ' ');
    if (!text || text.length > 80) return null;
    let m;
    if ((m = NAME_RE.isoDate.exec(text))) {
        const ord = dayOrdinal(Number(m[1]), Number(m[2]), Number(m[3]));
        return ord === null ? null : { grain: 'day', ord, stem: stemOf(text, m) };
    }
    if ((m = NAME_RE.monthRange.exec(text))) {
        const starts = monthCandidates(m[1]);
        const ends = monthCandidates(m[2]);
        const start = starts.find(s => (s - 1) % 3 === 0 && ends.includes(s + 2));
        if (start) return { ...quarter(Number(m[3]), (start - 1) / 3 + 1), stem: stemOf(text, m) };
    }
    if ((m = NAME_RE.quarterFirst.exec(text))) return { ...quarter(Number(m[2]), Number(m[1])), stem: stemOf(text, m) };
    if ((m = NAME_RE.quarterLast.exec(text))) return { ...quarter(Number(m[1]), Number(m[2])), stem: stemOf(text, m) };
    if ((m = NAME_RE.span.exec(text))) {
        const first = Number(m[1]);
        const second = Number(m[2]);
        if (m[2].length === 2 ? second === (first + 1) % 100 : second === first + 1) return { ...fiscal(first), stem: stemOf(text, m) };
    }
    if ((m = NAME_RE.yearMonth.exec(text))) return { ...month(Number(m[1]), Number(m[2])), stem: stemOf(text, m) };
    if ((m = NAME_RE.nameYear.exec(text)) && monthOf(m[1])) return { ...month(Number(m[2]), monthOf(m[1])), stem: stemOf(text, m) };
    if ((m = NAME_RE.yearName.exec(text)) && monthOf(m[2])) return { ...month(Number(m[1]), monthOf(m[2])), stem: stemOf(text, m) };
    if ((m = NAME_RE.year.exec(text))) {
        // One year only: "2019 to 2021 change" is not a period column.
        const rest = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
        return NAME_RE.year.test(rest) ? null : { ...year(Number(m[1])), stem: stemOf(text, m) };
    }
    return null;
}

/**
 * SQL for the bucket of a typed or ISO-text date, as the YYYY-MM-DD start of
 * its period, or NULL. Text is guarded: a cell that is not a real calendar day
 * yields NULL and can never abort the statement.
 * @param {string} column a quoted identifier, or the prepped text of a text column
 * @param {'DATE' | 'TIMESTAMPTZ' | 'iso_date'} type iso_date is text written YYYY-MM-DD or YYYY/MM/DD
 * @param {'day' | 'month' | 'quarter' | 'year'} grain
 */
function sqlDateKey(column, type, grain) {
    if (!['day', 'month', 'quarter', 'year'].includes(grain)) throw new Error('invalid date grain');
    const bucket = value => 'to_char(date_trunc(\'' + grain + '\', ' + value + '), \'YYYY-MM-DD\')';
    // A typed date far outside any period a chart shows (a typo in the year)
    // has no bucket: a timestamp cannot hold every date a DATE can.
    if (type === 'DATE') {
        return '(CASE WHEN ' + column + ' BETWEEN \'1600-01-01\'::date AND \'9999-12-31\'::date THEN ' + bucket(column + '::timestamp') + ' END)';
    }
    if (type === 'TIMESTAMPTZ') {
        return '(CASE WHEN ' + column + ' BETWEEN \'1600-01-01 00:00:00+00\'::timestamptz AND \'9999-12-31 00:00:00+00\'::timestamptz THEN ' +
            bucket('(' + column + ' AT TIME ZONE \'UTC\')') + ' END)';
    }
    if (type !== 'iso_date') throw new Error('invalid date type');
    const day = 'replace(left(' + column + ', 10), \'/\', \'-\')';
    return '(CASE WHEN ' + day + ' ~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\' AND pg_input_is_valid(' + day + ', \'date\') THEN ' +
        bucket(day + '::date::timestamp') + ' END)';
}

// A cell written day/month/year or month/day/year, with an optional time after it.
const DAY_FIRST_SQL_RE = '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]((19|20)[0-9]{2})([ t][0-9:.apm ]{0,14})?$';

/**
 * SQL for the bucket of a text date written with the day or the month first,
 * in the order the column's values settled. Same result as sqlDateKey().
 * @param {string} column the prepped text of a text column
 * @param {'dmy' | 'mdy'} order
 * @param {'day' | 'month' | 'quarter' | 'year'} grain
 * @param {(value: unknown) => string} param registers a statement parameter
 */
function sqlDayFirstKey(column, order, grain, param) {
    if (!['day', 'month', 'quarter', 'year'].includes(grain)) throw new Error('invalid date grain');
    if (order !== 'dmy' && order !== 'mdy') throw new Error('invalid date order');
    const pattern = param(DAY_FIRST_SQL_RE);
    const day = 'regexp_replace(lower(' + column + '), ' + pattern + ', ' + param(order === 'dmy' ? '\\3-\\2-\\1' : '\\3-\\1-\\2') + ')';
    return '(CASE WHEN lower(' + column + ') ~ ' + pattern + ' AND pg_input_is_valid(' + day + ', \'date\') THEN ' +
        'to_char(date_trunc(\'' + grain + '\', ' + day + '::date::timestamp), \'YYYY-MM-DD\') END)';
}

module.exports = { readings, decidePeriodFormat, parsePeriod, parsePart, parsePeriodName, periodStart, ordinalOfStart, toGrain,
    sqlDateKey, sqlDayFirstKey, monthCandidates, fold };
