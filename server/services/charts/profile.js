// What a table's values look like, read from a bounded sample of its rows.
// The profile only describes; model.js decides what each column is. Nothing
// here is shown to a visitor as a number: every figure on a chart comes from
// the whole table.
const { prep, detectNumberRule, parseNumber } = require('./numberFormats');
const { decidePeriodFormat, parsePeriodName, parsePart } = require('./periods');
const { isMissingToken, isTotalLabel, isAggregateLabel, isFootnoteLabel, isMarkedNote, nameEvidence, cleanLabel, labelKind, isNationalLabel, isProvinceName,
    isRegionLabel, isMeasureLabel, isGarbled } = require('./tokens');

const MAX_ROWS = 20000;
const CELL_TARGET = 240000;
const MIN_ROWS = 200;
const EDGE_ROWS = 300;
const TEXT_CUT = 120;
const MAX_DISTINCT = 5000;
const TOP_VALUES = 30;
const SLICE_MS = 8;
const UINT32 = 4294967296;

const NUMERIC_TYPES = new Set(['INTEGER', 'NUMERIC']);
const DATE_TYPES = new Set(['DATE', 'TIMESTAMPTZ']);

/**
 * Which rows to read. A table that fits is read whole, so its profile is
 * exact; otherwise the first and last rows (notes, unit rows and totals live
 * there) and a scatter of the rest chosen by a hash of _id, which cannot fall
 * into step with sorted data the way "every k-th row" does.
 * @param {{ rowCount: number, columns: Array<{ id: string }> }} table
 */
function samplePlan({ rowCount, columns }) {
    const width = Math.max(1, (columns || []).filter(column => column && column.id !== '_id').length);
    const target = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(CELL_TARGET / width)));
    const rows = rowCount === null || rowCount === undefined || rowCount === '' ? NaN : Number(rowCount);
    if (!Number.isSafeInteger(rows) || rows < 0) return { complete: false, target, head: target, tail: 0, threshold: 0, rows: null, textCut: TEXT_CUT };
    if (rows <= target) return { complete: true, target, head: 0, tail: 0, threshold: null, rows, textCut: TEXT_CUT };
    const edge = Math.min(EDGE_ROWS, Math.floor(target / 4));
    const threshold = Math.max(1, Math.min(UINT32, Math.floor(UINT32 * (target - 2 * edge) / (rows - 2 * edge))));
    return { complete: false, target, head: edge, tail: edge, threshold, rows, textCut: TEXT_CUT };
}

function yielder(signal) {
    let last = Date.now();
    return async () => {
        if (Date.now() - last < SLICE_MS) return;
        await new Promise(resolve => setImmediate(resolve));
        signal?.throwIfAborted();
        last = Date.now();
    };
}

const CODE_LABEL_RE = /^[A-Z0-9][A-Z0-9.]{0,9} ?[-–—:] ?\p{L}{3}/u;
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const POSTAL_RE = /^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$/i;
const PHONE_RE = /^(?:\+?1[ .-]?)?(?:\([0-9]{3}\) ?|[0-9]{3}[ .-])[0-9]{3}[ .-][0-9]{4}(?: ?(?:x|ext\.?|poste) ?[0-9]{1,6})?$/i;
const LETTER_RE = /\p{L}/u;
const ACCENT_RE = /[àâäçéèêëîïôöùûüÿœæ]/i;
const FRENCH_WORDS = /(?:^|[\s'’(/-])(?:de|du|des|la|le|les|et|ou|pour|par|sur|avec|sans|aux|une|dans|année|annee|trimestre|mois|titre|nom|numéro|numero|société|societe|groupe|nombre|montant|données|donnees|autres?|aucune?|inconnue?|oui|non)(?:$|[\s'’)/,.-])/i;
const ENGLISH_WORDS = /(?:^|[\s(/-])(?:of|and|the|for|with|by|to|in|or|year|quarter|month|title|name|number|company|group|amount|data|others?|none|unknown|yes|no)(?:$|[\s)/,.-])/i;
// Values that are units of measure rather than data.
const UNIT_TOKEN_RE = /^(?:[$€£%]|cad|usd|dollars?|percent|pourcentage|number|nombre|count|ratio|rate|taux|index|indice|kg|g|mg|µg|t|tonnes?|lbs?|km|m|cm|mm|ha|hectares?|acres?|l|litres?|ml|m3|m2|km2|kwh|mwh|gwh|gj|tj|pj|kj|kcal|°c|hours?|heures?|days?|jours?|persons?|personnes?|units?|unités?|thousands?|millions?|billions?|milliers?|milliards?)$/i;
// A bound in place of a number: "<5", "> 100", "~0".
const BOUND_RE = /^[<>≤≥~]=?\s*[0-9][0-9.,]*\*?$/;
// Lower-case pieces joined by hyphens or underscores: a made-up key, not wording.
const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;
// The most rows a block of notes under a table may have.
const TAIL_ROWS = 60;

// The Chao1 estimate of how many distinct values the whole column holds, from
// how many were seen once and twice in the sample.
function estimateDistinct(distinct, once, twice, complete) {
    if (complete || once === 0) return distinct;
    return Math.round(distinct + (twice > 0 ? (once * once) / (2 * twice) : (once * (once - 1)) / 2));
}

// FNV-1a: enough to count values that are not kept.
function hash32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

// Codes for "no figure" written as figures: all nines (999, 99999.9) far above
// every real value, or a small negative (-9, -999) in a column of positives.
const SENTINEL_RE = /^(?:9{3,}(?:\.9+)?|-9{1,4}(?:\.0+)?|-9{3,}(?:\.9+)?)$/;
function sentinelValues(real) {
    const out = new Set();
    const candidates = real.filter(([value, count]) => count >= 2 && SENTINEL_RE.test(value));
    if (!candidates.length) return out;
    const others = [];
    let negative = 0;
    for (const [value] of real) {
        if (SENTINEL_RE.test(value)) continue;
        const number = Number(value.replace(/[,\s$%]/g, ''));
        if (!Number.isFinite(number)) continue;
        if (number < 0) negative += 1;
        others.push(Math.abs(number));
    }
    if (others.length < 5) return out;
    others.sort((a, b) => a - b);
    const high = others[Math.min(others.length - 1, Math.floor(others.length * 0.95))];
    for (const [value] of candidates) {
        const number = Number(value);
        if (number > 0 ? high > 0 && number >= high * 10 : negative === 0) out.add(value);
    }
    return out;
}

// Dates that stand for "no date": far from every real one ("1900-01-01" in a
// column of permits since 1990).
const PLACEHOLDER_DATES = new Set(['1900-01-01', '1899-12-30', '1899-12-31', '1901-01-01', '1970-01-01', '1800-01-01', '9999-12-31', '2999-12-31',
    '2099-12-31', '3000-01-01']);
