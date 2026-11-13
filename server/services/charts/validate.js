// From computed groups to a chart, or to a reason not to draw one. Every
// number here comes from the whole table (the batch statement); this module
// only cleans the points, checks them and says what was left out.
//
// Two kinds of checks. Integrity checks always apply: a chart that fails one
// would mislead. Selection checks (gates) apply when charts are being chosen
// for a table; while a visitor searches or filters, the chosen charts stay and
// only integrity is checked, so charts do not come and go with every keystroke.
const { cleanLabel, isBlankLabel, isTotalLabel, isAggregateLabel, isFootnoteLabel, isMarkedNote, hasAggregateHint, isProvinceName, isNationalLabel, isRegionLabel,
    NUMERIC_LABEL_RE, CATEGORY_LABEL_LIMIT, codeLabels, isGarbled, nameEvidence } = require('./tokens');
const { parsePeriod, parsePart, periodStart, ordinalOfStart, toGrain } = require('./periods');

// The fewest points a chart may have on the Chart tab, and on a card or a post.
const MIN_POINTS = { bars: 2, line: 4 };
const CARD_POINTS = { bars: 3, line: 6 };
const DONUT_MAX = 6;
const CODE_PREFIX_RE = /^[A-Z0-9][A-Z0-9.]{0,9}\s*[-–—:]\s*(?=\p{L})/u;
const TOTAL_TOLERANCE = 0.005;
// Below this, small whole numbers add up to each other by chance.
const EXACT_MIN = 200;
const SEPARATOR = String.fromCharCode(31);
// The most groups a chart labelled with bare numbers may have (as in model.js).
const NUMERIC_LABELS_MAX = 12;
const DATE_LABEL_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:$|[T ])/;
const LINK_RE = /^(?:https?:\/\/|www\.)|^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// How far "Canada" may exceed the provinces listed beside it and still be
// their total: suppressed cells make a total larger than its visible parts.
const NATIONAL_RANGE = [0.95, 1.6];
// One group this large says nothing as a comparison.
const DOMINANT_SHARE = 0.95;
// One period with this share of the records: a bulk load date, not a history.
const DOMINANT_PERIOD = 0.8;
// A first or last period with this little of the typical period's rows is
// one the table barely covers.
const SPARSE_EDGE = 0.2;
const EDGE_MAX = 3;

// Labels that differ only by accents or case name one group: "Québec" and "Quebec".
const plainKey = label => String(label).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function addMeasures(into, more) {
    into.forEach((measure, i) => {
        const other = more[i];
        measure.sum = measure.sum === null && other.sum === null ? null : (measure.sum || 0) + (other.sum || 0);
        measure.n += other.n;
        measure.blank += other.blank;
        measure.missing += other.missing;
        measure.other = (measure.other || 0) + (other.other || 0);
        if (other.max !== null && (measure.max === null || other.max > measure.max)) measure.max = other.max;
        if (other.min !== null && (measure.min === null || other.min < measure.min)) measure.min = other.min;
    });
}

// One group per label once accents are set aside; the spelling with the most rows names it.
function mergeSpellings(groups) {
    const merged = new Map();
    let folded = 0;
    for (const group of groups) {
        const key = group.n === 0 ? SEPARATOR + group.key : plainKey(cleanLabel(group.label));
        const seen = merged.get(key);
        if (!seen) {
            merged.set(key, { ...group, measures: group.measures.map(measure => ({ ...measure })), most: group.n });
            continue;
        }
        folded += 1;
        if (group.n > seen.most) {
            seen.most = group.n;
            seen.label = group.label;
            seen.key = group.key;
        }
        seen.n += group.n;
        seen.nx += group.nx;
        seen.spellings += group.spellings;
        addMeasures(seen.measures, group.measures);
    }
    return { groups: [...merged.values()], folded };
}

const reject = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const additive = agg => agg === 'count' || agg === 'sum';
const sums = column => column.measure.additive === 'yes' || column.measure.additive === 'probable';

function valueOf(group, agg, j) {
    if (agg === 'count') return group.n;
    const measure = group.measures[j];
    if (!measure || measure.n === 0) return null;
    if (agg === 'sum') return measure.sum;
    if (agg === 'avg') return measure.sum / measure.n;
    return agg === 'max' ? measure.max : measure.min;
}

// What the whole table says about a measure: how many cells are numbers,
// placeholders, blank or unreadable. Exact, from the grand-total row.
function measureCounters(grand, j) {
    const measure = grand.measures[j];
    const other = measure.other || 0;
    const unreadable = Math.max(0, grand.n - measure.n - measure.blank - measure.missing - other);
    return { parsed: measure.n, missing: measure.missing, blank: measure.blank, other, unreadable, rows: grand.n };
}

