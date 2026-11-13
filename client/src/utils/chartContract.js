// What the chart engine's answers look like, checked before anything is drawn.
// Structure only: every surface that draws charts (the Chart tab, the previews,
// the app) reads the same shape, and each brings its own wording. Fields the
// reader does not know are ignored, so the engine can add notes and figures
// without breaking an older page. No dependencies: the app imports this file.

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export const CHART_KINDS = ['line', 'bars', 'donut'];
export const CHART_AGGS = ['count', 'sum', 'avg', 'min', 'max'];

// A point is a named group, the "not recorded" group, or a period.
export function isChartPoint(point) {
  return record(point) && finite(point.value) &&
    (point.blank === true || typeof point.label === 'string' || typeof point.start === 'string');
}

export function isChart(chart) {
  return record(chart) && typeof chart.id === 'string' && CHART_KINDS.includes(chart.kind) &&
    record(chart.x) && (chart.x.type === 'category' || chart.x.type === 'time') &&
    record(chart.y) && CHART_AGGS.includes(chart.y.agg) &&
    Array.isArray(chart.points) && chart.points.length > 0 && chart.points.every(isChartPoint) &&
    Array.isArray(chart.notes) && chart.notes.every((note) => record(note) && typeof note.code === 'string') &&
    record(chart.scope);
}

/** The answer of GET /web-api/v1/resources/:id/charts. */
export function isChartsData(data) {
  return record(data) && (data.status === 'ok' || data.status === 'no_charts') &&
    Array.isArray(data.charts) && data.charts.every(isChart) &&
    Array.isArray(data.kpis) && data.kpis.every((kpi) => record(kpi) && typeof kpi.role === 'string') &&
    Array.isArray(data.skipped) && Array.isArray(data.blocked) &&
    record(data.model) && Array.isArray(data.model.columns) &&
    data.model.columns.every((column) => record(column) && typeof column.id === 'string' && typeof column.role === 'string') &&
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
  return record(card) && typeof card.dataset_id === 'string' && card.dataset_id !== '' && record(card.title) &&
    typeof card.resource_id === 'string' && typeof card.snapshot_at === 'string' && !Number.isNaN(Date.parse(card.snapshot_at)) &&
    Array.isArray(card.kpis) && isChart(card.chart);
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
