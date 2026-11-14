// The public preview shape of GET /api/v1/insights/featured (the
// FeaturedPreview schema), from a chart of the engine. That shape can only say
// a count of records by one column, or a count or an average of one column over
// the years, months or days of one other column. Every other chart has no place
// in it and is left out: the website's cards carry charts whole.
//
// The checks of the shape's first builder (insightsService.buildFeaturedPreview)
// all hold for what comes out of here; __tests__/featuredApi.test.js checks
// each preview against a frozen copy of the website's old validator.

const LIMITS = { bars: 5, donut: 6, line: 30 };
const NOT_RECORDED = { en: 'Not recorded', fr: 'Non renseigné' };
const BUCKETS = new Set(['year', 'month', 'day']);
const DATE_TYPES = new Set(['DATE', 'TIMESTAMPTZ']);
const NUMERIC_LABEL_RE = /^[+-]?\d+(?:[.,]\d+)?$/;
const LABEL_LIMIT = 200;

const distinct = values => new Set(values).size === values.length;

// A period as the old previews wrote it: a dated bucket as an ISO instant, a
// year number as its four digits.
function periodKey(start, bucket) {
    return bucket ? start + 'T00:00:00.000Z' : start.slice(0, 4);
}
function periodLabel(start, bucket) {
    return bucket === 'month' ? start.slice(0, 7) : bucket === 'day' ? start.slice(0, 10) : start.slice(0, 4);
}

function categoryPreview(chart, column, lang) {
    if (chart.y.agg !== 'count' || DATE_TYPES.has(column.type)) return null;
    const blank = chart.points.find(point => point.blank);
    const named = chart.points.filter(point => !point.blank);
    if (named.some(point => typeof point.label !== 'string' || point.label.length > LABEL_LIMIT || NUMERIC_LABEL_RE.test(point.label))) return null;
    const totalGroups = chart.scope.groups_total + (blank ? 1 : 0);
    const donut = chart.kind === 'donut' && chart.scope.complete && chart.points.length <= LIMITS.donut;
    const shown = donut ? chart.points : named.slice(0, LIMITS.bars);
    const points = shown.map(point => ({ key: point.blank ? null : point.label, label: point.blank ? NOT_RECORDED[lang] || NOT_RECORDED.en : point.label,
        value: point.value }));
    if (!distinct(points.map(point => point.label.toLowerCase())) || !distinct(points.map(point => point.key))) return null;
    return { kind: donut ? 'donut' : 'bars', points, totalGroups, bucket: null, missing: [] };
}

function timePreview(chart, axis, column) {
    if (!axis || axis.columns.length !== 1 || !column || !column.time) return null;
    let bucket;
    if (DATE_TYPES.has(column.type)) {
        if (!BUCKETS.has(chart.x.grain)) return null;
        bucket = chart.x.grain;
    } else if (column.time.kind === 'year_number' && chart.x.grain === 'year') bucket = null;
    else return null;
    const window = chart.points.slice(-LIMITS.line);
    if (window.length === 0) return null;
    const first = window[0].start;
    const points = window.map(point => ({ key: periodKey(point.start, bucket), label: periodLabel(point.start, bucket), value: point.value }));
    const missing = (chart.time.missing || []).filter(start => start > first).map(start => periodKey(start, bucket));
    // Rows without a period were a group of their own in the old previews, and
    // periods left out (thin edges, a period in progress or cut short, dates
    // after today) are groups not shown.
    const undated = chart.notes.some(note => note.code === 'rows_without_period' && note.rows > 0);
    const leftOut = chart.notes.reduce((sum, note) => sum + (note.code === 'sparse_periods_left_out' || note.code === 'future_periods_left_out' ? note.periods || 0
        : note.code === 'partial_period_left_out' || note.code === 'cut_period_left_out' ? 1 : 0), 0);
    return { kind: 'line', points, totalGroups: chart.time.periods_total + (undated ? 1 : 0) + leftOut, bucket, missing };
}

/**
 * @param {{ candidate: { dataset_id: string, title_en: string, title_fr: string, resource_id: string }, chart: object,
 *   model: object, snapshotAt: string, lang?: 'en' | 'fr' }} input model: the public model of analyzeSnapshot()
 * @returns {object | null} a FeaturedPreview, or null when the chart has no place in that shape
 */
function toFeaturedPreview({ candidate, chart, model, snapshotAt, lang = 'en' }) {
    if (!candidate || !chart || !model || !snapshotAt) return null;
    const agg = chart.y.agg;
    if (agg !== 'count' && agg !== 'avg') return null;
    if (agg === 'avg' && !chart.y.column) return null;
    const columnOf = id => model.columns.find(column => column.id === id);
    let shaped;
    let column;
    if (chart.x.type === 'category') {
        column = columnOf(chart.x.column);
        shaped = column ? categoryPreview(chart, column, lang) : null;
    } else if (chart.x.type === 'time' && chart.x.axis) {
        const axis = (model.time_axes || []).find(entry => entry.id === chart.x.axis);
        column = axis ? columnOf(axis.columns[0]) : null;
        shaped = timePreview(chart, axis, column);
    }
    if (!shaped || shaped.points.length < 2 || new Set(shaped.points.map(point => point.value)).size < 2) return null;

    const rows = chart.scope.rows;
    if (!Number.isSafeInteger(rows) || rows < 2 || shaped.totalGroups > rows || shaped.totalGroups < shaped.points.length) return null;
    if (agg === 'count') {
        const sum = shaped.points.reduce((total, point) => total + point.value, 0);
        if (shaped.points.some(point => !Number.isSafeInteger(point.value) || point.value < 1) || sum > rows) return null;
        if (shaped.totalGroups === shaped.points.length && sum !== rows) return null;
    }
    return {
        dataset_id: candidate.dataset_id,
        title: { en: candidate.title_en, fr: candidate.title_fr },
        kind: shaped.kind,
        points: shaped.points,
        context: {
            resource_id: candidate.resource_id,
            group_by: column.id,
            agg,
            agg_column: agg === 'count' ? null : chart.y.column,
            bucket: shaped.bucket,
            group_type: column.type,
            snapshot_at: snapshotAt,
            snapshot_rows: rows,
            total_groups: shaped.totalGroups,
            displayed_groups: shaped.points.length,
            limited: shaped.totalGroups > shaped.points.length,
            missing_periods: shaped.missing
        }
    };
}

module.exports = { toFeaturedPreview, LIMITS };