function placeholderDates(real) {
    const out = new Set();
    const candidates = real.filter(([value, count]) => count >= 2 && PLACEHOLDER_DATES.has(value.slice(0, 10)));
    if (!candidates.length) return out;
    let low = Infinity;
    let high = -Infinity;
    let dated = 0;
    for (const [value] of real) {
        if (PLACEHOLDER_DATES.has(value.slice(0, 10)) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(value)) continue;
        const year = Number(value.slice(0, 4));
        if (year < low) low = year;
        if (year > high) high = year;
        dated += 1;
    }
    if (dated < 5) return out;
    for (const [value] of candidates) {
        const year = Number(value.slice(0, 4));
        if (year <= low - 20 || year >= high + 20) out.add(value);
    }
    return out;
}

function profileColumn(column, values, raw, { complete, skip = new Set() }) {
    const cells = values.length;
    const counts = new Map();
    // Values past the cap are not read one by one, but they are still
    // counted, by their hash: a column of keys must not look like one of
    // values that repeat.
    const beyond = new Map();
    let blank = 0;
    let padded = 0;
    let overflow = 0;
    for (let r = 0; r < cells; r += 1) {
        const value = values[r];
        if (value === '') {
            blank += 1;
            continue;
        }
        if (raw[r] !== value) padded += 1;
        const seen = counts.get(value);
        if (seen !== undefined) counts.set(value, seen + 1);
        else if (counts.size < MAX_DISTINCT) counts.set(value, 1);
        else {
            overflow += 1;
            const key = hash32(value.replace(/\s+/g, ' ').toLowerCase());
            beyond.set(key, (beyond.get(key) || 0) + 1);
        }
    }
    const filled = cells - blank;

    // Spellings that differ only by case or inner spacing are one value.
    const folded = new Map();
    for (const [value, count] of counts) {
        const key = value.replace(/\s+/g, ' ').toLowerCase();
        folded.set(key, (folded.get(key) || 0) + count);
    }
    let once = 0;
    let twice = 0;
    for (const tally of [folded, beyond]) {
        for (const count of tally.values()) {
            if (count === 1) once += 1;
            else if (count === 2) twice += 1;
        }
    }
    const distinct = folded.size + beyond.size;

    const missing = { cells: 0, tokens: {}, sentinels: [], dates: [] };
    let real = [];
    for (const [value, count] of counts) {
        if (isMissingToken(value)) {
            missing.cells += count;
            missing.tokens[value.toLowerCase()] = (missing.tokens[value.toLowerCase()] || 0) + count;
        } else real.push([value, count]);
    }
    // "99999.9" or "-999" among ordinary figures: a code for "no figure".
    const sentinels = sentinelValues(real);
    if (sentinels.size) {
        real = real.filter(([value, count]) => {
            if (!sentinels.has(value)) return true;
            missing.cells += count;
            missing.tokens[value.toLowerCase()] = (missing.tokens[value.toLowerCase()] || 0) + count;
            missing.sentinels.push(Number(value));
            return false;
        });
    }
    const placeholders = placeholderDates(real);
    if (placeholders.size) {
        real = real.filter(([value, count]) => {
            if (!placeholders.has(value)) return true;
            missing.cells += count;
            if (!missing.dates.includes(value.slice(0, 10))) missing.dates.push(value.slice(0, 10));
            return false;
        });
    }
    const realCells = filled - missing.cells - overflow;

    // A column written once per block and left blank below it ("Nova Scotia",
    // "", "New Brunswick", ""): blanks inside it mean "as above". Read in the
    // table's order, so only when the whole table was read.
    let fillDown = false;
    if (complete && filled >= 3) {
        let first = -1;
        let last = -1;
        for (let r = 0; r < cells; r += 1) {
            if (skip.has(r) || values[r] === '') continue;
            if (first < 0) first = r;
            last = r;
        }
        let span = 0;
        let interior = 0;
        for (let r = first; r >= 0 && r <= last; r += 1) {
            if (skip.has(r)) continue;
            span += 1;
            if (values[r] === '') interior += 1;
        }
        fillDown = interior >= 1 && interior >= span * 0.05 && interior <= span * 0.6 && distinct >= filled * 0.8;
    }

    const number = detectNumberRule(real);
    const period = decidePeriodFormat(real);

    // What a number column holds besides numbers and missing-value tokens.
    const other = { cells: 0, distinct: 0, longest: 0, short: {}, recurring: {}, examples: [], echoes: 0 };
    if (number) {
        const names = [String(column.id).toLowerCase(), cleanLabel(column.original_label || column.id).toLowerCase()];
        for (const [value, count] of real) {
            if (parseNumber(value, number.rule) !== null) continue;
            // The column's own header, repeated inside the data.
            if (names.includes(value.toLowerCase())) {
                other.echoes += count;
                continue;
            }
            other.cells += count;
            other.distinct += 1;
            if (value.length > other.longest) other.longest = value.length;
            // Short recurring letters inside numbers are flags ("uu", "qq", "F").
            if (value.length <= 3 && count >= 2 && /^\p{L}{1,3}$/u.test(value)) other.short[value.toLowerCase()] = (other.short[value.toLowerCase()] || 0) + count;
            // Words that recur where numbers belong ("no production", "Confidential"), and bounds ("<5").
            if (count >= 2 && value.length <= 40 && (!/[0-9]/.test(value) || BOUND_RE.test(value))) {
                other.recurring[value.toLowerCase()] = (other.recurring[value.toLowerCase()] || 0) + count;
            }
            if (other.examples.length < 5) other.examples.push(value.slice(0, 40));
        }
    }

    const patterns = { code_label: 0, url: 0, email: 0, postal: 0, phone: 0, letters: 0, digits: 0, spaces: 0, upper: 0, french: 0,
        english: 0, accents: 0, unit: 0, cut: 0, footnote: 0, slug: 0 };
    let lengthSum = 0;
    const lengths = [];
    for (const [value, count] of counts) {
        lengthSum += value.length * count;
        lengths.push([value.length, count]);
        if (value.length >= TEXT_CUT) patterns.cut += count;
        if (SLUG_RE.test(value)) patterns.slug += count;
        if (LETTER_RE.test(value)) {
            patterns.letters += count;
            if (value === value.toUpperCase()) patterns.upper += count;
        }
        if (/[0-9]/.test(value)) patterns.digits += count;
        if (value.includes(' ')) patterns.spaces += count;
        if (CODE_LABEL_RE.test(value)) patterns.code_label += count;
        if (URL_RE.test(value)) patterns.url += count;
        else if (EMAIL_RE.test(value)) patterns.email += count;
        else if (POSTAL_RE.test(value)) patterns.postal += count;
        else if (PHONE_RE.test(value)) patterns.phone += count;
        if (ACCENT_RE.test(value)) patterns.accents += count;
        if (FRENCH_WORDS.test(value)) patterns.french += count;
        if (ENGLISH_WORDS.test(value)) patterns.english += count;
        if (UNIT_TOKEN_RE.test(value)) patterns.unit += count;
        if (isFootnoteLabel(value)) patterns.footnote += count;
    }
    // Patterns are counted over the values kept (at most MAX_DISTINCT of them);
    // past that, they stand for the rest in proportion.
    if (overflow > 0 && filled > overflow) {
        const scale = filled / (filled - overflow);
        for (const key of Object.keys(patterns)) patterns[key] = Math.round(patterns[key] * scale);
    }
    lengths.sort((a, b) => a[0] - b[0]);
    let p90 = 0;
    let passed = 0;
    const counted = filled - overflow;
    for (const [length, count] of lengths) {
        passed += count;
        p90 = length;
        if (passed >= counted * 0.9) break;
    }

    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_VALUES)
        .map(([value, count]) => ({ v: value.slice(0, 80), n: count }));
    const labels = labelReading(counts);

    return {
        id: column.id,
        label: cleanLabel(column.original_label || column.id),
        type: column.type,
        cast_failed: column.cast_failed === true,
        cells, blank, filled, padded,
        distinct, exact_distinct: overflow === 0,
        est_distinct: estimateDistinct(distinct, once, twice, complete),
        spellings: counts.size - folded.size,
        top,
        length: { avg: counted ? lengthSum / counted : 0, p90 },
        missing,
        real_cells: realCells,
        number: number && {
            rule: number.rule, parsed: number.parsed, distinct: number.distinct, ambiguous: number.ambiguous, settled: number.settled, percent: number.percent,
            currency: number.currency, integer_share: number.integerShare, negative_share: number.negativeShare, zero_share: number.zeroShare,
            leading_zero_share: number.leadingZeroShare, fixed_width: number.fixedWidth, min: number.min, max: number.max
        },
        other,
        period: period && { ...period },
        patterns,
        labels,
        fill_down: fillDown,
        sequence: null
    };
}

