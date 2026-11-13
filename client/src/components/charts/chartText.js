// Words for what the chart engine sends as codes and numbers: titles,
// subtitles, the notes under a chart, column roles and the reasons a chart was
// set aside. Takes the page's `t` and language; draws nothing.
import { fmtInt, fmtNum, humanize, fmtPeriod } from './theme.js';

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined || values[key] === null ? match : String(values[key])));
// `t` answers with the key itself when it has no string for it.
const known = (t, key) => { const text = t(key); return text && text !== key ? text : null; };

/** The name a chart goes by: what it measures and what it is grouped by. */
export function chartTitle(chart, t) {
  const agg = chart.y.agg;
  const time = chart.x.type === 'time';
  let key;
  if (chart.x.wide) key = agg === 'avg' ? 'chart.title.wide_avg' : 'chart.title.wide_sum';
  else if (agg === 'count') key = time ? 'chart.title.count_over_time' : 'chart.title.count_by';
  else if (time) key = agg === 'sum' || chart.single ? 'chart.title.over_time' : 'chart.title.' + agg + '_over_time';
  else key = 'chart.title.' + agg + '_by';
  const title = fill(t(key), { measure: humanize(chart.y.label || ''), by: humanize(chart.x.label || '') }).replace(/\s+/g, ' ').trim();
  return chart.x.wide && chart.y.label ? humanize(chart.y.label) + ' · ' + title : title;
}

/** The title of a chart that was not drawn, from its spec and the table's model. */
export function specTitle(spec, model, t) {
  const columns = (model && model.columns) || [];
  const label = (id) => { const column = columns.find((entry) => entry.id === id); return column ? column.label || column.id : id; };
  let x;
  if (spec.x.type === 'wide') x = { type: 'time', wide: spec.x.group, label: null };
  else if (spec.x.type === 'time') {
    const axis = ((model && model.time_axes) || []).find((entry) => entry.id === spec.x.axis);
    x = { type: 'time', label: axis ? axis.columns.map(label).join(' + ') : '' };
  } else x = { type: 'category', label: label(spec.x.column) };
  return chartTitle({ x, y: { agg: spec.y.agg, label: spec.y.column ? label(spec.y.column) : null } }, t);
}

/** One line under the title: how much of the table the chart shows. */
export function chartSubtitle(chart, t, lang) {
  const parts = [];
  // Groups of a table of figures are compared in one period; those of a
  // table of records count every period the table covers.
  if (chart.period && chart.period.start) parts.push(fill(t('chart.sub.period'), { period: fmtPeriod(chart.period.start, chart.period.grain, lang) }));
  else if (chart.span && chart.span.first) {
    parts.push(fill(t('chart.sub.span'), { first: fmtPeriod(chart.span.first, chart.span.grain, lang), last: fmtPeriod(chart.span.last, chart.span.grain, lang) }));
  }
  if (chart.x.type === 'time' && chart.time) {
    parts.push(fmtPeriod(chart.time.first, chart.time.grain, lang) + ' – ' + fmtPeriod(chart.time.last, chart.time.grain, lang));
  } else if (chart.scope.complete) parts.push(fill(t('chart.sub.groups'), { total: fmtInt(chart.scope.groups_total, lang) }));
  else parts.push(fill(t('chart.sub.top_groups'), { shown: fmtInt(chart.scope.groups_shown, lang), total: fmtInt(chart.scope.groups_total, lang) }));
  if (chart.y.unit) parts.push(chart.y.unit);
  if (chart.y.lower_bound) parts.push(t('chart.sub.at_least'));
  return parts.join(' · ');
}

/** The label of one point: a group's name, "Not recorded", or a period. */
export function pointLabel(point, chart, t, lang) {
  if (point.blank) return t('chart.not_recorded');
  if (chart.x.type === 'time') return fmtPeriod(point.start, chart.x.grain, lang);
  return point.label;
}

/**
 * A chart as the homepage's small charts take it: periods keyed by their first
 * day, groups by their name, and the few facts the drawing needs.
 */
// A homepage card draws at most this many bars.
const CARD_BARS = 5;