function measureProblem(counters) {
    if (counters.parsed === 0) return 'no_numbers';
    if (counters.unreadable > 2 && counters.unreadable / (counters.parsed + counters.unreadable) > 0.03) return 'unreadable_values';
    if (counters.parsed / Math.max(1, counters.rows - counters.blank - counters.other) < 0.05) return 'mostly_suppressed';
    return null;
}

function measureNotes(notes, column, counters) {
    if (counters.missing > 0) {
        notes.push({ code: 'placeholders_left_out', level: counters.missing / counters.rows >= 0.05 ? 'caution' : 'info', column: column.id,
            cells: counters.missing, share: counters.missing / counters.rows, tokens: column.measure.clean ? column.measure.clean.missing.slice(0, 6) : [] });
    }
    if (counters.unreadable > 0) notes.push({ code: 'unreadable_left_out', level: 'info', column: column.id, cells: counters.unreadable });
    if (counters.blank > 0 && counters.blank / counters.rows >= 0.01) notes.push({ code: 'blank_cells_left_out', level: 'info', column: column.id, cells: counters.blank });
    if (column.measure.ambiguous) notes.push({ code: 'number_format_assumed', level: 'caution', column: column.id, format: column.measure.clean.core });
    if (column.measure.text) notes.push({ code: 'numbers_read_from_text', level: 'info', column: column.id });
    if (column.measure.only) {
        notes.push({ code: 'one_unit_only', level: counters.other > 0 ? 'caution' : 'info', column: column.id, by: column.measure.only.column,
            kept: column.measure.only.value, rows: counters.other });
    }
}

function yOf(spec, column, counters) {
    if (!column) return { agg: 'count', column: null, label: null, additive: 'yes', integer: true, lower_bound: false, unit: null, percent: false, currency: false };
    return { agg: spec.y.agg, column: column.id, label: column.label, additive: column.measure.additive, integer: column.measure.integer && spec.y.agg !== 'avg',
        // A sum that leaves placeholder cells out is a floor, not the figure.
        lower_bound: spec.y.agg === 'sum' && counters.missing > 0, unit: column.measure.unit || (column.measure.only ? column.measure.only.value : null),
        percent: column.measure.percent, currency: column.measure.currency };
}

function flat(values, counting) {
    if (new Set(values).size < 2) return true;
    if (!counting || values.length < 4) return false;
    const max = Math.max(...values);
    return max > 0 && (max - Math.min(...values)) / max < 0.02;
}

// Which surfaces a chart suits. The tab takes every chart that passed; a
// homepage card or a post needs more points, real column names, and no chart
// that ranks individually named rows.
function fitOf(spec, chart, gates) {
    if (!gates) return { tab: true, card: false, social: false };
    const enough = chart.points.length >= (chart.x.type === 'time' ? CARD_POINTS.line : CARD_POINTS.bars);
    const strict = enough && !spec.generic && !spec.row_labels;
    return { tab: true, card: strict, social: strict };
}

/**
 * Members of a category that add the other members up, found by their name
 * or by their value. Every chart of the table must leave their rows out, or
 * each figure would be counted twice.
 *
 * By value, a coincidence must be ruled out: the member's sum has to equal
 * the sum of all others exactly, or within half a percent when its name
 * suggests an aggregate ("Both sexes", "All ages"), or roughly when it is
 * "Canada" among the provinces (suppressed cells make such totals larger
 * than their visible parts).
 *
 * @param {object[]} groups the set's rows; the largest by sum must be among them
 * @param {object} grand the grand-total row
 * @param {number | null} j the measure to compare by, or null to go by names only
 * @param {{ records?: boolean, blankTokens?: Set<string> }} [table] records: rows are things or events, not figures
 * @returns {{ totals: Array<{ key: string, label: string, by: 'name' | 'sum_of_others' }>, levels: boolean }}
 */