// What a column's values say as labels, read over every distinct value (up
// to a few hundred): a column that lists "0 à 14 ans" and "Femmes" lists two
// kinds of breakdown however far down the second one sorts.
const LABEL_READ_MAX = 2000;
const DATED_RE = /(?:^|[^0-9])(?:1[89]|20)[0-9]{2}(?:[^0-9]|$)/;
function labelReading(counts) {
    if (counts.size === 0 || counts.size > LABEL_READ_MAX) return null;
    const out = { distinct: 0, place: 0, sex: 0, age: 0, national: 0, province: 0, region: 0, others: 0, measure: 0, dated: 0, dated_cells: 0,
        cells: 0, garbled: 0, total_cells: 0, totals: [], lists: 0 };
    for (const [value, count] of counts) {
        if (isMissingToken(value)) continue;
        out.distinct += 1;
        out.cells += count;
        const kind = labelKind(value);
        if (kind) out[kind] += 1;
        if (isNationalLabel(value)) out.national += 1;
        else if (isProvinceName(value)) out.province += 1;
        else if (isRegionLabel(value)) out.region += 1;
        else if (!kind && !isTotalLabel(value)) out.others += 1;
        if (isMeasureLabel(value)) out.measure += 1;
        if (DATED_RE.test(value)) {
            out.dated += 1;
            out.dated_cells += count;
        }
        if (isGarbled(value)) out.garbled += 1;
        // Members that add the others up, under any name a table of figures gives them.
        if (isTotalLabel(value) || isAggregateLabel(value)) {
            out.total_cells += count;
            if (out.totals.length < 20) out.totals.push(value.toLowerCase());
        }
        // "English ; French": a list, not one group.
        if (/;\s*\S/.test(value)) out.lists += 1;
    }
    return out;
}

// A measure-like column: typed as a number, or text that is nearly all numbers.
const numericLike = stat => Boolean(stat.number) && (NUMERIC_TYPES.has(stat.type) ||
    (stat.number.parsed >= 5 && stat.real_cells > 0 && stat.number.parsed / stat.real_cells >= 0.9));
// A column whose values repeat enough to group by.
const categoryLike = stat => !numericLike(stat) && !DATE_TYPES.has(stat.type) && stat.distinct >= 2 && stat.distinct <= 200 &&
    stat.filled > 0 && stat.distinct / stat.filled <= 0.5;

// Row numbers and sorted keys: does the column step with _id?
function sequenceOf(ids, numbers, stat) {
    if (!stat.number || stat.number.integer_share < 0.99) return null;
    let offset = null;
    let matches = 0;
    let read = 0;
    let rising = 0;
    let pairs = 0;
    let previous = null;
    for (let r = 0; r < numbers.length; r += 1) {
        const number = numbers[r];
        if (Number.isNaN(number)) continue;
        read += 1;
        if (offset === null) offset = number - ids[r];
        if (number - ids[r] === offset) matches += 1;
        if (previous !== null) {
            pairs += 1;
            if (number > previous) rising += 1;
        }
        previous = number;
    }
    return read ? { row_number_share: matches / read, rising_share: pairs ? rising / pairs : 0, offset } : null;
}

// Rows that are not data. Notes and sources under a table sit alone in their
// row: found first, from the cells alone, so they do not count against the
// column they happen to sit in.
function noteRows(matrix, count) {
    const width = matrix.length;
    const notes = [];
    for (let r = 0; r < count; r += 1) {
        let filled = 0;
        let first = null;
        for (let c = 0; c < width && filled <= width; c += 1) {
            if (matrix[c][r] === '') continue;
            filled += 1;
            if (first === null) first = matrix[c][r];
        }
        if (filled === 0) continue;
        const lonely = filled === 1 || (width >= 5 && filled <= Math.floor(width * 0.2));
        if (!lonely) continue;
        if (isFootnoteLabel(first) || (width >= 3 && filled === 1 && (first.length >= 40 || isMarkedNote(first)))) notes.push(r);
    }
    return notes;
}

// A number column for the purpose of spotting words where numbers belong:
// looser than numericLike(), because the words being looked for are what
// keeps the column from passing it.
const mostlyNumbers = stat => Boolean(stat.number) && stat.number.parsed >= 3 && stat.real_cells > 0 &&
    stat.number.parsed / stat.real_cells >= 0.6;

