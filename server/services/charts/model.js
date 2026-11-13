// What a table is, decided from its profile: a role and a cleaning rule for
// each column, the time axes, the period columns of a wide table, and whether
// its rows are records or figures somebody already added up.
//
// Values decide. A column's name only raises or lowers confidence, except
// where values cannot tell: what a period column is called, which language a
// twin column speaks, and whether a quantity adds up.
const { nameEvidence, isTotalLabel, isAggregateLabel, isGenericName, isMissingToken, TABLE_BLANK_TOKENS, codeLabels, labelKind, isMeasureLabel, isGarbled,
    isNationalLabel, isRegionLabel, isProvinceName } = require('./tokens');
const { numericLike } = require('./profile');

const NUMERIC_TYPES = new Set(['INTEGER', 'NUMERIC']);
const DATE_TYPES = new Set(['DATE', 'TIMESTAMPTZ']);
const DAY_MS = 86400000;

const AUTO_CATEGORY_MAX = 60;
// A unit that this share of the rows are in is the table's unit.
const DOMINANT_SHARE = 0.9;
// The most groups a chart labelled with bare numbers may have.
const NUMERIC_LABELS_MAX = 12;
const CATEGORY_MAX = 20000;
const PERIOD_MAX = 400;
const MIN_YEAR = 1800;

const share = (part, whole) => (whole > 0 ? part / whole : 0);
// One value this common says nothing as a breakdown.
const DOMINANT_GROUP = 0.95;
const DICTIONARY_MAX_ROWS = 2000;
// "20230115": a date written as a number.
const DATE_NUMBER_RE = /^(1[89]|20|21)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$/;
// A year or a date inside a label: "Claim period 1 (Sep 27, 2020 to Oct 24, 2020)", "2021-22 Q1".
const DATED_LABEL_RE = /(?:^|[^0-9])(?:1[89]|20)[0-9]{2}(?:[^0-9]|$)/;
// A measure whose name only says that it is a value.
const VALUE_NAME_RE = /^(?:measure |data |obs |observation )?(?:value|values|valeur|valeurs|amount|montant|estimate|estimation|result|resultat|data|donnee|donnees)(?: |$)/;

// Flags inside a number column ("uu", "qq", "F") and words that recur where
// the numbers are ("no production", "Confidential", "<5"): a small closed set
// of them, in a column that is mostly numbers, is the publisher's way of
// saying "no number here".
function flagTokens(stat) {
    const recurring = stat.other.recurring || {};
    const words = Object.keys(recurring);
    if (words.length > 0 && words.length <= 8 && stat.number.parsed >= stat.other.cells) return { tokens: words, counts: recurring };
    const short = Object.keys(stat.other.short);
    return short.length > 0 && short.length <= 8 ? { tokens: short, counts: stat.other.short } : { tokens: [], counts: {} };
}

function numberReading(stat) {
    if (!stat.number) return null;
    const { tokens: flags, counts } = flagTokens(stat);
    const flagged = flags.reduce((sum, token) => sum + counts[token], 0);
    const unreadable = stat.other.cells - flagged;
    const readable = stat.number.parsed + unreadable;
    return {
        parsed: stat.number.parsed,
        unreadable,
        unreadable_share: share(unreadable, readable),
        // Nearly all numbers; a stray cell or two in a small table still counts as clean.
        clean: share(unreadable, readable) <= 0.02 || (unreadable <= 2 && share(unreadable, readable) <= 0.25),
        missing_tokens: [...Object.keys(stat.missing.tokens), ...flags],
        missing_cells: stat.missing.cells + flagged,
        stray_kinds: stat.other.distinct - flags.length
    };
}

// Does every value of this column head the same number of rows? Statistical
// tables are built that way (each year, each region, the same cells); records
// of events or things never are.
function balanced(stat) {
    const groups = stat.top.filter(entry => entry.v !== '').map(entry => entry.n);
    if (groups.length < 3) return false;
    const mean = groups.reduce((sum, n) => sum + n, 0) / groups.length;
    const spread = (Math.max(...groups) - Math.min(...groups)) / mean;
    // A sample scatters the counts; allow for that around the mean.
    return mean >= 4 && spread <= Math.max(0.02, 4 / Math.sqrt(mean));
}

function dateGrain(minDay, maxDay) {
    const span = maxDay - minDay;
    if (span > 1095) return 'year';
    if (span > 75) return 'month';
    return 'day';
}

// How completely a column's years fill their range, allowing for a regular
// step: census years five apart are as regular as consecutive years.
function yearDensity(stat, period) {
    const span = period.max - period.min;
    let step = 1;
    if (stat.exact_distinct && stat.distinct <= stat.top.length) {
        const years = stat.top.map(entry => Number(entry.v)).filter(year => Number.isInteger(year) && year >= period.min && year <= period.max)
            .sort((a, b) => a - b);
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        if (years.length >= 3) step = years.slice(1).reduce((divisor, year, i) => gcd(divisor, year - years[i]), 0) || 1;
    }
    return period.distinct / (span / step + 1);
}

const GRAINS_FROM = { day: ['day', 'month', 'quarter', 'year'], month: ['month', 'quarter', 'year'], quarter: ['quarter', 'year'],
    year: ['year'], fiscal_year: ['fiscal_year'] };