function detectTotalMembers(groups, grand, j, { records = false, blankTokens } = {}) {
    const totals = [];
    const members = [];
    let blank = 0;
    for (const group of groups) {
        if (group.n === 0) continue;
        const label = cleanLabel(group.label);
        const sum = j === null ? null : group.measures[j].sum;
        if (isBlankLabel(label, blankTokens)) {
            blank += sum || 0;
            continue;
        }
        if (isTotalLabel(label) || (!records && isAggregateLabel(label))) totals.push({ key: group.key, label, by: 'name' });
        else if (sum !== null && group.measures[j].n > 0) members.push({ key: group.key, label, sum });
    }
    if (totals.length || j === null || members.length < 3) return { totals, levels: false };
    // "Canada" beside the provinces is their total, and "Atlantic" or
    // "Prairies" beside both are subtotals of the same figures.
    const provinces = members.filter(member => isProvinceName(member.label));
    const national = members.find(member => isNationalLabel(member.label));
    // In a table of events "Canada" can be a place like any other, so there
    // it takes more provinces beside it; everywhere a total is the largest member.
    if (national && provinces.length >= (records ? 5 : 3) && national.sum > 0 && members.every(member => member.sum <= national.sum)) {
        const ratio = national.sum / provinces.reduce((sum, member) => sum + member.sum, 0);
        if (ratio >= NATIONAL_RANGE[0] && ratio <= NATIONAL_RANGE[1]) {
            return { totals: members.filter(member => member === national || (isRegionLabel(member.label) && member.sum <= national.sum))
                .map(member => ({ key: member.key, label: member.label, by: 'sum_of_others' })), levels: false };
        }
    }
    const whole = grand.measures[j].sum - blank;
    const top = members.reduce((best, member) => (member.sum > best.sum ? member : best));
    const rest = whole - top.sum;
    if (!(top.sum > 0) || !(rest > 0)) return { totals, levels: false };
    const gap = Math.abs(top.sum - rest) / top.sum;
    const hinted = hasAggregateHint(top.label);
    const exact = gap <= 1e-9 && top.sum >= EXACT_MIN;
    if (exact || (hinted && gap <= TOTAL_TOLERANCE)) return { totals: [{ key: top.key, label: top.label, by: 'sum_of_others' }], levels: false };
    // A total, subtotals and their parts in one column: the same figure three times over.
    const third = Math.abs(top.sum - rest / 2) / top.sum;
    return { totals, levels: (third <= 1e-9 && top.sum >= EXACT_MIN) || (hinted && third <= TOTAL_TOLERANCE) };
}

/**
 * A chart of groups: shares, rankings and averages by category.
 * @param {object} spec the candidate
 * @param {object[]} groups the set's rows from the batch
 * @param {object} grand the grand-total row
 * @param {{ column: object, measure: object | null, j: number | null, filtered?: boolean, gates?: boolean, blankTokens?: Set<string>,
 *   records?: boolean }} context records: the table's rows are things or events, not figures
 */