// A header repeated inside the data, a second header at the top (often the
// French one), a row of units, and rows that add the others up.
function rowFindings(stats, matrix, ids) {
    const width = stats.length;
    const rows = ids.length;
    const numeric = stats.map(mostlyNumbers);
    const numericCount = numeric.filter(Boolean).length;
    const labels = stats.map(stat => [stat.id.toLowerCase(), stat.label.toLowerCase()]);
    const found = { header: [], second_header: [], unit: [], units: {}, total_rows: 0, total_labels: {}, aggregate_labels: {}, tail: [] };
    // Notes, legends and sources under a table: at its end, rows with words
    // where the numbers are and not one number.
    if (numericCount >= 2) {
        const tail = [];
        for (let r = rows - 1; r >= 0 && tail.length <= TAIL_ROWS; r -= 1) {
            let words = 0;
            let numbers = 0;
            let filled = 0;
            for (let c = 0; c < width; c += 1) {
                const value = matrix[c][r];
                if (value === '') continue;
                filled += 1;
                if (!numeric[c] || isMissingToken(value)) continue;
                if (parseNumber(value, stats[c].number.rule) !== null) numbers += 1;
                else words += 1;
            }
            if (filled === 0) continue;
            if (numbers > 0 || words === 0) break;
            tail.push(r);
        }
        if (tail.length > 0 && tail.length <= TAIL_ROWS && rows - tail.length >= 5) found.tail = tail;
    }
    for (let r = 0; r < rows; r += 1) {
        let filled = 0;
        let echoes = 0;
        let total = false;
        let numbers = 0;
        let words = 0;
        for (let c = 0; c < width; c += 1) {
            const value = matrix[c][r];
            if (value === '') continue;
            filled += 1;
            const lower = value.toLowerCase();
            if (lower === labels[c][0] || lower === labels[c][1]) echoes += 1;
            if (numeric[c] && !isMissingToken(value)) {
                if (parseNumber(value, stats[c].number.rule) !== null) numbers += 1;
                else words += 1;
            }
            if (!numeric[c] && isTotalLabel(value)) {
                total = true;
                const list = found.total_labels[stats[c].id] || (found.total_labels[stats[c].id] = []);
                if (list.length < 5 && !list.includes(lower)) list.push(lower);
            } else if (!numeric[c] && isAggregateLabel(value)) {
                // "Total Expenditures": a total in a table of figures, read from every row.
                const list = found.aggregate_labels[stats[c].id] || (found.aggregate_labels[stats[c].id] = []);
                if (list.length < 10 && !list.includes(lower)) list.push(lower);
            }
        }
        if (filled === 0) continue;
        if (total) found.total_rows += 1;
        // A header inside the data: most cells repeat their column's name, or
        // a good part do while words sit where every number should be (the
        // header of the next block of a file that stacks several tables).
        if (filled >= 2 && (echoes >= Math.max(2, Math.ceil(filled * 0.6)) ||
            (echoes >= Math.max(2, Math.ceil(filled * 0.3)) && numbers === 0 && words >= 1))) {
            found.header.push(r);
            continue;
        }
        if (ids[r] > 3 || numericCount < 2) continue;
        // At the top, words under most of the number columns.
        let strays = 0;
        const units = {};
        for (let c = 0; c < width; c += 1) {
            const value = matrix[c][r];
            if (!numeric[c] || value === '' || isMissingToken(value) || parseNumber(value, stats[c].number.rule) !== null) continue;
            strays += 1;
            if (UNIT_TOKEN_RE.test(value)) units[stats[c].id] = value;
        }
        if (strays < Math.max(2, Math.ceil(numericCount * 0.5))) continue;
        if (Object.keys(units).length >= Math.ceil(strays * 0.6)) {
            found.unit.push(r);
            Object.assign(found.units, units);
        } else found.second_header.push(r);
    }
    return found;
}

// Columns that say the same thing twice: the same value in English and in
// French, a code beside its label, or a plain copy. Two columns pair when each
// value of one always sits beside the same value of the other, and the values
// repeat: columns that are unique on every row would pair with anything.
async function findPairs(stats, matrix, pause) {
    const pairs = [];
    const rows = matrix.length ? matrix[0].length : 0;
    const slack = Math.max(1, Math.floor(rows * 0.01));
    const candidates = stats.map((stat, index) => ({ stat, index }))
        .filter(({ stat }) => stat.distinct >= 2 && stat.exact_distinct && stat.filled >= rows * 0.5 && stat.distinct <= stat.filled * 0.5);
    // Paired columns have the same group sizes, so compare those first.
    const sizes = ({ stat }) => stat.top.slice(0, 8).map(entry => entry.n);
    const alike = (x, y) => x.length === y.length && x.every((n, i) => Math.abs(n - y[i]) <= slack);
    for (let a = 0; a < candidates.length; a += 1) {
        const left = candidates[a];
        const leftSizes = sizes(left);
        // Rows outside the most common value are what can show a pairing: two
        // flag columns that are nearly always "No" agree by default.
        const telling = left.stat.filled - leftSizes[0];
        if (telling < Math.max(3, left.stat.filled * 0.05)) continue;
        const allowed = Math.floor(telling * 0.02);
        for (let b = a + 1; b < candidates.length; b += 1) {
            const right = candidates[b];
            const gap = Math.max(1, Math.round(Math.max(left.stat.distinct, right.stat.distinct) * 0.02));
            if (Math.abs(left.stat.distinct - right.stat.distinct) > gap || !alike(leftSizes, sizes(right))) continue;
            const forward = new Map();
            const backward = new Map();
            let violations = 0;
            let same = 0;
            let compared = 0;
            const x = matrix[left.index];
            const y = matrix[right.index];
            for (let r = 0; r < rows && violations <= allowed; r += 1) {
                if (x[r] === '' && y[r] === '') continue;
                compared += 1;
                if (x[r] === y[r]) same += 1;
                const f = forward.get(x[r]);
                if (f === undefined) forward.set(x[r], y[r]);
                else if (f !== y[r]) violations += 1;
                const g = backward.get(y[r]);
                if (g === undefined) backward.set(y[r], x[r]);
                else if (g !== x[r]) violations += 1;
            }
            await pause();
            if (violations > allowed || compared < 3 || forward.size < 2) continue;
            const duplicate = same >= compared * 0.995;
            // Two number columns can line up by chance; only a plain copy counts.
            if (!duplicate && numericLike(left.stat) && numericLike(right.stat)) continue;
            pairs.push({ a: left.stat.id, b: right.stat.id, kind: duplicate ? 'duplicate' : null });
        }
    }
    return pairs;
}

const LANGUAGE_WORD_RE = /^(?:en|eng|english|anglais|ang|e|fr|fra|fre|french|francais|f)$/;