function additivity(stat, name, verifiedTotal, repeatedBy, doubtful, sameLength) {
    if (stat.number.percent) return { additive: 'no', reason: 'percent' };
    // Nearly every row a different whole number and no name to go by: a key
    // as often as an amount. Not added up or averaged on the engine's initiative.
    if (doubtful) return { additive: 'unknown', reason: 'unique_whole_numbers' };
    // Three-digit numbers that repeat and say nothing of what they are: a
    // measurement or a daily count as often as a code. Averaged, never added up.
    if (sameLength) return { additive: 'unknown', reason: 'same_length_numbers' };
    // Repeated on every row of something larger: adding the rows up would count it many times.
    if (repeatedBy) return { additive: 'no', reason: 'repeated_per_group' };
    if (name.nonAdditive) return { additive: 'no', reason: 'name' };
    if (verifiedTotal) return { additive: 'yes', reason: 'verified_total' };
    if (stat.number.currency) return { additive: 'yes', reason: 'currency' };
    if (name.additive) return { additive: 'yes', reason: 'name' };
    // Whole, non-negative and varied: most likely a count of something. A
    // short table cannot show thirteen different values, so there it is
    // enough that nearly every row differs and the values are not tiny.
    const varied = stat.number.distinct > 12 ||
        (stat.number.distinct >= 3 && stat.number.distinct >= stat.number.parsed * 0.6 && stat.number.max >= 20);
    if (stat.number.integer_share >= 0.99 && stat.number.negative_share === 0 && varied) {
        return { additive: 'probable', reason: 'whole_numbers' };
    }
    return { additive: 'unknown', reason: 'none' };
}

/**
 * The role of one column. First match wins.
 * @returns {{ role: string, confidence: 'high' | 'medium' | 'low', reasons: object[], time?: object, part?: string }}
 */