function shapeCategory(spec, rows, grand, { column, measure, j, filtered = false, gates = true, blankTokens, records = false }) {
    const { groups, folded } = mergeSpellings(rows);
    const agg = spec.y.agg;
    const notes = [];
    const counters = measure ? measureCounters(grand, j) : null;
    if (measure) {
        const problem = measureProblem(counters);
        if (problem) return reject(problem);
    }
    const names = [column.id.toLowerCase(), (column.header || column.label).toLowerCase()];
    const counting = additive(agg);
    // A ranking names rows: rows without a name are not one of them.
    const ranking = spec.template === 'top_labels_by_measure';
    let points = [];
    let blank = null;
    let noteRows = 0;
    let headerRows = 0;
    let merged = folded > 0;
    let droppedGroups = folded;
    let unresolved = 0;
    const namedTotals = [];
    for (const group of groups) {
        const label = cleanLabel(group.label);
        // Every row of this group was a total row: the group is a total.
        if (group.n === 0) {
            if (group.nx > 0) namedTotals.push(label);
            droppedGroups += 1;
            continue;
        }
        if (isBlankLabel(label, blankTokens)) {
            if (blank) {
                blank.n += group.n;
                addMeasures(blank.measures, group.measures);
            } else blank = { n: group.n, measures: group.measures.map(entry => ({ ...entry })) };
            droppedGroups += 1;
            continue;
        }
        if (isTotalLabel(label) || (!records && isAggregateLabel(label))) {
            // A total the batch did not set aside: left out here, and out of what the shares are of.
            namedTotals.push(label);
            unresolved += valueOf(group, agg, j) || 0;
            droppedGroups += 1;
            continue;
        }
        // A long label is data here: notes under a table were set aside with their rows.
        if (isFootnoteLabel(label) || (isMarkedNote(label) && group.n <= 1 && label.length > 30)) {
            noteRows += group.n;
            droppedGroups += 1;
            continue;
        }
        if (names.includes(label.toLowerCase())) {
            headerRows += group.n;
            droppedGroups += 1;
            continue;
        }
        const value = valueOf(group, agg, j);
        if (value === null || !Number.isFinite(value)) {
            droppedGroups += 1;
            continue;
        }
        if (group.spellings > 1) merged = true;
        points.push({ key: group.key, label, value, rows: group.n });
    }
    // A measure with figures below zero (cuts beside increases): the groups
    // largest either way are the ones shown, drawn in order of their value.
    const signed = Boolean(measure && grand.measures[j] && grand.measures[j].min !== null && grand.measures[j].min < 0);
    points.sort(signed ? (a, b) => Math.abs(b.value) - Math.abs(a.value) || (a.label < b.label ? -1 : 1)
        : (a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));

    const whole = agg === 'count' ? grand.n : measure ? grand.measures[j].sum : null;
    const total = counting && whole !== null ? whole - unresolved : null;
    const setGroups = rows.length ? rows[0].groups : 0;
    const groupsTotal = Math.max(points.length, setGroups - droppedGroups);
    // Two or three groups more than the limit are shown rather than lumped together.
    const limit = spec.limit || 12;
    const shown = points.slice(0, groupsTotal <= limit + 3 && spec.kind !== 'donut' ? groupsTotal : limit);
    if (signed) shown.sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));

    // "6322 - Cooks" reads "Cooks", unless two codes share a wording.
    let stripped = false;
    if (column.category && column.category.strip_code_prefix) {
        const short = shown.map(point => point.label.replace(CODE_PREFIX_RE, ''));
        if (short.every(Boolean) && new Set(short.map(label => label.toLowerCase())).size === short.length) {
            shown.forEach((point, i) => {
                if (short[i] !== point.label) stripped = true;
                point.label = short[i];
            });
        }
    }
    if (new Set(shown.map(point => point.label.toLowerCase())).size !== shown.length) return reject('duplicate_labels');

    let blankPoint = null;
    let wholeLeft = total;
    if (blank && counting) {
        const blankValue = valueOf(blank, agg, j) || 0;
        const namedSum = points.reduce((sum, point) => sum + point.value, 0);
        if (blankValue > 0 && agg === 'sum' && points.length >= 2 && points.length === groupsTotal &&
            Math.abs(blankValue - namedSum) <= Math.max(1e-9, Math.abs(namedSum) * TOTAL_TOLERANCE)) {
            // The unnamed row is the total of the named ones ("Total" written in another column).
            namedTotals.push('');
            wholeLeft = total === null ? null : total - blankValue;
        } else if (blankValue > 0 && ranking) {
            notes.push({ code: 'unnamed_rows_left_out', level: 'info', column: column.id, rows: blank.n });
            wholeLeft = total === null ? null : total - blankValue;
        } else if (blankValue > 0) {
            if (gates && total > 0 && blankValue / total > 0.5) return reject('mostly_blank');
            blankPoint = { key: null, label: null, blank: true, value: blankValue, rows: blank.n };
            notes.push({ code: 'not_recorded_group', level: 'info', column: column.id, rows: blank.n });
        }
    }

    if (shown.length === 0) return reject('no_groups');
    if (gates) {
        if (shown.length < MIN_POINTS.bars) return reject('too_few_groups');
        if (flat(shown.map(point => point.value), agg === 'count')) return reject('flat');
        if (agg === 'count' && grand.n > 0 && groupsTotal / grand.n >= 0.5) return reject('id_like');
        // Bare numbers say little as labels: a few of a known code at most.
        if (shown.filter(point => NUMERIC_LABEL_RE.test(point.label)).length >= shown.length * 0.5 &&
            (column.role !== 'code' || groupsTotal > NUMERIC_LABELS_MAX)) return reject('numeric_labels');
        if (shown.filter(point => LINK_RE.test(point.label)).length >= shown.length * 0.3) return reject('link_labels');
        if (shown.filter(point => point.label.length > CATEGORY_LABEL_LIMIT).length >= shown.length * 0.5) return reject('long_labels');
        // Dates that were not read as a time axis make a poor set of groups.
        if (shown.filter(point => DATE_LABEL_RE.test(point.label)).length >= shown.length * 0.5) return reject('date_labels');
        if (counting && !signed && total > 0 && shown[0].value / total >= 0.98) return reject('one_group');
        // Codes without a legend ("U", "ESSF", "*GD"), and text decoded wrongly, cannot be read.
        // (Bare numbers are judged above.)
        const worded = shown.map(point => point.label).filter(label => !NUMERIC_LABEL_RE.test(label));
        if (worded.length && codeLabels(worded, { sex: nameEvidence(column.header || column.label).sex })) return reject('code_labels');
        if (shown.some(point => isGarbled(point.label))) return reject('garbled_labels');
        // One group with nearly everything ("Incluses" on 480 of 501 lines) is no comparison.
        if (counting && !signed && wholeLeft > 0 && shown.every(point => point.value >= 0) && shown[0].value / wholeLeft >= DOMINANT_SHARE) return reject('one_group');
    }

    // Shares mean something only when every part is a part of the whole: no
    // part below zero, shown or not.
    const parts = counting && wholeLeft > 0 && !signed && shown.every(point => point.value >= 0);
    if (parts) for (const point of shown) point.share = point.value / wholeLeft;
    if (parts && blankPoint) blankPoint.share = blankPoint.value / wholeLeft;
    const shownSum = shown.reduce((sum, point) => sum + point.value, 0) + (blankPoint ? blankPoint.value : 0);
    const otherGroups = groupsTotal - shown.length;
    // What the other groups come to, as it is: below zero when they are cuts.
    const other = counting && wholeLeft !== null && otherGroups > 0 ? { groups: otherGroups, value: wholeLeft - shownSum } : null;
    const complete = otherGroups <= 0;
    points = blankPoint ? [...shown, blankPoint] : shown;
    const donut = spec.kind === 'donut' && parts && complete && points.length <= DONUT_MAX;

    if (measure) measureNotes(notes, measure, counters);
    if (namedTotals.length || grand.nx > 0) notes.push({ code: 'total_left_out', level: 'info', labels: [...new Set(namedTotals.filter(Boolean))].slice(0, 4), rows: grand.nx });
    if (noteRows > 0) notes.push({ code: 'notes_rows_left_out', level: 'info', rows: noteRows });
    if (headerRows > 0) notes.push({ code: 'header_rows_left_out', level: 'info', rows: headerRows });
    if (merged) notes.push({ code: 'variants_merged', level: 'info', column: column.id });
    if (stripped) notes.push({ code: 'code_prefix_hidden', level: 'info', column: column.id });
    if (!complete) notes.push({ code: 'limited_groups', level: 'info', shown: shown.length, total: groupsTotal });
    if (agg === 'avg') notes.push({ code: 'unweighted_average', level: 'info', column: measure.id });
    if (agg === 'sum' && !sums(measure)) notes.push({ code: 'sum_of_non_additive', level: 'caution', column: measure.id });
    if (filtered) notes.push({ code: 'filtered_scope', level: 'info', rows: grand.n });

    // A chart whose largest group is "Not recorded" says less: it ranks lower
    // and stays off cards and posts.
    const blankShare = blankPoint && total > 0 ? blankPoint.value / total : 0;
    const blankLeads = Boolean(blankPoint) && blankPoint.value >= shown[0].value;
    const chart = {
        id: spec.id, template: spec.template, kind: donut ? 'donut' : 'bars',
        x: { type: 'category', column: column.id, label: column.label },
        y: yOf(spec, measure, counters),
        points, other, total: parts ? wholeLeft : null,
        scope: { rows: grand.n, groups_total: groupsTotal, groups_shown: shown.length, complete, filtered },
        notes, score: spec.score - (blankLeads ? 14 : blankShare >= 0.25 ? 6 : 0)
    };
    chart.fit = fitOf(spec, chart, gates);
    if (blankLeads) chart.fit = { ...chart.fit, card: false, social: false };
    return { ok: true, chart };
}