// Columns named alike apart from a language marker ("name_en" and "name_fr",
// "Title (English)" and "Titre (French)" do not match, their values do).
function namePairs(stats) {
    const slots = new Map();
    for (const stat of stats) {
        const name = nameEvidence(stat.label);
        if (name.english === name.french) continue;
        const key = name.normal.split(' ').filter(word => !LANGUAGE_WORD_RE.test(word)).join(' ');
        if (!key) continue;
        const slot = slots.get(key) || {};
        const side = name.english ? 'en' : 'fr';
        if (!slot[side]) slot[side] = stat.id;
        slots.set(key, slot);
    }
    return [...slots.values()].filter(slot => slot.en && slot.fr)
        .map(slot => ({ a: slot.en, b: slot.fr, kind: 'language', en: slot.en, fr: slot.fr, code: null }));
}

const frenchScore = stat => {
    const name = nameEvidence(stat.label);
    const share = stat.filled ? (stat.patterns.french + stat.patterns.accents) / stat.filled : 0;
    return (name.french ? 2 : 0) + (FRENCH_WORDS.test(' ' + name.normal + ' ') || ACCENT_RE.test(stat.label) ? 1 : 0) + Math.min(2, share * 4);
};
const englishScore = stat => {
    const name = nameEvidence(stat.label);
    const share = stat.filled ? stat.patterns.english / stat.filled : 0;
    return (name.english ? 2 : 0) + (ENGLISH_WORDS.test(' ' + name.normal + ' ') ? 1 : 0) + Math.min(2, share * 4);
};
// A code is short and looks made up: digits in it, all capitals, a few
// characters, or lower-case pieces joined by hyphens ("cihr-irsc").
const codeSide = stat => stat.patterns.spaces <= stat.filled * 0.05 &&
    ((stat.length.avg <= 10 && (stat.patterns.digits >= stat.filled * 0.5 || stat.patterns.upper >= stat.filled * 0.8 || stat.length.avg <= 3)) ||
        (stat.length.avg <= 16 && stat.patterns.slug >= stat.filled * 0.3));

function describePairs(pairs, byId, stats) {
    const described = pairs.map(pair => {
        const a = byId.get(pair.a);
        const b = byId.get(pair.b);
        const fa = frenchScore(a) - englishScore(a);
        const fb = frenchScore(b) - englishScore(b);
        let kind = pair.kind;
        let en = null;
        let fr = null;
        let code = null;
        const an = nameEvidence(a.label);
        const bn = nameEvidence(b.label);
        if (an.english !== an.french && bn.english !== bn.french && an.english !== bn.english) {
            // The names say it: one column per language.
            en = an.english ? pair.a : pair.b;
            fr = an.english ? pair.b : pair.a;
            if (!kind) kind = 'language';
        } else if (!kind && codeSide(a) !== codeSide(b)) {
            // A short code beside its wording, whatever language the wording is in.
            kind = 'code_label';
            code = codeSide(a) ? pair.a : pair.b;
        } else if (Math.abs(fa - fb) >= 1) {
            // One side reads more French than the other: a language pair.
            fr = fa > fb ? pair.a : pair.b;
            en = fa > fb ? pair.b : pair.a;
            if (!kind) kind = 'language';
        }
        return { a: pair.a, b: pair.b, kind: kind || 'equivalent', en, fr, code };
    });
    const known = new Set(described.map(pair => [pair.a, pair.b].sort().join('\u0000')));
    for (const pair of namePairs(stats)) {
        if (!known.has([pair.a, pair.b].sort().join('\u0000'))) described.push(pair);
    }
    return described;
}

// Period columns of a wide table, grouped by what is left of their labels
// once the period is taken out.
function wideGroups(stats) {
    const groups = new Map();
    stats.forEach((stat, index) => {
        if (!numericLike(stat)) return;
        const period = parsePeriodName(stat.label) || parsePeriodName(stat.id);
        if (!period) return;
        const key = period.grain + '|' + period.stem;
        const group = groups.get(key) || { grain: period.grain, stem: period.stem, columns: [] };
        group.columns.push({ id: stat.id, ord: period.ord, index });
        groups.set(key, group);
    });
    const out = [];
    for (const group of groups.values()) {
        const ords = new Set(group.columns.map(column => column.ord));
        if (group.columns.length < 3 || ords.size !== group.columns.length) continue;
        group.columns.sort((x, y) => x.ord - y.ord);
        // Dates on the same day of each month are months ("2018-04-15", "2018-05-15").
        if (group.grain === 'day') {
            const dates = group.columns.map(column => new Date(column.ord * 86400000));
            if (new Set(dates.map(date => date.getUTCDate())).size === 1 &&
                new Set(dates.map(date => date.getUTCFullYear() * 12 + date.getUTCMonth())).size === dates.length) {
                group.grain = 'month';
                group.columns.forEach((column, i) => { column.ord = dates[i].getUTCFullYear() * 12 + dates[i].getUTCMonth(); });
            }
        }
        out.push(group);
    }
    return out;
}

// Does a column equal the sum of others, row by row? Only complete rows count:
// a suppressed cell makes the row say nothing either way.
function sumsTo(total, parts, numbersOf) {
    const whole = numbersOf(total);
    const lists = parts.map(part => numbersOf(part));
    let complete = 0;
    let agree = 0;
    for (let r = 0; r < whole.length; r += 1) {
        if (Number.isNaN(whole[r])) continue;
        let sum = 0;
        let ok = true;
        for (const list of lists) {
            if (Number.isNaN(list[r])) { ok = false; break; }
            sum += list[r];
        }
        if (!ok) continue;
        complete += 1;
        if (Math.abs(whole[r] - sum) <= Math.max(0.5, Math.abs(whole[r]) * 0.005)) agree += 1;
    }
    return { complete, agree };
}

// For each wide group, a sibling column that is its total ("2023 Total").
function wideTotals(groups, stats, numbersOf) {
    for (const group of groups) {
        group.total = null;
        const members = new Set(group.columns.map(column => column.index));
        for (let index = 0; index < stats.length; index += 1) {
            const stat = stats[index];
            if (members.has(index) || !stat.number) continue;
            const name = nameEvidence(stat.label);
            if (!name.total) continue;
            const period = parsePeriodName(stat.label);
            const stem = period ? period.stem : name.normal;
            const rest = stem.split(' ').filter(word => !/^(?:total|totals|totaux|tot|somme|sum|ytd|cumul|cumulatif|ensemble|all)$/.test(word)).join(' ');
            if (rest !== group.stem) continue;
            // A yearly total beside monthly columns covers the months of its year only.
            let parts = group.columns;
            if (period && period.grain === 'year' && (group.grain === 'month' || group.grain === 'quarter')) {
                const per = group.grain === 'month' ? 12 : 4;
                parts = group.columns.filter(column => Math.floor(column.ord / per) === period.ord);
            }
            if (parts.length < 2) continue;
            const { complete, agree } = sumsTo(index, parts.map(column => column.index), numbersOf);
            const verified = complete >= 5 && agree >= complete * 0.95;
            const entry = { id: stat.id, verified, covers: parts.map(column => column.id), period: period ? { grain: period.grain, ord: period.ord } : null };
            if (period && period.grain === 'year' && parts.length < group.columns.length) (group.period_totals || (group.period_totals = [])).push(entry);
            else if (!group.total || (verified && !group.total.verified)) group.total = entry;
        }
    }
    return groups;
}

