// What the chart engine's answers look like, checked before anything is drawn.
// Structure only: every surface that draws charts (the Chart tab, the previews,
// the app) reads the same shape, and each brings its own wording. Fields the
// reader does not know are ignored, so the engine can add notes and figures
// without breaking an older page. No dependencies: the app imports this file.

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => typeof value === 'string';
const optional = (value, check) => value === undefined || value === null || check(value);
const listOf = (value, check) => Array.isArray(value) && value.every(check);

export const CHART_KINDS = ['line', 'bars', 'donut'];
export const CHART_AGGS = ['count', 'sum', 'avg', 'min', 'max'];

// A point is a named group, the "not recorded" group, or a period.
export function isChartPoint(point) {
  return record(point) && finite(point.value) &&
    (point.blank === true || text(point.label) || text(point.start));
}

const isKpi = (kpi) => record(kpi) && text(kpi.role);

export function isChart(chart) {
  return record(chart) && text(chart.id) && CHART_KINDS.includes(chart.kind) &&
    record(chart.x) && (chart.x.type === 'category' || chart.x.type === 'time') && optional(chart.x.label, text) &&
    record(chart.y) && CHART_AGGS.includes(chart.y.agg) && optional(chart.y.label, text) &&
    Array.isArray(chart.points) && chart.points.length > 0 && chart.points.every(isChartPoint) &&
    listOf(chart.notes, (note) => record(note) && text(note.code)) &&
    record(chart.scope) &&
    optional(chart.time, (time) => record(time) && optional(time.missing, (missing) => listOf(missing, text))) &&
    optional(chart.other, (other) => record(other) && finite(other.value));
}

// Each part of an answer that a page reads beyond the charts themselves.
const isBlock = (block) => record(block) && text(block.column) &&
  listOf(block.values, (entry) => record(entry) && text(entry.value) && finite(entry.rows) && optional(entry.label, text));
const isSkip = (skip) => record(skip) && text(skip.id) && record(skip.x) && text(skip.x.type) && record(skip.y) && text(skip.y.agg);
const isAxis = (axis) => record(axis) && text(axis.id) && listOf(axis.columns, text) && text(axis.grain) && listOf(axis.grains, text);
const isSpec = (spec) => record(spec) && record(spec.x) && record(spec.y) && optional(spec.x.time, text) && optional(spec.x.column, text) &&
  optional(spec.x.wide, text);

/** The answer of GET /web-api/v1/resources/:id/charts. */
export function isChartsData(data) {
  return record(data) && (data.status === 'ok' || data.status === 'no_charts') &&
    listOf(data.charts, isChart) && listOf(data.kpis, isKpi) &&
    listOf(data.skipped, isSkip) && listOf(data.blocked, isBlock) &&
    record(data.model) && listOf(data.model.columns, (column) => record(column) && text(column.id) && text(column.role)) &&
    optional(data.model.time_axes, (axes) => listOf(axes, isAxis)) &&
    optional(data.model.wide_groups, (groups) => listOf(groups, (group) => record(group) && text(group.id))) &&
    optional(data.builder, (builder) => record(builder) && optional(builder.default, isSpec)) &&
    optional(data.sums_withheld, (value) => typeof value === 'boolean') &&
    record(data.scope);
}

/** The answer of GET /web-api/v1/resources/:id/charts/custom: a chart, or the reason there is none. */
export function isCustomChartData(data) {
  return record(data) && (data.chart === null
    ? (data.reason === null || typeof data.reason === 'string')
    : isChart(data.chart));
}

/** A homepage or gallery card: a dataset, the snapshot charted, and one chart. */
export function isInsightCard(card) {
  return record(card) && text(card.dataset_id) && card.dataset_id !== '' &&
    record(card.title) && Object.values(card.title).every((title) => optional(title, text)) &&
    text(card.resource_id) && text(card.snapshot_at) && !Number.isNaN(Date.parse(card.snapshot_at)) &&
    listOf(card.kpis, isKpi) && isChart(card.chart);
}

// The spec of the chart the builder shows, in the engine's request vocabulary.
export function customSpec({ kind, x, grain, time, wide, agg, column, limit }) {
  const spec = { y: agg === 'count' || wide ? { agg } : { agg, column } };
  if (wide) spec.x = { wide };
  else if (time) spec.x = grain ? { time, grain } : { time };
  else spec.x = grain ? { column: x, grain } : { column: x };
  if (kind) spec.kind = kind;
  if (limit) spec.limit = limit;
  return spec;
}