// The period a group's key names on an axis, at the grain it was grouped at.
function periodOfKey(key, axis, columns) {
    if (axis.kind === 'composite') {
        const [yearText, partText] = String(key).split(SEPARATOR);
        const year = /^([0-9]{4})(?:\.0+)?$/.exec((yearText || '').trim());
        const part = parsePart(partText, axis.grain === 'month' ? 'month' : 'quarter');
        if (!year || part === null) return null;
        return axis.grain === 'month' ? { grain: 'month', ord: 12 * Number(year[1]) + part - 1 } : { grain: 'quarter', ord: 4 * Number(year[1]) + part - 1 };
    }
    const time = columns[0].time;
    // Dates are bucketed in SQL: the key is the first day of its period.
    if (time.kind === 'typed' || time.format === 'iso_date' || time.format === 'day_month_year') {
        const ord = ordinalOfStart(axis.bucket, key);
        return ord === null ? null : { grain: axis.bucket, ord };
    }
    if (time.kind === 'year_number') {
        const year = /^([0-9]{4})(?:\.0+)?$/.exec(String(key).trim());
        return year ? { grain: 'year', ord: Number(year[1]) } : null;
    }
    return parsePeriod(key, { format: time.format, order: time.order });
}

/**
 * A chart over time.
 * @param {{ axis: object, columns: object[], measure: object | null, j: number | null, ordered?: boolean, filtered?: boolean, gates?: boolean }} context
 *   axis.bucket is the grain SQL bucketed dates at; ordered says the set holds the latest periods (keys sort in SQL)
 */
const middle = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[at] : (sorted[at - 1] + sorted[at]) / 2;
};

// Is the period that holds `now` this one: begun and not over?
function inProgress(ord, grain, now) {
    const start = Date.parse(periodStart(grain, ord) + 'T00:00:00Z');
    const end = Date.parse(periodStart(grain, ord + 1) + 'T00:00:00Z');
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}

/**
 * The periods a table covers well, oldest first. A first or last period with
 * a fifth of a typical period's rows is one the table barely covers ("2016:
 * 625 contracts" beside 190,000 a year). A last period still in progress is
 * left out whatever its rows: its records keep coming, and its figures are
 * the year so far (a "2026" of eight months, on one row per year).
 * @param {Array<{ ord: number, n: number }>} list periods in order
 */