// A measure column that is the sum of the other measure columns ("Total").
function derivedTotals(stats, numbersOf, taken) {
    const measures = stats.map((stat, index) => ({ stat, index })).filter(({ stat, index }) => numericLike(stat) && !taken.has(index));
    const found = [];
    if (measures.length < 3 || measures.length > 30) return found;
    for (const { stat, index } of measures) {
        if (!nameEvidence(stat.label).total) continue;
        const parts = measures.filter(other => other.index !== index && !nameEvidence(other.stat.label).total).map(other => other.index);
        if (parts.length < 2) continue;
        const { complete, agree } = sumsTo(index, parts, numbersOf);
        if (complete >= 5 && agree >= complete * 0.95) found.push({ id: stat.id, covers: parts.map(part => stats[part].id), verified: true });
    }
    return found;
}

const yearLike = stat => Boolean(stat.number) && stat.number.integer_share >= 0.99 && stat.number.min >= 1800 && stat.number.max <= 2100;

// A year column with a month or quarter column beside it.
// At most this many year columns and part columns are paired: a table has one
// or two of each, and every pair is a pass over the sample.
const COMPOSITE_YEARS = 4;
const COMPOSITE_PARTS = 6;

async function compositeTimes(stats, matrix, pause) {
    const years = stats.map((stat, index) => ({ stat, index })).filter(({ stat }) => yearLike(stat) && stat.distinct >= 1).slice(0, COMPOSITE_YEARS);
    const out = [];
    if (!years.length) return out;
    let parts = 0;
    for (const [index, stat] of stats.entries()) {
        if (parts >= COMPOSITE_PARTS) break;
        let part = stat.period && stat.period.part && stat.period.parsed >= stat.real_cells * 0.9 ? stat.period.part : null;
        const name = nameEvidence(stat.label);
        if (!part && stat.number && stat.number.integer_share >= 0.99 && name.yearPart && stat.number.min >= 1) {
            if (stat.number.max <= 4 && /quarter|trimestre|qtr/.test(name.normal)) part = 'quarter';
            else if (stat.number.max <= 12) part = 'month';
        }
        if (!part) continue;
        parts += 1;
        for (const year of years) {
            if (year.index === index) continue;
            await pause();
            const seen = new Set();
            const yearsSeen = new Set();
            const x = matrix[year.index];
            const y = matrix[index];
            for (let r = 0; r < x.length; r += 1) {
                if (x[r] === '' || y[r] === '') continue;
                const value = parsePart(y[r], part);
                if (value === null) continue;
                yearsSeen.add(x[r]);
                seen.add(x[r] + '|' + value);
            }
            // A part column only refines the years if some year has several parts.
            if (seen.size > yearsSeen.size && yearsSeen.size >= 1) {
                out.push({ year: year.stat.id, part: stat.id, grain: part, periods: seen.size, years: yearsSeen.size });
            }
        }
    }
    return out;
}

function median(sorted) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Does a measure change scale with a category's values? Thousand-fold gaps
// between typical values mean the rows are not the same kind of quantity.
function scaleMixes(stats, matrix, numbersOf) {
    const measures = stats.map((stat, index) => ({ stat, index })).filter(({ stat }) => numericLike(stat) && stat.number.distinct > 2).slice(0, 6);
    // Columns that name measures or units are checked first, however many values they hold.
    const naming = stat => { const name = nameEvidence(stat.label); return name.measureName || name.measureNameWeak || name.unit; };
    // A flag written as a number ("annual wage: 0 or 1") splits a table like any other category.
    const flag = stat => Boolean(stat.number) && stat.number.integer_share >= 0.99 && stat.distinct >= 2 && stat.distinct <= 12 &&
        stat.distinct <= stat.filled * 0.5;
    const categories = stats.map((stat, index) => ({ stat, index }))
        .filter(({ stat }) => categoryLike(stat) || flag(stat) || (naming(stat) && !numericLike(stat) && stat.distinct >= 2 && stat.distinct <= stat.filled * 0.5))
        .sort((x, y) => Number(Boolean(naming(y.stat))) - Number(Boolean(naming(x.stat)))).slice(0, 10);
    const out = [];
    for (const measure of measures) {
        const m = numbersOf(measure.index);
        for (const category of categories) {
            const groups = new Map();
            const c = matrix[category.index];
            for (let r = 0; r < m.length; r += 1) {
                if (Number.isNaN(m[r]) || c[r] === '') continue;
                const key = c[r].toLowerCase();
                const list = groups.get(key);
                if (list) list.push(Math.abs(m[r]));
                else groups.set(key, [Math.abs(m[r])]);
            }
            const spreads = [];
            let wholes = 0;
            let fractions = 0;
            for (const list of groups.values()) {
                if (list.length < 5) continue;
                list.sort((x, y) => x - y);
                const mid = median(list);
                if (mid > 0) spreads.push({ mid, low: list[Math.floor(list.length * 0.25)], high: list[Math.floor(list.length * 0.75)] });
                if (list.every(Number.isInteger)) wholes += 1;
                else fractions += 1;
            }
            if (spreads.length < 2) continue;
            spreads.sort((x, y) => x.mid - y.mid);
            const ratio = spreads[spreads.length - 1].mid / spreads[0].mid;
            // Different quantities sit in separate ranges (hourly wages and
            // annual ones); one quantity with a long tail runs through them all.
            const separate = spreads.some((spread, i) => i > 0 && spreads[i - 1].high > 0 && spreads[i - 1].high * 10 <= spread.low);
            if (ratio >= 1000 && (spreads.length >= 3 || separate)) {
                out.push({ measure: measure.stat.id, by: category.stat.id, ratio: Math.round(ratio), groups: spreads.length,
                    mixed_kinds: wholes > 0 && fractions > 0, separate });
            }
        }
    }
    return out;
}