/**
 * The part of a chart that a homepage card draws: a bar chart keeps its
 * largest groups, and says so, so the card's words match its bars.
 */
export function cardView(chart) {
  if (chart.kind !== 'bars' || chart.points.length <= CARD_BARS) return chart;
  const points = chart.points.slice(0, CARD_BARS);
  const named = points.filter((point) => !point.blank).length;
  return { ...chart, points, other: null, scope: { ...chart.scope, groups_shown: named, complete: false } };
}

export function miniChartOf(chart, t) {
  const time = chart.x.type === 'time';
  const points = chart.points.map((point) => ({
    key: time ? point.start : point.blank ? null : point.label,
    label: point.blank ? t('chart.not_recorded') : time ? point.start : point.label,
    value: point.value,
  }));
  return {
    kind: chart.kind,
    points,
    context: {
      agg: chart.y.agg === 'count' ? 'count' : 'avg',
      limited: !chart.scope.complete,
      grain: time ? chart.x.grain : null,
      missing_periods: time && chart.time ? chart.time.missing || [] : [],
      totalLabel: chart.y.agg === 'count' ? null : chart.y.label || null,
    },
  };
}

/**
 * A chart's points in order, with each period that has no number in its
 * place (point: null), so a line shows the gap and the values table lists it.
 */
export function chartRows(chart) {
  const missing = chart.x.type === 'time' && chart.time && Array.isArray(chart.time.missing) ? chart.time.missing : [];
  const rows = chart.points.map((point) => ({ point, start: typeof point.start === 'string' ? point.start : null }));
  if (!missing.length) return rows;
  return [...rows, ...missing.map((start) => ({ point: null, start }))]
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** A chart's points as the visuals take them; a period with no number has a null value. */
export function chartRecords(chart, t, lang) {
  return chartRows(chart).map((row) => (row.point
    ? { key: pointLabel(row.point, chart, t, lang), value: row.point.value }
    : { key: fmtPeriod(row.start, chart.x.grain, lang), value: null }));
}

/**
 * The sentence for one note, or null for a code this page does not know (a
 * newer engine may send more).
 */
export function noteText(note, t, lang) {
  const template = known(t, 'chart.note.' + note.code);
  if (!template) return null;
  const count = (value) => (typeof value === 'number' ? fmtInt(value, lang) : undefined);
  return fill(template, {
    cells: count(note.cells), rows: count(note.rows), shown: count(note.shown), total: count(note.total), periods: count(note.periods),
    tokens: Array.isArray(note.tokens) && note.tokens.length ? note.tokens.map((token) => '“' + token + '”').join(', ') : '…',
    by: note.by ? humanize(note.by) : undefined, kept: note.kept,
    period: typeof note.start === 'string' ? fmtPeriod(note.start, note.grain, lang) : undefined,
  });
}

/** Notes worth showing, the ones that change how to read the chart first. */
export function chartNotes(chart, t, lang) {
  return chart.notes
    .map((note) => ({ code: note.code, caution: note.level === 'caution', text: noteText(note, t, lang) }))
    .filter((note) => note.text)
    .sort((a, b) => Number(b.caution) - Number(a.caution));
}

/** A sentence that says what the chart shows, for readers who cannot see it. */
export function chartSummary(chart, t, lang) {
  const points = chart.points.filter((point) => !point.blank);
  if (!points.length) return '';
  if (chart.x.type === 'time') {
    const last = points[points.length - 1];
    return fill(t('chart.summary_periods'), { count: fmtInt(points.length, lang), first: pointLabel(points[0], chart, t, lang),
      last: pointLabel(last, chart, t, lang), value: fmtNum(last.value, lang) });
  }
  const top = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]);
  return fill(t('chart.summary_groups'), { count: fmtInt(chart.scope.groups_total, lang), top: top.label, value: fmtNum(top.value, lang) });
}