function coveredPeriods(list, { grain, now = Date.now() }) {
    if (list.length < 4) return { kept: list, sparse: [], partial: null };
    const typical = middle(list.map(entry => entry.n));
    let first = 0;
    let last = list.length - 1;
    const sparse = [];
    while (first < last - 2 && first < EDGE_MAX && list[first].n < typical * SPARSE_EDGE) sparse.push(list[first++]);
    for (let dropped = 0; last > first + 2 && dropped < EDGE_MAX && list[last].n < typical * SPARSE_EDGE; dropped += 1) sparse.push(list[last--]);
    let partial = null;
    if (last > first + 2 && inProgress(list[last].ord, grain, now)) partial = list[last--];
    return { kept: list.slice(first, last + 1), sparse, partial };
}

// The periods of a time set: for each, its rows, its groups' keys as the
// batch grouped them, and what the groups add up to.
function periodsOf(groups, { axis, columns, grain }) {
    const periods = new Map();
    for (const group of groups) {
        if (group.n === 0 || group.key === '' || group.key === SEPARATOR) continue;
        const period = periodOfKey(group.key, axis, columns);
        const ord = period ? toGrain(period, grain) : null;
        if (ord === null) continue;
        const seen = periods.get(ord);
        if (!seen) periods.set(ord, { ord, n: group.n, keys: [group.key], measures: group.measures.map(m => ({ ...m })) });
        else {
            seen.n += group.n;
            seen.keys.push(group.key);
            addMeasures(seen.measures, group.measures);
        }
    }
    return [...periods.values()].sort((a, b) => a.ord - b.ord);
}

/**
 * The latest period a table covers well in which a measure has figures, with
 * the keys that name it in the batch, or null. Months and quarters are
 * compared over the latest year they fill (twelve months, four quarters) that
 * is over: a single month is noisy, and suppressed cells empty it; a year in
 * progress is not one. Without such a year, the latest well-covered period.
 * @param {{ axis: object, columns: object[], grain: string, j: number | null, now?: number }} context
 */
function latestPeriod(groups, { axis, columns, grain, j, now = Date.now() }) {
    const list = periodsOf(groups, { axis, columns, grain }).filter(entry => j === null || (entry.measures[j] && entry.measures[j].n > 0));
    if (!list.length) return null;
    if (grain !== 'year' && grain !== 'fiscal_year') {
        const years = new Map();
        for (const entry of list) {
            const year = Number(periodStart(grain, entry.ord).slice(0, 4));
            const seen = years.get(year) || { year, periods: 0, keys: [], n: 0 };
            seen.periods += 1;
            seen.keys.push(...entry.keys);
            seen.n += entry.n;
            years.set(year, seen);
        }
        const filled = Math.max(...[...years.values()].map(entry => entry.periods));
        const full = [...years.values()].filter(entry => entry.periods === filled && entry.periods > 1 && Date.UTC(entry.year + 1, 0, 1) <= now)
            .sort((a, b) => b.year - a.year)[0];
        if (full) return { start: full.year + '-01-01', grain: 'year', keys: full.keys, rows: full.n };
    }
    const { kept } = coveredPeriods(list, { grain, now });
    const latest = kept[kept.length - 1];
    return latest ? { start: periodStart(grain, latest.ord), grain, keys: latest.keys, rows: latest.n } : null;
}

/**
 * The first and last periods of a table's records, every one of them (the
 * groups of a chart count them all), or null when the axis dates fewer than
 * half of the rows.
 */
function periodRange(groups, { axis, columns, grain, rows }) {
    const list = periodsOf(groups, { axis, columns, grain });
    const dated = list.reduce((sum, entry) => sum + entry.n, 0);
    if (!list.length || (rows > 0 && dated < rows * 0.5)) return null;
    return { grain, first: periodStart(grain, list[0].ord), last: periodStart(grain, list[list.length - 1].ord) };
}

