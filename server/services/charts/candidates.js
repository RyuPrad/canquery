// Which charts a table could have, best first. A candidate is only a
// proposal: it becomes a chart once its numbers have been computed from the
// whole table and checked (validate.js).
const { createHash } = require('crypto');
const { hiddenTwin } = require('./model');

const LIMITS = { bars: 12, donut: 6, ranking: 10, periods: 60 };
const ADDITIVE_RANK = { yes: 3, probable: 2, no: 1, unknown: 0 };
const RANKER_MAX = 20000;
const RANKING_ROWS_MAX = 5000;

const GRAIN_ORDER = { day: 0, month: 1, quarter: 2, fiscal_year: 3, year: 3 };
const thin = axis => axis.periods !== undefined && axis.periods < 4;

const sums = column => column.measure.additive === 'yes' || column.measure.additive === 'probable';
const confidencePenalty = column => (column.confidence === 'low' ? 12 : column.confidence === 'medium' ? 6 : 0);

/** A stable id for a spec: the same chart keeps its id across requests. */
function specId(spec) {
    return 'c_' + createHash('sha256').update(JSON.stringify([spec.x, spec.y])).digest('hex').slice(0, 12);
}

function cardinalityFit(distinct) {
    if (distinct >= 2 && distinct <= 7) return 10;
    if (distinct <= 15) return 8;
    if (distinct <= 30) return 5;
    return 2;
}

/**
 * Every chart worth trying on this table, scored.
 * @param {object} model from buildTableModel()
 * @param {{ lang?: 'en' | 'fr', pinned?: string[] }} [options] pinned: columns that an equality filter holds to one value
 */
