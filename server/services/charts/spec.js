// The closed vocabulary of a chart request. The custom builder speaks it
// today; anything that proposes charts later must speak it too, so nothing
// reaches SQL that was not checked against the table's model first.
//
//   { kind?, x: { column, grain? } | { time, grain? } | { wide }, y: { agg, column? }, limit? }
//
// x.column names any column (a time column becomes a time axis), x.time an
// axis of the model (also year + month pairs), x.wide a group of period
// columns. y.agg is count, sum, avg, min or max; all but count name a number
// column, except over x.wide, where the period columns are the numbers.
const AppError = require('../../utils/AppError');
const { specId, LIMITS } = require('./candidates');

const AGGS = new Set(['count', 'sum', 'avg', 'min', 'max']);
const KINDS = new Set(['line', 'bars', 'donut']);
const NUMERIC = new Set(['INTEGER', 'NUMERIC']);
const MAX_GROUPS = 50;
const MAX_PERIODS = 240;

function invalid(message) {
    const error = new AppError(message, 400);
    error.publicCode = 'INVALID_CHART_SPEC';
    return error;
}

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sums = column => column.measure.additive === 'yes' || column.measure.additive === 'probable';

// A number column that the model did not read as a measure (a code, a year)
// can still be asked for by name: it is described as one, with nothing known
// about what its values add up to.
function asMeasure(column) {
    if (column.measure) return column;
    return { ...column, measure: { additive: 'unknown', reason: 'not_a_measure', text: false, clean: null, missing_share: 0, unreadable_share: 0,
        integer: column.type === 'INTEGER', percent: false, currency: false, ambiguous: false, min: null, max: null, unit: null, blocked_by: [] } };
}

function limitOf(raw, fallback, max) {
    if (raw === undefined || raw === null) return fallback;
    if (!Number.isInteger(raw) || raw < 1) throw invalid('limit must be a positive whole number');
    return Math.min(raw, max);
}

/**
 * Checks a chart request against a table's model and returns the spec the
 * engine runs. Throws 400 INVALID_CHART_SPEC for a request that names
 * something the table does not have, and 400 CHART_REFUSED (hint
 * mixed_measures) for one that would add up different things.
 *
 * @param {unknown} raw
 * @param {object} model from buildTableModel()
 * @param {{ pinned?: string[] }} [options] pinned: columns an equality filter holds to one value
 */
function validateSpec(raw, model, { pinned = [] } = {}) {
    if (!plainObject(raw) || !plainObject(raw.x) || !plainObject(raw.y)) throw invalid('A chart needs an x and a y');
    const byId = new Map(model.columns.map(column => [column.id, column]));
    const agg = raw.y.agg;
    if (typeof agg !== 'string' || !AGGS.has(agg)) throw invalid('Unknown aggregation');
    if (raw.kind !== undefined && raw.kind !== null && (typeof raw.kind !== 'string' || !KINDS.has(raw.kind))) throw invalid('Unknown chart kind');

    let x;
    let y;
    let limit;
    let kind;
    if (raw.x.wide !== undefined) {
        const group = typeof raw.x.wide === 'string' ? model.wide_groups.find(entry => entry.id === raw.x.wide) : null;
        if (!group) throw invalid('Unknown group of period columns');
        if (agg !== 'sum' && agg !== 'avg') throw invalid('Period columns can be added up or averaged');
        x = { type: 'wide', group: group.id, grain: group.grain };
        y = { agg, group: group.id };
        limit = LIMITS.periods;
        kind = 'line';
    } else {
        let axis;
        let column = null;
        if (raw.x.time !== undefined) {
            axis = typeof raw.x.time === 'string' ? model.time_axes.find(entry => entry.id === raw.x.time) : null;
            if (!axis) throw invalid('Unknown time axis');
        } else {
            column = typeof raw.x.column === 'string' ? byId.get(raw.x.column) : null;
            if (!column) throw invalid('Unknown x column');
            axis = model.time_axes.find(entry => !entry.composite && entry.columns[0] === column.id) || null;
        }
        if (axis) {
            const grain = raw.x.grain === undefined || raw.x.grain === null ? axis.grain : raw.x.grain;
            if (typeof grain !== 'string' || !axis.grains.includes(grain)) throw invalid('Unknown grain for this time axis');
            x = { type: 'time', axis: axis.id, grain };
            limit = limitOf(raw.limit, LIMITS.periods, MAX_PERIODS);
            kind = 'line';
        } else {
            if (raw.x.grain !== undefined && raw.x.grain !== null) throw invalid('This column is not a time column');
            x = { type: 'category', column: column.id };
            limit = limitOf(raw.limit, raw.kind === 'donut' ? LIMITS.donut : LIMITS.bars, MAX_GROUPS);
            kind = raw.kind === 'donut' ? 'donut' : 'bars';
        }
        if (agg === 'count') y = { agg };
        else {
            const found = typeof raw.y.column === 'string' ? byId.get(raw.y.column) : null;
            if (!found) throw invalid('Unknown y column');
            if (!found.measure && !NUMERIC.has(found.type)) throw invalid('The y column does not hold numbers');
            const measure = asMeasure(found);
            if (x.type === 'category' && x.column === measure.id) throw invalid('A chart cannot group by the column it adds up');
            // Values that are different things (measure names, units) add up
            // only within one of them: grouped by that column, or filtered to one value.
            const held = new Set(pinned);
            const open = measure.measure.blocked_by.filter(block => !held.has(block.column) && !(x.type === 'category' && x.column === block.column));
            if (open.length) {
                const blocker = byId.get(open[0].column);
                const error = new AppError('"' + measure.label + '" holds different things in each "' + (blocker ? blocker.label : open[0].column) +
                    '". Filter the table to one of them, or group by that column.', 400);
                error.publicCode = 'CHART_REFUSED';
                error.hint = 'mixed_measures';
                throw error;
            }
            y = { agg, column: measure.id };
        }
    }
    const spec = { template: 'custom', kind, x, y, limit, score: 0, generic: false, custom: true };
    spec.id = specId(spec);
    return spec;
}

module.exports = { validateSpec, asMeasure, sums, AGGS, KINDS, MAX_GROUPS, MAX_PERIODS };