function shapeTime(spec, groups, grand, { axis, columns, measure, j, ordered = false, filtered = false, gates = true, now = Date.now() }) {
    const agg = spec.y.agg;
    const grain = spec.x.grain;
    const notes = [];
    const counters = measure ? measureCounters(grand, j) : null;
    if (measure) {
        const problem = measureProblem(counters);
        if (problem) return reject(problem);
    }
    const setGroups = groups.length ? groups[0].groups : 0;
    const unseen = Math.max(0, setGroups - groups.length);
    // Periods written as text sort only once they are read: all of them are needed.
    if (unseen > 0 && !ordered) return reject('too_many_periods');

    const periods = new Map();
    let unread = 0;
    let undated = 0;
    for (const group of groups) {
        if (group.n === 0) continue;
        if (group.key === '' || group.key === SEPARATOR) {
            undated += group.n;
            continue;
        }
        const period = periodOfKey(group.key, axis, columns);
        const ord = period ? toGrain(period, grain) : null;
        if (ord === null) {
            unread += group.n;
            continue;
        }
        const seen = periods.get(ord);
        if (!seen) periods.set(ord, { n: group.n, measures: group.measures.map(m => ({ ...m })) });
        else {
            seen.n += group.n;
            addMeasures(seen.measures, group.measures);
        }
    }
    // Rows whose period cannot be read are few, or the axis is not one.
    if (unread > 2 && grand.n > 0 && unread / grand.n > 0.02) return reject('periods_unreadable');
    if (gates && grand.n > 0 && undated / grand.n > 0.5) return reject('mostly_undated');

    const all = [...periods.keys()].sort((a, b) => a - b);
    // Edges the table barely covers, and a period still in progress, are left out.
    const covered = coveredPeriods(all.map(ord => ({ ord, n: periods.get(ord).n })), { grain, now });
    const ords = covered.kept.map(entry => entry.ord);
    const window = ords.slice(-(spec.limit || 60));
    const points = [];
    const missing = [];
    for (const ord of window) {
        const value = valueOf(periods.get(ord), agg, j);
        const start = periodStart(grain, ord);
        if (value === null || !Number.isFinite(value)) missing.push(start);
        else points.push({ key: String(ord), start, value, rows: periods.get(ord).n });
    }
    if (points.length === 0) return reject('no_periods');
    if (gates) {
        if (points.length < MIN_POINTS.bars) return reject('too_few_periods');
        if (flat(points.map(point => point.value), agg === 'count')) return reject('flat');
        // Nearly every record on one date: a bulk load or publication date, not a history.
        if (agg === 'count' && grand.n > 0 && Math.max(...points.map(point => point.rows)) / grand.n >= DOMINANT_PERIOD) return reject('one_period');
        // A sum over time whose suppressed cells come and go: where a quarter
        // of a period's cells are suppressed and hardly any of another's, the
        // line's rises and falls are partly the suppression's.
        if (agg === 'sum' && counters && counters.missing > 0) {
            const shares = window.map(ord => periods.get(ord)).filter(period => period && period.n > 0 && period.measures[j] && period.measures[j].n > 0)
                .map(period => period.measures[j].missing / period.n);
            if (shares.length >= 2 && Math.max(...shares) - Math.min(...shares) > 0.25) return reject('suppressed_trend');
        }
        // Rows per period that only differ in the first and last, partial,
        // periods: the table has one row per month or per place, nothing to count.
        const inner = points.slice(1, -1).map(point => point.value);
        if (agg === 'count' && inner.length >= 2 && Math.max(...inner) > 0 && (Math.max(...inner) - Math.min(...inner)) / Math.max(...inner) < 0.02) return reject('flat');
    }

    const periodsTotal = ords.length + unseen;
    if (measure) measureNotes(notes, measure, counters);
    if (grand.nx > 0) notes.push({ code: 'total_left_out', level: 'info', labels: [], rows: grand.nx });
    if (periodsTotal > window.length) notes.push({ code: 'latest_periods', level: 'info', shown: window.length, total: periodsTotal });
    if (covered.sparse.length) {
        notes.push({ code: 'sparse_periods_left_out', level: 'info', periods: covered.sparse.length,
            rows: covered.sparse.reduce((sum, entry) => sum + entry.n, 0) });
    }
    if (covered.partial) notes.push({ code: 'partial_period_left_out', level: 'info', start: periodStart(grain, covered.partial.ord), grain, rows: covered.partial.n });
    if (missing.length) notes.push({ code: 'missing_periods', level: 'info', periods: missing.length });
    if (unread > 0) notes.push({ code: 'periods_unreadable', level: 'info', rows: unread });
    if (undated > 0) notes.push({ code: 'rows_without_period', level: undated / grand.n >= 0.05 ? 'caution' : 'info', rows: undated });
    if (grain === 'fiscal_year') notes.push({ code: 'fiscal_year_start', level: 'info' });
    if (axis.kind === 'composite') notes.push({ code: 'composite_time', level: 'info', columns: axis.columns });
    if (agg === 'avg' && !spec.single) notes.push({ code: 'unweighted_average', level: 'info', column: measure.id });
    if (agg === 'sum' && !sums(measure)) notes.push({ code: 'sum_of_non_additive', level: 'caution', column: measure.id });
    if (filtered) notes.push({ code: 'filtered_scope', level: 'info', rows: grand.n });

    const chart = {
        id: spec.id, template: spec.template,
        // Two or three periods are bars in time order: a line would suggest a trend.
        kind: points.length >= MIN_POINTS.line ? 'line' : 'bars',
        x: { type: 'time', axis: axis.id, columns: axis.columns, label: columns.map(column => column.label).join(' + '), grain },
        y: yOf(spec, measure, counters),
        points, other: null, total: null,
        time: { grain, first: points[0].start, last: points[points.length - 1].start, periods_total: periodsTotal, periods_shown: window.length, missing },
        scope: { rows: grand.n, groups_total: periodsTotal, groups_shown: points.length, complete: periodsTotal <= window.length, filtered },
        notes, score: spec.score, single: spec.single === true
    };
    chart.fit = fitOf(spec, chart, gates);
    return { ok: true, chart };
}

