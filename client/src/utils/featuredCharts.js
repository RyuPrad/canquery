const KINDS = ['donut', 'bars', 'line'];
const GROUP_TYPES = ['TEXT', 'INTEGER', 'BIGINT', 'SMALLINT', 'NUMERIC', 'REAL', 'DOUBLE PRECISION', 'BOOLEAN', 'DATE', 'TIMESTAMPTZ', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITHOUT TIME ZONE'];
const DATE_TYPE = /^(?:DATE|TIMESTAMPTZ|TIMESTAMP(?: WITH(?:OUT)? TIME ZONE)?)$/i;
const FOOTNOTE = /^(?:notes?|sources?|footnotes?|nota|remarques?|commentaires?|copyright)\s*[:–—-]|^©/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const text = value => typeof value === 'string' && value.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;

export function featuredPeriodTime(key) {
  if (typeof key !== 'string') return null;
  if (/^\d{4}$/.test(key)) return Date.UTC(Number(key), 0, 1);
  const parts = key.match(ISO_DATE);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const time = Date.parse(key);
  return Number.isFinite(time) ? time : null;
}

// Homepage previews need enough context to explain their values. Old cached
// teasers and malformed candidates are omitted rather than given guessed units.
export function isValidFeaturedChart(item) {
  if (!item || !KINDS.includes(item.kind) || !text(item.dataset_id)) return false;
  if (!item.title || ![item.title.en, item.title.fr].some(text)) return false;
  const { context, points } = item;
  if (!context || !Array.isArray(points) || points.length < 2) return false;
  if (!text(context.resource_id) || !text(context.group_by) || !text(context.group_type) || !GROUP_TYPES.includes(context.group_type.toUpperCase())) return false;
  if (!['count', 'avg'].includes(context.agg) || (context.agg === 'count' ? context.agg_column !== null : !text(context.agg_column))) return false;
  if (context.bucket !== null && !['year', 'month', 'day'].includes(context.bucket)) return false;
  if (!text(context.snapshot_at) || !SNAPSHOT_DATE.test(context.snapshot_at) || featuredPeriodTime(context.snapshot_at) === null) return false;
  if (!count(context.snapshot_rows) || context.snapshot_rows < 2 || !count(context.total_groups) || !count(context.displayed_groups)) return false;
  if (context.displayed_groups !== points.length || context.total_groups < points.length || context.total_groups > context.snapshot_rows) return false;
  if (context.limited !== (context.total_groups > context.displayed_groups) || !Array.isArray(context.missing_periods)) return false;
  if (context.missing_periods.length + points.length > context.total_groups || new Set(context.missing_periods).size !== context.missing_periods.length) return false;
  if (points.some(point => !point || (point.key !== null && !text(point.key)) || !text(point.label) || point.label.length > 200 || FOOTNOTE.test(point.label.trim()) || typeof point.value !== 'number' || !Number.isFinite(point.value))) return false;
  if (new Set(points.map(point => point.key)).size !== points.length || points.every(point => point.value === points[0].value)) return false;
  if (context.agg === 'count' && points.some(point => !count(point.value) || point.value === 0 || point.value > context.snapshot_rows)) return false;
  const total = context.agg === 'count' ? points.reduce((sum, point) => sum + point.value, 0) : null;
  if (total !== null && (total > context.snapshot_rows || (!context.limited && total !== context.snapshot_rows))) return false;

  if (item.kind === 'line') {
    if (points.length > 30 || points.some(point => point.key === null) || context.group_type.toUpperCase() === 'BOOLEAN') return false;
    if (context.bucket !== null && !DATE_TYPE.test(context.group_type)) return false;
    const times = points.map(point => featuredPeriodTime(point.key));
    if (times.some(time => time === null) || times.some((time, index) => index > 0 && time <= times[index - 1])) return false;
    if (context.missing_periods.some(key => featuredPeriodTime(key) === null || points.some(point => point.key === key))) return false;
    const allTimes = [...times, ...context.missing_periods.map(featuredPeriodTime)];
    if (new Set(allTimes).size !== allTimes.length) return false;
    return true;
  }

  if (context.agg !== 'count' || context.bucket !== null || DATE_TYPE.test(context.group_type) || context.missing_periods.length > 0) return false;
  if (points.some(point => point.key === null && !['Not recorded', 'Non renseigné'].includes(point.label))) return false;
  if (item.kind === 'donut') return points.length <= 6 && !context.limited && total > 0;
  return points.length <= 5;
}

export function selectFeaturedCharts(items) {
  return Array.isArray(items) ? items.filter(isValidFeaturedChart) : [];
}