function listCandidates(model, { lang = 'en', pinned = [] } = {}) {
    const held = new Set(pinned);
    const byId = new Map(model.columns.map(column => [column.id, column]));
    // The other language's twin is left out, and a code whose wording has a
    // column of its own that can be charted in its place.
    const chartable = column => Boolean(column) && ['category', 'code', 'label'].includes(column.role) && !hiddenTwin(column, lang);
    const visible = column => !hiddenTwin(column, lang) && !(column.label_columns || []).some(id => chartable(byId.get(id)));
    const blockers = column => column.measure.blocked_by.filter(block => !held.has(block.column)).map(block => block.column);

    const measures = model.columns
        .filter(column => column.role === 'measure' && !column.wide && visible(column) && column.confidence !== 'low' && !column.measure.doubtful)
        // Measures that can be added up across the whole table come before those that cannot.
        .sort((a, b) => Math.min(1, blockers(a).length) - Math.min(1, blockers(b).length) ||
            ADDITIVE_RANK[b.measure.additive] - ADDITIVE_RANK[a.measure.additive] ||
            Number(a.generic_name) - Number(b.generic_name) || a.measure.missing_share - b.measure.missing_share);
    const axes = model.time_axes.filter(axis => axis.columns.every(id => visible(byId.get(id))))
        // The finest axis first: a month axis shows more than its years. An
        // axis of two or three periods comes after any that can draw a line.
        .sort((a, b) => Number(thin(a)) - Number(thin(b)) || GRAIN_ORDER[a.grain] - GRAIN_ORDER[b.grain] || Number(b.composite) - Number(a.composite));
    const groups = model.columns.filter(column => (column.role === 'category' || column.role === 'code') && visible(column) && !held.has(column.id));
    const breakdowns = groups.filter(column => column.category.breakdown)
        .sort((a, b) => cardinalityFit(b.category.distinct) - cardinalityFit(a.category.distinct) || a.blank_share - b.blank_share);
    // What rows are called: a near-unique name, or a category with too many values for a share chart.
    const names = model.columns.filter(column => visible(column) && !held.has(column.id) &&
        (column.role === 'label' || ((column.role === 'category' || column.role === 'code') && !column.category.breakdown &&
            !column.category.numeric && column.category.distinct <= RANKER_MAX)))
        .sort((a, b) => Number(b.role === 'label') - Number(a.role === 'label') || Number(a.generic_name) - Number(b.generic_name));
    // Short keys with letters ("K1A") name the rows only when nothing else does.
    const rankers = names.length ? names : model.columns.filter(column => column.rankable && visible(column) && !held.has(column.id)).slice(0, 1);

    const out = [];
    const add = (template, kind, x, y, base, columns, extra = {}) => {
        let score = base;
        for (const column of columns) {
            score -= confidencePenalty(column);
            if (column.generic_name) score -= 15;
        }
        const spec = { template, kind, x, y, limit: extra.limit, score: score + (extra.bonus || 0), generic: columns.some(column => column.generic_name) };
        if (extra.single) spec.single = true;
        if (extra.row_labels) spec.row_labels = true;
        spec.id = specId(spec);
        out.push(spec);
    };
    // In a table of things or events the counts come first: an average of an
    // attribute says less than how many there are.
    const average = model.records ? -10 : 0;
    const measureBonus = column => (sums(column) ? 10 : 4) * (1 - column.measure.missing_share) +
        (column.measure.additive === 'yes' ? 8 : column.measure.additive === 'probable' ? 4 : 0) - (column.measure.missing_share > 0.5 ? 8 : 0);
    const groupBonus = column => cardinalityFit(column.category.distinct) + 6 * (1 - column.blank_share);

    measures.slice(0, 3).forEach((measure, index) => {
        const blocked = blockers(measure);
        const agg = sums(measure) ? 'sum' : 'avg';
        // Later measures give way to the first.
        const order = -index * 3;
        // Values that are different things in each row of some column are not
        // charted on their own initiative, not even one bar per thing: the
        // bars would share an axis and nothing else. (The builder may.)
        const free = () => blocked.length === 0;
        if (blocked.length === 0) {
            axes.slice(0, 2).forEach((axis, a) => {
                // One row per period: the figure itself, whatever it measures.
                const single = model.rows > 0 && axis.periods !== undefined && model.rows <= axis.periods;
                add('measure_over_time', 'line', { type: 'time', axis: axis.id, grain: axis.grain }, { agg, column: measure.id },
                    agg === 'sum' ? 60 : single ? 52 : 40 + average, [measure, ...axis.columns.map(id => byId.get(id))],
                    { bonus: measureBonus(measure) + order - a * 9, limit: LIMITS.periods, single });
            });
        }
        breakdowns.slice(0, 3).forEach((group, g) => {
            if (!free(group.id)) return;
            add(agg === 'sum' ? 'share_by_category' : 'average_by_category', agg === 'sum' && group.category.distinct <= LIMITS.donut ? 'donut' : 'bars',
                { type: 'category', column: group.id }, { agg, column: measure.id }, agg === 'sum' ? 52 : 42 + average, [measure, group],
                { bonus: measureBonus(measure) + groupBonus(group) + order - g * 4, limit: LIMITS.bars });
        });
        const ranker = rankers.find(column => free(column.id));
        // The largest single values of something that does not add up: only
        // in a table short enough for its rows to be worth naming.
        if (ranker && (agg === 'sum' || (ranker.role === 'label' && model.rows <= RANKING_ROWS_MAX))) {
            add('top_labels_by_measure', 'bars', { type: 'category', column: ranker.id }, { agg: agg === 'sum' ? 'sum' : 'max', column: measure.id },
                agg === 'sum' ? 54 : 46, [measure, ranker], { bonus: measureBonus(measure) + order - (ranker.rankable ? 10 : 0), limit: LIMITS.ranking,
                    row_labels: ranker.role !== 'category' && ranker.role !== 'code' });
        }
    });

    for (const group of model.wide_groups) {
        const agg = group.additive === 'yes' || group.additive === 'probable' ? 'sum' : 'avg';
        add('wide_totals_per_period', 'line', { type: 'wide', group: group.id, grain: group.grain }, { agg, group: group.id }, agg === 'sum' ? 58 : 42, [],
            { bonus: agg === 'sum' ? 8 : 0, limit: LIMITS.periods });
        const label = rankers[0] || breakdowns[0];
        if (label) {
            // A verified total says more than the last period alone.
            const total = group.total && group.total.verified ? group.total.id : null;
            add('wide_top_rows_latest', 'bars', { type: 'category', column: label.id },
                { agg: agg === 'sum' ? 'sum' : 'max', column: total || group.columns[group.columns.length - 1].id, of: group.id, latest: !total },
                50, [label], { limit: LIMITS.ranking, row_labels: label.role === 'label' });
        }
    }

    if (model.records) {
        axes.slice(0, 1).forEach(axis => add('records_over_time', 'line', { type: 'time', axis: axis.id, grain: axis.grain }, { agg: 'count' }, 46,
            axis.columns.map(id => byId.get(id)), { limit: LIMITS.periods }));
        breakdowns.slice(0, 4).forEach((group, g) => add('records_by_category', group.category.distinct <= LIMITS.donut ? 'donut' : 'bars',
            { type: 'category', column: group.id }, { agg: 'count' }, 40, [group], { bonus: groupBonus(group) - g * 3, limit: LIMITS.bars }));
        // Values that repeat but are too many for a share chart: the most frequent ones.
        names.filter(column => column.role !== 'label').slice(0, 2).forEach((group, g) => add('top_values_by_records', 'bars',
            { type: 'category', column: group.id }, { agg: 'count' }, 36, [group], { bonus: 6 * (1 - group.blank_share) - g * 3, limit: LIMITS.ranking }));
    }

    return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

const measureOf = spec => spec.y.column || spec.y.group || null;

/**
 * The charts to show, in score order, without repeating itself.
 * @param {Array<object>} charts candidates or shaped charts with template, x, y, score
 */
function pickDiverse(charts, { limit = 6 } = {}) {
    const picked = [];
    const perMeasure = new Map();
    const measures = new Set(charts.map(measureOf).filter(Boolean));
    // A table with one measure may show it several ways; with more, each gets two charts.
    const perMeasureMax = measures.size <= 1 ? 4 : 2;
    let lines = 0;
    let counts = 0;
    const seen = new Set();
    const categories = charts.some(chart => chart.x.type === 'category');
    for (const chart of charts) {
        if (picked.length >= limit) break;
        const key = JSON.stringify([chart.x, chart.y]);
        if (seen.has(key)) continue;
        const measure = measureOf(chart);
        const time = chart.x.type !== 'category';
        if (time && lines >= (categories ? 2 : 3)) continue;
        if (chart.y.agg === 'count' && counts >= 3) continue;
        if (measure && (perMeasure.get(measure) || 0) >= perMeasureMax) continue;
        // One time series per axis for a measure: the month axis already shows the years.
        if (time && picked.some(other => other.x.type !== 'category' && measureOf(other) === measure && other.y.agg === chart.y.agg)) continue;
        seen.add(key);
        picked.push(chart);
        if (time) lines += 1;
        if (chart.y.agg === 'count') counts += 1;
        if (measure) perMeasure.set(measure, (perMeasure.get(measure) || 0) + 1);
    }
    return picked;
}

module.exports = { listCandidates, pickDiverse, specId, LIMITS };