const SKIP_GROUPS = {
  flat: 'flat', one_group: 'one_group', mostly_blank: 'mostly_blank', id_like: 'id_like', same_as_other_chart: 'same_as_other_chart',
  too_few_groups: 'too_few', too_few_periods: 'too_few', no_groups: 'too_few', no_periods: 'too_few',
  numeric_labels: 'poor_labels', long_labels: 'poor_labels', link_labels: 'poor_labels', date_labels: 'poor_labels', duplicate_labels: 'poor_labels',
  code_labels: 'poor_labels', garbled_labels: 'poor_labels', one_period: 'one_group',
  periods_unreadable: 'periods', mostly_undated: 'periods', too_many_periods: 'periods',
  no_numbers: 'numbers', unreadable_values: 'numbers', mostly_suppressed: 'numbers',
  mixed_levels: 'totals', totals_unresolved: 'totals',
};

/** Why a chart was set aside, in a few words. */
export function skipReason(reason, t) {
  return t('chart.skip.' + (SKIP_GROUPS[reason] || 'other'));
}

const READING_REASONS = new Set(['code_labels', 'garbled_text', 'period_labels', 'one_value_dominates', 'measure_names', 'mixed_levels',
  'repeated_partitions', 'maintenance_date', 'date_numbers', 'person_names']);

/** What a column was read as, and what that means for charts. */
export function columnReading(column, t) {
  const role = known(t, 'chart.role.' + column.role) || column.role;
  const details = [];
  if (column.measure) {
    if (column.measure.text) details.push(t('chart.detail.text_numbers'));
    if (column.measure.percent) details.push(t('chart.detail.percent'));
    if (column.measure.blocked_by && column.measure.blocked_by.length) {
      details.push(fill(t('chart.detail.blocked'), { column: humanize(column.measure.blocked_by[0]) }));
    } else details.push(t(column.measure.additive === 'yes' || column.measure.additive === 'probable' ? 'chart.detail.adds_up' : 'chart.detail.averaged'));
  }
  if (column.wide) details.push(t('chart.detail.period_column'));
  // What the engine found in the values that keeps a column off the charts, or reads it with care.
  for (const reason of column.reasons || []) {
    const text = reason && known(t, 'chart.detail.' + reason.code);
    if (text && READING_REASONS.has(reason.code)) details.push(text);
  }
  if (column.category && column.category.distinct > 60) details.push(fill(t('chart.detail.many_values'), { distinct: column.category.distinct }));
  if (column.twin) details.push(fill(t(column.twin.hidden ? 'chart.detail.twin_hidden' : 'chart.detail.twin'), { of: humanize(column.twin.of) }));
  return { role, details };
}

/** The sentence above the values a blocked measure can be filtered to. */
export function blockedText(block, t) {
  const key = { units: 'chart.blocked_units', mixed_levels: 'chart.blocked_levels', levels: 'chart.blocked_kinds', breakdowns: 'chart.blocked_breakdowns',
    periods: 'chart.blocked_periods' }[block.why] || 'chart.blocked_mixed';
  return fill(t(key), { measure: humanize(block.measure_label || ''), column: humanize(block.column_label || block.column) });
}

/** A KPI tile: value, label and the small line under it. */
export function kpiText(kpi, t, lang) {
  if (kpi.role === 'rows') return { value: fmtInt(kpi.value, lang), label: t('chart.kpi_rows_scope') };
  if (kpi.role === 'span') return { value: fmtPeriod(kpi.first, kpi.grain, lang) + ' – ' + fmtPeriod(kpi.last, kpi.grain, lang), label: t('chart.kpi_span') };
  if (kpi.role === 'groups') return { value: fmtInt(kpi.value, lang), label: t('chart.kpi_groups'), sub: humanize(kpi.label || kpi.column) };
  if (kpi.role === 'sum' || kpi.role === 'avg') {
    return { value: (kpi.lower_bound ? '≥ ' : '') + fmtNum(kpi.value, lang) + (kpi.percent ? ' %' : ''),
      label: t(kpi.role === 'sum' ? 'chart.kpi_sum' : 'chart.kpi_avg') + (kpi.unit ? ' (' + kpi.unit + ')' : ''), sub: humanize(kpi.label || kpi.column) };
  }
  return null;
}