// A figure that belongs to something larger than the row and is repeated on
// every row of it: the number of turbines in a project on each turbine's row,
// a province's population on each of its towns. Adding it up over the rows
// counts it once per row.
function repeatedFigures(stats, matrix, numbersOf) {
    const rows = matrix.length ? matrix[0].length : 0;
    const measures = stats.map((stat, index) => ({ stat, index }))
        .filter(({ stat }) => numericLike(stat) && stat.number.distinct >= 5 && stat.distinct <= stat.filled * 0.8).slice(0, 8);
    // Keys of things that have a few rows each (a contract and its amendments,
    // a building and its permits): most have one row, enough have several.
    const keys = stats.map((stat, index) => ({ stat, index }))
        .filter(({ stat }) => !numericLike(stat) && !DATE_TYPES.has(stat.type) && stat.distinct >= 5 && stat.distinct <= stat.filled * 0.95 &&
            stat.filled >= rows * 0.8)
        .sort((x, y) => y.stat.distinct - x.stat.distinct).slice(0, 8);
    const out = [];
    for (const measure of measures) {
        const m = numbersOf(measure.index);
        for (const key of keys) {
            const k = matrix[key.index];
            const first = new Map();
            const sizes = new Map();
            let breaks = 0;
            for (let r = 0; r < rows; r += 1) {
                if (Number.isNaN(m[r]) || k[r] === '') continue;
                const seen = first.get(k[r]);
                if (seen === undefined) first.set(k[r], m[r]);
                else if (seen !== m[r]) breaks += 1;
                sizes.set(k[r], (sizes.get(k[r]) || 0) + 1);
            }
            let repeated = 0;
            let groups = 0;
            const values = new Map();
            for (const [name, size] of sizes) {
                if (size < 2) continue;
                repeated += size;
                groups += 1;
                values.set(first.get(name), (values.get(first.get(name)) || 0) + 1);
            }
            // Enough groups of several rows, the figure the same throughout
            // each, and not the same figure in most groups.
            const commonest = Math.max(0, ...values.values());
            if (groups >= 5 && repeated >= Math.max(20, rows * 0.2) && breaks <= repeated * 0.02 && values.size >= Math.min(5, groups) &&
                commonest <= groups * 0.6) {
                out.push({ measure: measure.stat.id, by: key.stat.id, groups });
                break;
            }
        }
    }
    return out;
}

// A column whose every value splits the same people or things another way:
// "Age", "Sex" and "Region" as values of one "Characteristic" column, each
// adding up to the same total. Adding a measure across that column counts
// everything once per way of splitting. Read only from a whole table, where
// the sums are exact.
function repeatedPartitions(stats, matrix, numbersOf, complete) {
    if (!complete) return [];
    const rows = matrix.length ? matrix[0].length : 0;
    const measures = stats.map((stat, index) => ({ stat, index })).filter(({ stat }) => numericLike(stat) && stat.number.distinct > 2 &&
        !stat.number.percent).slice(0, 8);
    const categories = stats.map((stat, index) => ({ stat, index })).filter(({ stat }) => categoryLike(stat) && stat.distinct >= 3 && stat.distinct <= 30);
    const out = [];
    for (const category of categories) {
        const c = matrix[category.index];
        for (const measure of measures) {
            const m = numbersOf(measure.index);
            const sums = new Map();
            const sizes = new Map();
            for (let r = 0; r < rows; r += 1) {
                if (c[r] === '' || Number.isNaN(m[r])) continue;
                const key = c[r].toLowerCase();
                sums.set(key, (sums.get(key) || 0) + m[r]);
                sizes.set(key, (sizes.get(key) || 0) + 1);
            }
            const values = [...sums.values()].filter(value => value > 0).sort((a, b) => a - b);
            if (values.length < 3) continue;
            const mid = median(values);
            const close = [...sums.entries()].filter(([, value]) => value > 0 && Math.abs(value - mid) <= mid * 0.01).map(([key]) => sizes.get(key));
            // Each way of splitting has its own number of parts (two sexes, six
            // age bands): a balanced panel, with the same rows under every value, is not this.
            if (close.length >= 3 && close.length >= values.length * 0.6 && Math.max(...close) >= Math.min(...close) * 1.5) {
                out.push({ by: category.stat.id, measure: measure.stat.id, groups: values.length });
                break;
            }
        }
    }
    return out;
}

// Rows that no column but numbers tells apart: in a table of figures, blocks
// stacked one under the other without the column that would name them (an
// all-ages block over one block per age group). Read from a whole table.
function duplicateKeys(stats, matrix, complete, skip) {
    if (!complete || !matrix.length) return 0;
    // What names a row: text, years, and whole numbers that run densely or
    // repeat (a month number, a line number, a code); not figures (numbers,
    // even behind placeholders), not empty columns, not columns named for a
    // period (the periods of a wide table).
    const keys = stats.map((stat, index) => ({ stat, index })).filter(({ stat }) => {
        if (stat.filled === 0 || parsePeriodName(stat.label)) return false;
        const years = stat.period && stat.period.format === 'year' && stat.period.parsed >= stat.real_cells * 0.9 && stat.period.min >= 1800 &&
            stat.period.max <= 2100;
        if (years) return true;
        const numeric = stat.number && stat.number.parsed >= Math.max(1, stat.real_cells * 0.5);
        if (!numeric) return true;
        const name = nameEvidence(stat.label);
        if (stat.number.integer_share < 0.99 || stat.distinct > 200 || name.additive || name.nonAdditive || name.unitInName) return false;
        const dense = stat.number.distinct / Math.max(1, stat.number.max - stat.number.min + 1) >= 0.5;
        return stat.distinct <= stat.filled * 0.2 || dense;
    });
    if (!keys.length) return 0;
    const rows = matrix[0].length;
    const last = new Map();
    const counts = new Map();
    const gaps = new Map();
    let counted = 0;
    let position = 0;
    for (let r = 0; r < rows; r += 1) {
        if (skip.has(r)) continue;
        const parts = keys.map(({ index }) => matrix[index][r]);
        if (parts.every(part => part === '')) continue;
        const key = parts.join(String.fromCharCode(31));
        counts.set(key, (counts.get(key) || 0) + 1);
        if (last.has(key)) {
            const gap = position - last.get(key);
            gaps.set(gap, (gaps.get(gap) || 0) + 1);
        }
        last.set(key, position);
        counted += 1;
        position += 1;
    }
    let repeated = 0;
    for (const count of counts.values()) if (count > 1) repeated += count;
    if (!counted || !repeated) return 0;
    // Stacked blocks repeat a key one block apart, the same distance for most
    // keys. Records with no id of their own repeat it next to itself, or anywhere.
    let gapCount = 0;
    let common = 0;
    let commonGap = 0;
    for (const [gap, count] of gaps) {
        gapCount += count;
        if (count > common) {
            common = count;
            commonGap = gap;
        }
    }
    return commonGap >= 2 && common >= gapCount * 0.6 ? repeated / counted : 0;
}