function decideRole(stat, context) {
    const name = nameEvidence(stat.label);
    const reading = numberReading(stat);
    const real = stat.real_cells;
    const missingKinds = Object.keys(stat.missing.tokens).length;
    const distinctReal = Math.max(0, stat.distinct - missingKinds);
    const ratio = share(stat.distinct, stat.filled);
    const typedNumber = NUMERIC_TYPES.has(stat.type);
    const typedDate = DATE_TYPES.has(stat.type);
    const decide = (role, confidence, code, extra = {}) => ({ role, confidence, reasons: [{ code }], ...extra });

    if (stat.filled === 0 || share(stat.filled, stat.cells) < 0.005 || real <= 0) return decide('empty', 'high', 'empty');
    if (distinctReal <= 1) return decide('constant', 'high', 'constant');

    const integers = Boolean(stat.number) && stat.number.integer_share >= 0.99 && reading.clean;

    if (typedDate && stat.period && stat.period.grain === 'day') {
        const grain = dateGrain(stat.period.min, stat.period.max);
        return decide('time', 'high', 'typed_date', { time: { kind: 'typed', grain, grains: GRAINS_FROM.day,
            first: stat.period.min, last: stat.period.max, days: stat.period.distinct } });
    }
    if (typedDate) return decide('other', 'low', 'unreadable_dates');

    // Years as numbers or as text: whole numbers in a plausible range that
    // run in regular steps. An amount that happens to fall between 1800 and
    // 2100 jumps about and has no period name. A stray cell or two (a "0"
    // for an unknown year) does not undo the column.
    const years = stat.number && stat.period && stat.period.format === 'year' ? stat.period : null;
    const strayYears = years ? real - years.parsed : 0;
    if (years && stat.number.integer_share >= 0.99 && (share(strayYears, real) <= 0.02 || (strayYears <= 2 && share(strayYears, real) <= 0.25)) &&
        years.min >= MIN_YEAR && years.max <= context.maxYear && years.distinct >= 2 && years.distinct <= PERIOD_MAX) {
        const density = yearDensity(stat, years);
        if (density >= 0.8 || (name.period && (density >= 0.5 || years.distinct <= 5))) {
            return decide('time', density >= 0.8 && name.period ? 'high' : 'medium', 'year_values', { time: { kind: 'year_number',
                grain: 'year', grains: GRAINS_FROM.year, first: years.min, last: years.max, periods: years.distinct, text: !typedNumber } });
        }
        // Named as a year but too scattered for an axis: something to group
        // by, never something to add up.
        if (name.period) return decide('code', 'medium', 'year_like');
    }
    // Periods as text. A stray cell or two (a note under a short table) is allowed.
    const strayPeriods = stat.period ? real - stat.period.parsed : 0;
    const periodic = stat.period && !stat.period.part && stat.period.format !== 'year' && stat.period.distinct >= 2 &&
        (share(stat.period.parsed, real) >= 0.95 || (strayPeriods <= 2 && share(strayPeriods, real) <= 0.25));
    if (periodic) {
        const days = stat.period.format === 'iso_date' || stat.period.format === 'day_month_year';
        if (stat.period.format === 'iso_date') {
            return decide('time', 'high', 'text_date', { time: { kind: 'text_date', format: 'iso_date', grain: dateGrain(stat.period.min, stat.period.max),
                grains: GRAINS_FROM.day, first: stat.period.min, last: stat.period.max } });
        }
        // Dates are a time axis however many days they hold; named periods up to a few hundred.
        if (days || (stat.period.distinct <= PERIOD_MAX && stat.est_distinct <= PERIOD_MAX)) {
            const grain = days ? dateGrain(stat.period.min, stat.period.max) : stat.period.grain;
            return decide('time', 'high', days ? 'text_date' : 'text_period', { time: { kind: 'text_period', format: stat.period.format,
                order: stat.period.order || null, grain, grains: GRAINS_FROM[days ? 'day' : stat.period.grain].filter(g => !days || g !== 'day' || grain === 'day'),
                first: stat.period.min, last: stat.period.max, ...(days ? {} : { periods: stat.period.distinct }) } });
        }
    }
    if (context.parts.has(stat.id)) return decide('time_part', 'high', 'time_part', { part: context.parts.get(stat.id) });
    // Months or quarters with no year beside them: something to group by.
    if (integers && name.yearPart && stat.number.min >= 1 && stat.number.max <= 12) return decide('code', 'medium', 'period_part');

    // Row numbers count with _id from 0 or 1, as bare digits. Other columns
    // that step with _id (a year on each row of a yearly table) were read above.
    const quantityName = name.additive || name.nonAdditive || name.unitInName || VALUE_NAME_RE.test(name.normal);
    const bare = integers && stat.number.rule.core === 'plain' && !stat.number.rule.symbols && !quantityName;
    if (bare && stat.sequence && stat.filled >= 3 && stat.sequence.row_number_share >= 0.99 &&
        (Math.abs(stat.sequence.offset) <= 1 || name.rowNumber)) {
        return decide('row_number', 'high', 'row_number');
    }
    // By its name alone only when it also counts upwards, or holds each of a
    // run of numbers once in some other order: "(#)" over a column of counts
    // is not a row number.
    const run = integers && stat.number.distinct / (stat.number.max - stat.number.min + 1) >= 0.9;
    if (bare && name.rowNumber && (stat.sequence?.rising_share >= 0.9 ||
        (/^(?:#|no|num|numero|row|ligne|rang|seq|sequence|objectid|fid|index|idx)$/.test(name.normal) && ratio >= 0.98 && run && stat.filled >= 3))) {
        return decide('row_number', 'medium', 'row_number_name');
    }

    if (name.geometry && stat.number) return decide('geometry', 'medium', 'geometry');
    // Latitudes and longitudes by their name and range; whole degrees count too.
    if (stat.number && reading.clean && !name.additive) {
        if (name.latitude && stat.number.min >= -90 && stat.number.max <= 90) return decide('coordinate', 'medium', 'coordinate');
        if (name.longitude && stat.number.min >= -180 && stat.number.max <= 180) return decide('coordinate', 'medium', 'coordinate');
    }

    // Dates written as numbers ("20230115") are neither keys nor quantities.
    if (integers && stat.number.fixed_width === 8 && stat.top.length &&
        share(stat.top.filter(entry => DATE_NUMBER_RE.test(entry.v)).reduce((sum, entry) => sum + entry.n, 0), stat.top.reduce((sum, entry) => sum + entry.n, 0)) >= 0.9) {
        return decide('code', 'medium', 'date_numbers');
    }
    // People's first or last names repeat, but a group of every "John" is no group.
    if (name.personName && !stat.number) return decide('text', 'high', 'person_names');

    const contact = stat.patterns.url + stat.patterns.email + stat.patterns.phone + stat.patterns.postal;
    if (share(contact, stat.filled) >= 0.8) return decide('identifier', 'high', 'contact_values');
    const nearUnique = ratio >= 0.9 && stat.filled >= 20;
    if (nearUnique) {
        // Unique numbers are a key when they all have the same length or are
        // zero-padded, unless the name says they measure something: a
        // country's population is unique and eight digits every year.
        // A short table of figures has them all different and often all the
        // same length (populations of one city over the years), so there the
        // length must be a key's, and a table with one row per period has no keys.
        const fixed = stat.number && !quantityName && !context.series &&
            (stat.number.fixed_width >= 7 || (stat.number.fixed_width >= 5 && stat.filled >= 200));
        const padded = stat.number && stat.number.leading_zero_share >= 0.05;
        const wordless = share(stat.patterns.spaces, stat.filled) <= 0.05 && share(stat.patterns.digits, stat.filled) >= 0.8 &&
            share(stat.patterns.letters, stat.filled) >= 0.5;
        if (fixed || padded || wordless || (integers && (name.identifier || (name.code && !name.additive)))) return decide('identifier', 'high', 'unique_values');
    }
    // A key that repeats ("896568417RR0001" on each of a charity's rows) is
    // still a key: digits and letters run together, hundreds of them.
    const numeric = Boolean(stat.number) && share(stat.number.parsed, real) >= 0.5;
    if (!numeric && stat.est_distinct > 200 && stat.length.avg >= 5 && share(stat.patterns.spaces, stat.filled) <= 0.05 &&
        share(stat.patterns.digits, stat.filled) >= 0.8) return decide('identifier', 'medium', 'key_values');

    if (stat.number && reading.clean && stat.number.leading_zero_share >= 0.05) {
        return decide(stat.est_distinct <= CATEGORY_MAX && !nearUnique ? 'code' : 'identifier', 'high', 'leading_zeros');
    }
    if (context.codes.has(stat.id)) return decide('code', 'high', 'code_of_label');
    // Named a code: one, whatever its numbers look like ("NOC" runs from 1 to 99999).
    if (integers && !nearUnique && name.code && !name.additive) return decide('code', 'medium', 'code_name');
    // An id that repeats is a key to group by, never a quantity.
    if (integers && name.identifier && !name.additive) return decide('code', 'medium', 'id_name');
    // A number given to a thing ("Ward 14", "Class 3") names it.
    if (integers && name.nominal && !quantityName && stat.est_distinct <= CATEGORY_MAX) return decide('code', 'medium', 'unit_name');
    // Many different whole numbers that all have the same number of digits and
    // repeat down the table are codes: counts come in every length. Three
    // digits are not enough (daily counts between 100 and 999 have three);
    // two-digit ones need to repeat heavily.
    if (integers && !context.quantities.has(stat.id) && !quantityName &&
        ((stat.number.fixed_width >= 4 && stat.number.distinct >= 20 && ratio < 0.5) ||
            (stat.number.fixed_width === 2 && distinctReal > 12 && ratio < 0.1))) return decide('code', 'medium', 'same_length_numbers');
    if (share(stat.patterns.code_label, stat.filled) >= 0.9 && !nearUnique) {
        return decide('category', 'high', 'code_label_values', { strip_code_prefix: true });
    }
    const quantity = context.quantities.has(stat.id);
    // A handful of small whole numbers that repeat is a flag, a rating or a
    // code. Large values are amounts, however few of them there are.
    if (integers && !quantity && distinctReal <= 12 && stat.number.min >= 0 && stat.number.max < 1000 && !quantityName &&
        share(stat.distinct, stat.filled) < 0.25) {
        return decide('code', 'low', 'few_whole_numbers');
    }

    // Text is a number column when what is not blank or a missing-value token
    // parses, with enough cells to tell (two will do when nothing is stray).
    const enough = stat.number && (stat.number.parsed >= 5 || (stat.number.parsed >= 2 && reading.unreadable === 0));
    if (stat.number && (typedNumber || (enough && reading.clean && reading.stray_kinds <= 12 && stat.other.longest <= 40))) {
        if (stat.number.distinct <= 2 && !quantity) return decide('code', 'low', 'two_values');
        return decide('measure', stat.number.ambiguous ? 'low' : typedNumber || reading.missing_cells === 0 ? 'high' : 'medium',
            typedNumber ? 'numeric_typed' : 'numeric_text');
    }

    if (stat.length.avg > 60 || share(stat.patterns.cut, stat.filled) >= 0.2 || (name.freeText && stat.length.avg > 30)) {
        return decide('text', 'high', 'long_text');
    }
    if (nearUnique) return decide(share(stat.patterns.letters, stat.filled) >= 0.8 ? 'label' : 'identifier', 'medium', 'unique_names');
    // Values that repeat are something to group by: a share chart when there
    // are few, a ranking when there are many.
    if (distinctReal >= 2 && stat.est_distinct <= CATEGORY_MAX && ratio < 0.9) {
        return decide('category', stat.est_distinct <= AUTO_CATEGORY_MAX && ratio <= 0.5 ? 'high' : 'medium', 'repeating_values');
    }
    if (stat.filled < 20 && distinctReal >= 2 && share(stat.patterns.letters, stat.filled) >= 0.8) {
        // In a short table too, digits and letters run together are a key, not a name.
        const key = share(stat.patterns.spaces, stat.filled) <= 0.05 && share(stat.patterns.digits, stat.filled) >= 0.8;
        return decide(key ? 'identifier' : 'label', 'low', 'unique_names');
    }
    return decide('other', 'low', 'unclassified');
}

/**
 * @param {Awaited<ReturnType<import('./profile').profileSample>>} profile
 * @param {{ rowCount: number, now?: Date }} table
 */
function buildTableModel(profile, { rowCount, now = new Date() } = {}) {
    const stats = profile.columns;
    const byId = new Map(stats.map(stat => [stat.id, stat]));
    // Forecasts run decades ahead; regular steps or a period name tell years from amounts.
    const maxYear = Math.max(2100, now.getUTCFullYear() + 10);

    // Year + month/quarter pairs name their part columns before roles are decided.
    const parts = new Map();
    for (const pair of profile.groups.composite_time) parts.set(pair.part, pair.grain);
    // A number that goes one-to-one with a name is its code, unless its own
    // name says it counts or measures something.
    const quantityNamed = id => { const name = nameEvidence(byId.get(id).label); return name.additive || name.nonAdditive || name.unitInName; };
    const codes = new Set(profile.pairs.filter(pair => pair.kind === 'code_label' && pair.code && !quantityNamed(pair.code)).map(pair => pair.code));
    const verifiedTotals = new Set(profile.groups.derived_totals.filter(total => total.verified).map(total => total.id));
    const wideOf = new Map();
    const wideTotals = new Map();
    profile.groups.wide.forEach((group, index) => {
        const id = 'w' + index;
        group.columns.forEach(column => wideOf.set(column.id, id));
        for (const total of [group.total, ...(group.period_totals || [])]) if (total) wideTotals.set(total.id, { group: id, verified: total.verified });
    });

    // Period columns and verified totals are quantities however few values they hold.
    const quantities = new Set([...wideOf.keys(), ...wideTotals.keys(), ...verifiedTotals]);
    const repeatedBy = new Map((profile.groups.repeated || []).map(entry => [entry.measure, entry.by]));
    const context = { parts, codes, maxYear, quantities, series: false };
    // One row per period: a series, where every number is a figure of its period.
    context.series = stats.some(stat => decideRole(stat, context).role === 'time' && stat.filled >= profile.sample.rows * 0.9 &&
        stat.distinct >= stat.filled * 0.95) && profile.sample.complete;
    const columns = stats.map(stat => {
        const decided = decideRole(stat, context);
        const name = nameEvidence(stat.label);
        const column = { id: stat.id, label: stat.label, type: stat.type, role: decided.role, confidence: decided.confidence,
            reasons: decided.reasons, generic_name: isGenericName(stat.label), blank_share: share(stat.blank, stat.cells) };
        if (decided.time) column.time = decided.time;
        if (decided.part) column.part = decided.part;
        const reading = numberReading(stat);
        if (decided.role === 'measure') {
            const total = verifiedTotals.has(stat.id) || wideTotals.get(stat.id)?.verified === true;
            const quantityName = name.additive || name.nonAdditive || name.unitInName || name.measureName || VALUE_NAME_RE.test(name.normal);
            const doubtful = !total && !quantityName && !stat.number.currency && !stat.number.percent && stat.number.integer_share >= 0.99 &&
                stat.filled >= 50 && share(stat.distinct, stat.filled) >= 0.95 && !wideOf.has(stat.id) && !context.series;
            const sameLength = !total && !quantityName && !stat.number.currency && stat.number.integer_share >= 0.99 && stat.number.fixed_width === 3 &&
                stat.number.distinct >= 20 && share(stat.distinct, stat.filled) < 0.5;
            column.measure = {
                ...additivity(stat, name, total, total ? null : repeatedBy.get(stat.id), doubtful, sameLength),
                doubtful,
                text: !NUMERIC_TYPES.has(stat.type),
                clean: NUMERIC_TYPES.has(stat.type) ? null : { ...stat.number.rule, missing: reading.missing_tokens,
                    ...(stat.missing.sentinels.length ? { sentinel: true } : {}) },
                // Figures that stand for "no figure" in a typed column (99999.9).
                sentinels: NUMERIC_TYPES.has(stat.type) ? stat.missing.sentinels.slice(0, 8) : [],
                missing_share: share(reading.missing_cells, stat.filled),
                unreadable_share: reading.unreadable_share,
                integer: stat.number.integer_share >= 0.99,
                percent: stat.number.percent, currency: stat.number.currency, ambiguous: stat.number.ambiguous,
                min: stat.number.min, max: stat.number.max,
                // A unit the publisher wrote in a row of its own under the header.
                unit: profile.rows.units[stat.id] || null,
                blocked_by: []
            };
            if (column.measure.text) column.reasons.push({ code: 'numbers_in_text' });
            if (reading.missing_cells > 0) column.reasons.push({ code: 'missing_tokens', tokens: reading.missing_tokens.slice(0, 6), share: column.measure.missing_share });
            if (stat.number.ambiguous) column.reasons.push({ code: 'number_format_assumed', format: stat.number.rule.core });
            if (wideOf.has(stat.id)) column.wide = wideOf.get(stat.id);
            if (wideTotals.has(stat.id)) column.wide_total = wideTotals.get(stat.id).group;
            if (verifiedTotals.has(stat.id)) column.reasons.push({ code: 'derived_total' });
            if (column.measure.reason === 'repeated_per_group') column.reasons.push({ code: 'repeated_per_group', by: repeatedBy.get(stat.id) });
            if (doubtful) column.reasons.push({ code: 'unique_whole_numbers' });
        }
        if (decided.role === 'category' || decided.role === 'code') {
            const labels = new Set(profile.rows.total_labels[stat.id] || []);
            for (const entry of stat.top) if (isTotalLabel(entry.v)) labels.add(entry.v.toLowerCase());
            const top = stat.top[0];
            const values = stat.top.map(entry => entry.v);
            // Bare numbers make poor labels: only a count that is itself a
            // breakdown ("Bedrooms: 1, 2, 3") reads without a legend.
            const numeric = Boolean(stat.number) && share(stat.number.parsed, stat.real_cells) >= 0.5;
            const reason = decided.reasons[0].code;
            const readable = !numeric || (stat.est_distinct <= NUMERIC_LABELS_MAX &&
                (name.countDimension || name.nominal || reason === 'period_part' || reason === 'year_like'));
            const flags = [];
            // Codes need a legend the table does not give ("U", "ESSF", "*GD").
            if (!numeric && codeLabels(values, { sex: name.sex })) flags.push('code_labels');
            if (stat.labels ? stat.labels.garbled > 0 : values.some(isGarbled)) flags.push('garbled_text');
            // Years or dates inside the labels: periods that were not read as a time axis.
            const dated = stat.labels ? share(stat.labels.dated_cells, stat.labels.cells)
                : share(stat.top.filter(entry => DATED_LABEL_RE.test(entry.v)).reduce((sum, entry) => sum + entry.n, 0), stat.top.reduce((sum, entry) => sum + entry.n, 0));
            if (values.length >= 2 && dated >= 0.9) flags.push('period_labels');
            const topShare = top ? share(top.n, stat.filled) : 0;
            if (topShare >= DOMINANT_GROUP) flags.push('one_value_dominates');
            for (const flag of flags) column.reasons.push({ code: flag });
            column.category = {
                distinct: stat.est_distinct,
                total_members: [...labels].slice(0, 8),
                strip_code_prefix: decided.strip_code_prefix === true,
                variants: stat.spellings > 0 || stat.padded > 0,
                top_share: topShare,
                numeric,
                flags,
                // Share charts need few groups; rankings take many.
                breakdown: readable && flags.length === 0 && stat.est_distinct <= AUTO_CATEGORY_MAX && column.blank_share <= 0.5
            };
        }
        if (decided.role === 'label') {
            const values = stat.top.map(entry => entry.v);
            const flags = [];
            if (codeLabels(values)) flags.push('code_labels');
            if (stat.labels ? stat.labels.garbled > 0 : values.some(isGarbled)) flags.push('garbled_text');
            for (const flag of flags) column.reasons.push({ code: flag });
            column.category = { distinct: stat.est_distinct, total_members: [], strip_code_prefix: false, variants: false,
                top_share: 0, numeric: false, flags, breakdown: false };
        }
        // A short key with letters in it ("K1A", a station code) can name the
        // rows of a ranking when nothing better does. A longer one (a permit
        // or request number) names nothing a reader would recognise.
        if (decided.role === 'identifier' && share(stat.patterns.letters, stat.filled) >= 0.8 && stat.length.avg <= 6 &&
            share(stat.patterns.url + stat.patterns.email + stat.patterns.phone + stat.patterns.postal, stat.filled) < 0.2) {
            column.category = { distinct: stat.est_distinct, total_members: [], strip_code_prefix: false, variants: false, top_share: 0, numeric: false,
                breakdown: false };
            column.rankable = true;
        }
        // Rows that add the others up, found in a column that is not a group
        // (a "Total" in a year column): every chart leaves them out too.
        if (!column.category && (profile.rows.total_labels[stat.id] || []).length) column.total_members = profile.rows.total_labels[stat.id].slice(0, 8);
        return column;
    });
    const columnOf = new Map(columns.map(column => [column.id, column]));

    // Twins: the hidden side depends on the reader's language, so the model
    // records both sides and candidates pick.
    for (const pair of profile.pairs) {
        const a = columnOf.get(pair.a);
        const b = columnOf.get(pair.b);
        if (!a || !b) continue;
        if (pair.kind === 'code_label' && pair.code) {
            // A code is charted through its wording, in whichever language.
            const code = columnOf.get(pair.code);
            if (code.role !== 'code' && code.role !== 'identifier' && code.role !== 'category') continue;
            const label = pair.code === pair.a ? b : a;
            (code.label_columns || (code.label_columns = [])).push(label.id);
            label.code_column = code.id;
            continue;
        }
        if (pair.en && pair.fr) {
            columnOf.get(pair.en).twin = { of: pair.fr, lang: 'en', kind: pair.kind };
            columnOf.get(pair.fr).twin = { of: pair.en, lang: 'fr', kind: pair.kind };
        } else if (!a.twin && !b.twin) {
            // No language to go by: keep the first column, hide its copy.
            b.twin = { of: a.id, lang: null, kind: pair.kind, hidden: true };
        }
    }

    // Columns whose values name units, and measures whose scale follows a
    // category: adding across them would add different things.
    const unitColumns = columns.filter(column => (column.role === 'category' || column.role === 'code') &&
        share(byId.get(column.id).patterns.unit, byId.get(column.id).filled) >= 0.8);
    for (const column of columns) {
        if (column.role !== 'measure') continue;
        for (const unit of unitColumns) column.measure.blocked_by.push({ column: unit.id, why: 'units' });
    }
    // A column of measure names beside a column plainly called "value": each
    // row is a different quantity, whatever their sizes.
    const namers = columns.filter(column => (column.role === 'category' || column.role === 'label') && nameEvidence(column.label).measureName &&
        byId.get(column.id).distinct >= 2);
    for (const column of columns) {
        if (column.role !== 'measure' || !VALUE_NAME_RE.test(nameEvidence(column.label).normal)) continue;
        for (const namer of namers) column.measure.blocked_by.push({ column: namer.id, why: 'mixed_measures' });
    }
    for (const mix of profile.groups.scale_mixed) {
        const measure = columnOf.get(mix.measure);
        const by = columnOf.get(mix.by);
        if (!measure || measure.role !== 'measure' || !by || (by.role !== 'category' && by.role !== 'code')) continue;
        const name = nameEvidence(by.label);
        // A name that says so is enough with a thousand-fold gap. Otherwise the
        // groups must sit in separate ranges, and either a weaker name or
        // whole numbers beside fractions must point the same way.
        if (!(name.measureName || name.unit || (mix.separate && (name.measureNameWeak || mix.mixed_kinds)))) continue;
        if (!measure.measure.blocked_by.some(block => block.column === by.id)) {
            measure.measure.blocked_by.push({ column: by.id, why: name.unit ? 'units' : 'mixed_measures', ratio: mix.ratio });
        }
    }

    // A column whose values are themselves names of quantities ("Number of
    // returns", "Total income", "Average wage"): each row holds another one.
    for (const column of columns) {
        if (!column.category || (column.role !== 'category' && column.role !== 'label')) continue;
        const stat = byId.get(column.id);
        const values = stat.top.filter(entry => entry.v !== '');
        const named = stat.labels ? stat.labels.measure : values.filter(entry => isMeasureLabel(entry.v)).length;
        const distinct = stat.labels ? stat.labels.distinct : values.length;
        if (named < 3 || named < distinct * 0.3) continue;
        column.reasons.push({ code: 'measure_names' });
        for (const measure of columns) {
            if (measure.role !== 'measure' || measure.measure.blocked_by.some(block => block.column === column.id)) continue;
            measure.measure.blocked_by.push({ column: column.id, why: 'mixed_measures' });
        }
    }

    // Where nearly every row is in one unit (99% of contracts in CAD), the
    // measure is read in that unit alone and the other rows are left out,
    // rather than the measure not being added up at all.
    for (const column of columns) {
        if (column.role !== 'measure' || column.measure.blocked_by.length !== 1) continue;
        const block = column.measure.blocked_by[0];
        const stat = byId.get(block.column);
        const top = stat && stat.top[0];
        if (!top || top.v === '' || top.v.length >= 80 || isMissingToken(top.v) || share(top.n, stat.filled) < DOMINANT_SHARE) continue;
        column.measure.only = { column: block.column, value: top.v, share: share(top.n, stat.cells), why: block.why };
        column.measure.blocked_by = [];
        column.reasons.push({ code: 'one_unit_only', column: block.column, value: top.v });
    }

    const timeAxes = [];
    for (const column of columns) {
        // When a record was last edited or published is not when anything happened.
        if (column.role === 'time' && nameEvidence(column.label).maintenance) {
            column.time.maintenance = true;
            column.reasons.push({ code: 'maintenance_date' });
            continue;
        }
        if (column.role === 'time') timeAxes.push({ id: 't:' + column.id, columns: [column.id], kind: column.time.kind, grain: column.time.grain,
            grains: column.time.grains, composite: false, ...(column.time.periods ? { periods: column.time.periods } : {}) });
    }
    for (const pair of profile.groups.composite_time) {
        const year = columnOf.get(pair.year);
        const part = columnOf.get(pair.part);
        // One year throughout still dates its months.
        if (!year || !part || (year.role !== 'time' && year.role !== 'constant') || part.role !== 'time_part') continue;
        timeAxes.push({ id: 't:' + pair.year + '+' + pair.part, columns: [pair.year, pair.part], kind: 'composite', grain: pair.grain,
            grains: [pair.grain, 'year'], composite: true, periods: pair.periods });
    }

    const wideGroups = profile.groups.wide.map((group, index) => {
        const members = group.columns.map(column => columnOf.get(column.id));
        const measures = members.filter(column => column && column.role === 'measure');
        const stemName = nameEvidence(group.stem);
        const votes = measures.map(column => column.measure.additive);
        let additive = 'unknown';
        if (stemName.nonAdditive || votes.includes('no')) additive = 'no';
        else if (stemName.additive || group.total?.verified || votes.includes('yes')) additive = 'yes';
        else if (votes.length && votes.every(vote => vote === 'probable')) additive = 'probable';
        return { id: 'w' + index, grain: group.grain, stem: group.stem, additive,
            columns: group.columns.filter(column => columnOf.get(column.id)?.role === 'measure').map(({ id, ord }) => ({ id, ord })),
            total: group.total ? { id: group.total.id, verified: group.total.verified } : null,
            period_totals: (group.period_totals || []).map(total => ({ id: total.id, verified: total.verified, period: total.period })) };
    }).filter(group => group.columns.length >= 3);
    const liveWide = new Set(wideGroups.map(group => group.id));
    for (const column of columns) {
        if (column.wide && !liveWide.has(column.wide)) delete column.wide;
    }

    const measures = columns.filter(column => column.role === 'measure');
    const tableRows = rowCount ?? profile.sample.table_rows ?? profile.sample.rows;
    const fineDate = columns.some(column => column.role === 'time' && !column.time.maintenance && column.time.kind !== 'year_number' &&
        (column.time.grain === 'day' || ((column.time.days || 0) >= 50 && column.time.days >= profile.sample.rows * 0.05)));
    const entity = columns.some(column => column.role === 'identifier' || column.role === 'row_number' || column.role === 'label');
    // Are the rows records (things or events, worth counting) or figures the
    // publisher already added up? An identifier, a name or a dated event says
    // records. Otherwise a quantity that adds up says figures; and with no
    // such quantity, a column whose every value heads the same number of rows
    // says figures too.
    const sums = measures.some(column => column.measure.additive === 'yes' || column.measure.additive === 'probable');
    const grid = columns.some(column => ['category', 'code', 'time', 'time_part'].includes(column.role) && balanced(byId.get(column.id)));
    // A table without a single quantity holds no figures to have been added
    // up. A table with periods as columns, or one whose rows are different
    // measures, holds figures whatever else it has: its rows are not counted.
    const blocked = measures.some(column => column.measure.blocked_by.length > 0);
    // Rows that hold a different measure each are cells of a table of figures;
    // amounts in a few currencies are still one amount per thing.
    const mixed = measures.some(column => column.measure.blocked_by.some(block => block.why === 'mixed_measures'));
    // A column whose every value splits the same population another way
    // ("Characteristic": Age, Sex, Region): the rows are cells of a table of
    // figures, whatever else the table has, and nothing adds up across that column.
    const partitioned = new Set();
    for (const partition of profile.groups.partitions || []) {
        const column = columnOf.get(partition.by);
        if (!column || !column.category || partitioned.has(column.id)) continue;
        partitioned.add(column.id);
        column.reasons.push({ code: 'repeated_partitions' });
        for (const measure of measures) {
            if (!measure.measure.blocked_by.some(entry => entry.column === column.id)) measure.measure.blocked_by.push({ column: column.id, why: 'breakdowns' });
        }
    }

    // A data dictionary describes another table's columns: nothing in it is counted or added up.
    const dictionary = tableRows <= DICTIONARY_MAX_ROWS && measures.filter(column => !column.generic_name).length <= 1 &&
        columns.some(column => nameEvidence(column.label).dictionaryField) && columns.some(column => nameEvidence(column.label).dictionaryDetail);
    const records = !dictionary && !wideGroups.length && !mixed && partitioned.size === 0 && (entity || fineDate || measures.length === 0 || (!sums && !grid));

    // In a table of figures, columns whose values are not one breakdown of the
    // rows: several kinds of breakdown at once ("Canada", "Men", "15 to 24
    // years"), the same population split again and again, or periods the axis
    // could not read. A sum across one of them adds the same people several
    // times, or adds up periods; the measure is read one value of it at a time.
    if (!records && !dictionary) {
        const block = (columnId, why) => {
            for (const measure of measures) {
                if (measure.measure.blocked_by.some(entry => entry.column === columnId)) continue;
                measure.measure.blocked_by.push({ column: columnId, why });
            }
        };
        for (const column of columns) {
            if (!column.category || !['category', 'label', 'code'].includes(column.role)) continue;
            const stat = byId.get(column.id);
            let read = stat.labels;
            if (!read) {
                read = { place: 0, sex: 0, age: 0, national: 0, province: 0, region: 0, others: 0 };
                for (const { v: value } of stat.top) {
                    if (value === '') continue;
                    const kind = labelKind(value);
                    if (kind) read[kind] += 1;
                    if (isNationalLabel(value)) read.national += 1;
                    else if (isProvinceName(value)) read.province += 1;
                    else if (isRegionLabel(value)) read.region += 1;
                    else if (!kind && !isTotalLabel(value)) read.others += 1;
                }
            }
            const kindCount = [read.place, read.sex, read.age].filter(count => count > 0).length;
            // Places at several levels at once: the country or a region of
            // provinces beside provinces, beside counties or cities.
            const nested = (read.national > 0 || read.region > 0) && read.province >= 2 && read.others >= 3;
            if ((kindCount >= 2 && read.place + read.sex + read.age >= 3) || nested) {
                column.reasons.push({ code: 'mixed_levels' });
                block(column.id, 'levels');
            } else if ((column.category.flags || []).includes('period_labels')) block(column.id, 'periods');
        }
    }
    const cubeBlocked = measures.some(column => column.measure.blocked_by.length > 0);

    let shape = 'statistics';
    if (dictionary) shape = 'dictionary';
    else if (wideGroups.length) shape = 'wide';
    else if (blocked || cubeBlocked) shape = 'long_measures';
    else if (records) shape = 'records';
    // "Total expenditures", "Ontario Total": in a table of figures, a member
    // named like a total is one.
    if (!records) {
        for (const column of columns) {
            if (!column.category || (column.role !== 'category' && column.role !== 'label')) continue;
            const labels = new Set(column.category.total_members);
            for (const entry of byId.get(column.id).top) if (isAggregateLabel(entry.v)) labels.add(entry.v.toLowerCase());
            column.category.total_members = [...labels].slice(0, 12);
        }
    }

    // Two columns under one name ("Total assets" twice) are told apart by
    // their order; the header as written stays for recognising its echoes.
    const seenLabels = new Map();
    for (const column of columns) {
        const key = column.label.toLowerCase();
        const count = (seenLabels.get(key) || 0) + 1;
        seenLabels.set(key, count);
        column.header = column.label;
        if (count > 1) column.label = column.label + ' (' + count + ')';
    }

    // A placeholder that several columns of the table share is the table's way of leaving a cell blank.
    const blankTokens = [...TABLE_BLANK_TOKENS].filter(token => stats.filter(stat => stat.missing.tokens[token] > 0).length >= 2);

    const findings = [];
    if (profile.rows.notes) findings.push({ code: 'notes_rows', count: profile.rows.notes });
    if (profile.rows.headers) findings.push({ code: 'header_rows', count: profile.rows.headers });
    if (profile.rows.unit_rows) findings.push({ code: 'unit_rows', count: profile.rows.unit_rows });
    if (profile.rows.total_rows) findings.push({ code: 'total_rows', count: profile.rows.total_rows });

    return {
        v: 1,
        shape,
        // Rows are records when counting them means something.
        records,
        rows: rowCount ?? profile.sample.table_rows ?? profile.sample.rows,
        sample: profile.sample,
        columns,
        time_axes: timeAxes,
        wide_groups: wideGroups,
        // Rows that are not data, by _id (at most 200): every chart leaves them out.
        excluded_rows: profile.rows.excluded.slice(0, 200).map(row => row.id),
        // Of those, rows that held something (notes, headers, units): empty rows are not news.
        excluded_notes: profile.rows.excluded.filter(row => row.reason !== 'blank').length,
        blank_tokens: blankTokens,
        findings
    };
}

/** The part of a model that clients need: roles, reasons and what each column can do. */
function publicModel(model, lang = 'en') {
    return {
        shape: model.shape,
        rows: model.rows,
        sample: { rows: model.sample.rows, complete: model.sample.complete },
        columns: model.columns.map(column => ({
            id: column.id, label: column.label, type: column.type, role: column.role, confidence: column.confidence, reasons: column.reasons,
            ...(column.measure ? { measure: { additive: column.measure.additive, text: column.measure.text, percent: column.measure.percent,
                blocked_by: column.measure.blocked_by.map(block => block.column) } } : {}),
            ...(column.category ? { category: { distinct: column.category.distinct, breakdown: column.category.breakdown } } : {}),
            ...(column.time ? { time: { kind: column.time.kind, grain: column.time.grain, grains: column.time.grains } } : {}),
            ...(column.twin ? { twin: { of: column.twin.of, hidden: hiddenTwin(column, lang) } } : {}),
            ...(column.wide ? { wide: column.wide } : {})
        })),
        time_axes: model.time_axes.map(axis => ({ id: axis.id, columns: axis.columns, grain: axis.grain, grains: axis.grains, composite: axis.composite })),
        wide_groups: model.wide_groups.map(group => ({ id: group.id, grain: group.grain, stem: group.stem || null, columns: group.columns.length, additive: group.additive })),
        findings: model.findings
    };
}

// A value column read for one measure at a time ("Data Point Label" =
// "Net income"): what that measure's name says decides whether it adds up.
/**
 * @param {object} model from buildTableModel()
 * @param {Array<{ column: string, value: unknown }>} pins equality filters on columns that block a measure
 */
function pinnedModel(model, pins) {
    if (!pins.length) return model;
    const held = new Map();
    for (const pin of pins) {
        held.set(pin.column, String(pin.value));
        const twin = model.columns.find(column => column.id === pin.column)?.twin;
        if (twin) held.set(twin.of, String(pin.value));
    }
    let changed = false;
    const columns = model.columns.map(column => {
        if (column.role !== 'measure') return column;
        const block = column.measure.blocked_by.find(entry => entry.why === 'mixed_measures' && held.has(entry.column));
        if (!block) return column;
        const name = nameEvidence(held.get(block.column));
        const additive = name.nonAdditive ? 'no' : name.additive ? 'yes' : column.measure.additive;
        if (additive === column.measure.additive) return column;
        changed = true;
        return { ...column, measure: { ...column.measure, additive, reason: 'pinned_measure_name' } };
    });
    return changed ? { ...model, columns } : model;
}

/** Is this column the side of a twin pair that a reader in `lang` does not need? */
function hiddenTwin(column, lang) {
    if (!column.twin) return false;
    if (column.twin.lang) return column.twin.lang !== (lang === 'fr' ? 'fr' : 'en');
    return column.twin.hidden === true;
}

module.exports = { buildTableModel, publicModel, hiddenTwin, pinnedModel, numberReading, numericLike, AUTO_CATEGORY_MAX, CATEGORY_MAX, NUMERIC_LABELS_MAX, DAY_MS };