/**
 * The period columns of a wide table as one series: each column's total (or
 * average) over the rows.
 * @param {{ group: object, columns: object[], indexes: number[], filtered?: boolean, gates?: boolean }} context
 *   columns and indexes are the group's period columns that were computed, oldest first
 */
function shapeWide(spec, grand, { group, columns, indexes, filtered = false, gates = true }) {
    const agg = spec.y.agg;
    const notes = [];
    const points = [];
    const missing = [];
    let placeholders = 0;
    let unreadable = 0;
    let parsed = 0;
    const tokens = new Set();
    const ordOf = new Map(group.columns.map(entry => [entry.id, entry.ord]));
    const suppressed = [];
    columns.forEach((column, i) => {
        const counters = measureCounters(grand, indexes[i]);
        placeholders += counters.missing;
        // A period with no figure at all is a gap, not a swing in suppression.
        if (counters.rows > 0 && counters.parsed > 0) suppressed.push(counters.missing / counters.rows);
        unreadable += counters.unreadable;
        parsed += counters.parsed;
        if (column.measure.clean) for (const token of column.measure.clean.missing) tokens.add(token);
        const measure = grand.measures[indexes[i]];
        const value = measure.n === 0 ? null : agg === 'sum' ? measure.sum : measure.sum / measure.n;
        const ord = ordOf.get(column.id);
        const start = periodStart(group.grain, ord);
        if (value === null || !Number.isFinite(value)) missing.push(start);
        else points.push({ key: String(ord), start, value, rows: measure.n, column: column.id });
    });
    if (points.length === 0) return reject('no_periods');
    if (unreadable > 2 && unreadable / (parsed + unreadable) > 0.03) return reject('unreadable_values');
    if (gates) {
        if (points.length < MIN_POINTS.bars) return reject('too_few_periods');
        if (flat(points.map(point => point.value), false)) return reject('flat');
        // Suppressed cells that come and go between periods make the line's rises and falls theirs.
        if (agg === 'sum' && placeholders > 0 && suppressed.length >= 2 && Math.max(...suppressed) - Math.min(...suppressed) > 0.25) return reject('suppressed_trend');
    }

    const total = group.columns.length;
    const cells = grand.n * columns.length;
    if (placeholders > 0) notes.push({ code: 'placeholders_left_out', level: cells > 0 && placeholders / cells >= 0.05 ? 'caution' : 'info', column: null,
        cells: placeholders, share: cells > 0 ? placeholders / cells : 0, tokens: [...tokens].slice(0, 6) });
    if (unreadable > 0) notes.push({ code: 'unreadable_left_out', level: 'info', column: null, cells: unreadable });
    if (grand.nx > 0) notes.push({ code: 'total_left_out', level: 'info', labels: [], rows: grand.nx });
    notes.push({ code: 'wide_periods', level: 'info', columns: columns.length });
    if (total > columns.length) notes.push({ code: 'latest_periods', level: 'info', shown: columns.length, total });
    if (missing.length) notes.push({ code: 'missing_periods', level: 'info', periods: missing.length });
    if (group.grain === 'fiscal_year') notes.push({ code: 'fiscal_year_start', level: 'info' });
    if (agg === 'avg') notes.push({ code: 'unweighted_average', level: 'info', column: null });
    if (filtered) notes.push({ code: 'filtered_scope', level: 'info', rows: grand.n });

    const chart = {
        id: spec.id, template: spec.template, kind: points.length >= MIN_POINTS.line ? 'line' : 'bars',
        x: { type: 'time', wide: group.id, columns: columns.map(column => column.id), label: null, grain: group.grain },
        y: { agg, column: null, label: group.stem || null, additive: group.additive, integer: agg === 'sum' && columns.every(column => column.measure.integer),
            lower_bound: agg === 'sum' && placeholders > 0, unit: null, percent: columns.every(column => column.measure.percent),
            currency: columns.every(column => column.measure.currency) },
        points, other: null, total: null,
        time: { grain: group.grain, first: points[0].start, last: points[points.length - 1].start, periods_total: total, periods_shown: columns.length, missing },
        scope: { rows: grand.n, groups_total: total, groups_shown: points.length, complete: total <= columns.length, filtered },
        notes, score: spec.score
    };
    chart.fit = fitOf(spec, chart, gates);
    return { ok: true, chart };
}

module.exports = { shapeCategory, shapeTime, shapeWide, detectTotalMembers, measureCounters, measureProblem, periodOfKey, latestPeriod, periodRange,
    coveredPeriods, MIN_POINTS, CARD_POINTS, DONUT_MAX, SEPARATOR };