/**
 * Profiles a sample of a prepared table.
 * @param {{ columns: Array<{ id: string, type: string, original_label?: string, cast_failed?: boolean }>,
 *   rows: Array<Array<string | number | null>>, plan: ReturnType<typeof samplePlan> }} sample rows are arrays: _id first, then
 *   one cell per column as text (or null), in the order of columns
 * @param {{ signal?: AbortSignal }} [options]
 */
async function profileSample({ columns, rows, plan }, { signal } = {}) {
    const pause = yielder(signal);
    const used = (columns || []).filter(column => column && column.id !== '_id');
    const count = rows.length;
    const ids = new Array(count);
    for (let r = 0; r < count; r += 1) ids[r] = Number(rows[r][0]);

    // Column-major copies: the raw cell (for padding) and the prepped one.
    const raws = [];
    const matrix = [];
    for (let c = 0; c < used.length; c += 1) {
        const raw = new Array(count);
        const values = new Array(count);
        for (let r = 0; r < count; r += 1) {
            const cell = rows[r][c + 1];
            raw[r] = cell === null || cell === undefined ? '' : String(cell);
            values[r] = prep(raw[r]);
        }
        raws.push(raw);
        matrix.push(values);
        await pause();
    }

    // Rows that are not data are set aside before the columns are read, so a
    // note under a table does not turn its first column into text, and words
    // under number columns do not hide the numbers.
    const aside = new Map();
    const setAside = (list, reason) => {
        for (const r of list) {
            if (aside.has(r)) continue;
            aside.set(r, reason);
            for (let c = 0; c < used.length; c += 1) {
                matrix[c][r] = '';
                raws[c][r] = '';
            }
        }
    };
    setAside(noteRows(matrix, count), 'note');
    // A row with nothing in it is not a record. Known exactly only when the
    // whole table was read.
    if (plan.complete) {
        const empty = [];
        for (let r = 0; r < count; r += 1) {
            let filled = false;
            for (let c = 0; c < used.length && !filled; c += 1) filled = matrix[c][r] !== '';
            if (!filled) empty.push(r);
        }
        setAside(empty, 'blank');
    }
    const read = async () => {
        const out = [];
        const skip = new Set(aside.keys());
        for (let c = 0; c < used.length; c += 1) {
            out.push(profileColumn(used[c], matrix[c], raws[c], { complete: plan.complete, skip }));
            await pause();
        }
        return out;
    };
    let stats = await read();
    let found = rowFindings(stats, matrix, ids);
    if (found.header.length || found.second_header.length || found.unit.length || found.tail.length) {
        setAside(found.header, 'header');
        setAside(found.second_header, 'second_header');
        setAside(found.unit, 'unit');
        setAside(found.tail, 'note');
        const units = found.units;
        stats = await read();
        found = { ...rowFindings(stats, matrix, ids), units };
    }
    const excluded = [...aside.entries()].map(([r, reason]) => ({ id: ids[r], reason })).sort((x, y) => x.id - y.id);

    // A table writes its numbers one way. Where another column plainly uses
    // the comma as a decimal mark, "1,234" beside small whole numbers stays a guess.
    if (stats.some(stat => stat.number && stat.number.rule.core === 'decimal_comma' && !stat.number.ambiguous)) {
        for (const stat of stats) {
            if (stat.number && stat.number.settled === 'short_integers') stat.number.ambiguous = true;
        }
    }

    // Each number column parsed once: NaN where the cell holds no number.
    const parsed = new Array(used.length).fill(null);
    const numbersOf = c => {
        if (parsed[c]) return parsed[c];
        const out = new Float64Array(count).fill(NaN);
        const rule = stats[c].number?.rule;
        if (rule) {
            const seen = new Map();
            const values = matrix[c];
            for (let r = 0; r < count; r += 1) {
                if (values[r] === '') continue;
                let number = seen.get(values[r]);
                if (number === undefined) {
                    number = parseNumber(values[r], rule);
                    seen.set(values[r], number);
                }
                if (number !== null) out[r] = number;
            }
        }
        parsed[c] = out;
        return out;
    };
    for (let c = 0; c < used.length; c += 1) {
        if (stats[c].number && stats[c].number.integer_share >= 0.99) stats[c].sequence = sequenceOf(ids, numbersOf(c), stats[c]);
        await pause();
    }

    const byId = new Map(stats.map(stat => [stat.id, stat]));
    const pairs = describePairs(await findPairs(stats, matrix, pause), byId, stats);
    await pause();
    const wide = wideTotals(wideGroups(stats), stats, numbersOf);
    const inWide = new Set(wide.flatMap(group => group.columns.map(column => column.index)));
    await pause();
    const totals = derivedTotals(stats, numbersOf, inWide);
    const composite = await compositeTimes(stats, matrix, pause);
    await pause();
    const mixes = scaleMixes(stats, matrix, numbersOf);
    await pause();
    const repeated = repeatedFigures(stats, matrix, numbersOf);
    await pause();
    const partitions = repeatedPartitions(stats, matrix, numbersOf, plan.complete);
    const stacked = duplicateKeys(stats, matrix, plan.complete, new Set(aside.keys()));

    return {
        v: 1,
        sample: { rows: count, table_rows: plan.rows, complete: plan.complete, text_cut: TEXT_CUT },
        columns: stats,
        rows: {
            // Rows set aside, by _id: charts leave exactly these out.
            excluded,
            notes: excluded.filter(row => row.reason === 'note').length,
            headers: excluded.filter(row => row.reason === 'header' || row.reason === 'second_header').length,
            unit_rows: excluded.filter(row => row.reason === 'unit').length,
            blank_rows: excluded.filter(row => row.reason === 'blank').length,
            units: found.units || {},
            total_rows: found.total_rows,
            total_labels: found.total_labels,
            aggregate_labels: found.aggregate_labels || {}
        },
        pairs,
        groups: {
            wide: wide.map(group => ({ grain: group.grain, stem: group.stem, columns: group.columns.map(({ id, ord }) => ({ id, ord })),
                total: group.total, period_totals: group.period_totals || [] })),
            derived_totals: totals,
            composite_time: composite,
            scale_mixed: mixes,
            repeated,
            partitions,
            // Share of rows that no column other than numbers tells apart.
            duplicate_keys: stacked
        }
    };
}

module.exports = { samplePlan, profileSample, numericLike, categoryLike, yearLike, TEXT_CUT, MAX_ROWS, CELL_TARGET };
