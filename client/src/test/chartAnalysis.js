// An answer of the chart engine (GET /web-api/v1/resources/:id/charts), shaped
// like the server's: a statistics table whose only measure is text behind
// "--", with a year column, a month column and provinces in two languages.

export const MODEL = {
  shape: 'statistics',
  rows: 288,
  sample: { rows: 288, complete: true },
  columns: [
    { id: 'EN_YEAR', label: 'EN_YEAR', type: 'INTEGER', role: 'time', confidence: 'high', reasons: [{ code: 'year_values' }], time: { grain: 'year', grains: ['year'] } },
    { id: 'EN_MONTH', label: 'EN_MONTH', type: 'TEXT', role: 'time_part', confidence: 'high', reasons: [{ code: 'time_part' }] },
    { id: 'Province', label: 'Province', type: 'TEXT', role: 'category', confidence: 'high', reasons: [{ code: 'repeating_values' }],
      category: { distinct: 6, breakdown: true }, twin: { of: 'Province_FR', hidden: false } },
    { id: 'Province_FR', label: 'Province_FR', type: 'TEXT', role: 'category', confidence: 'high', reasons: [{ code: 'repeating_values' }],
      category: { distinct: 6, breakdown: true }, twin: { of: 'Province', hidden: true } },
    { id: 'TOTAL', label: 'TOTAL', type: 'TEXT', role: 'measure', confidence: 'medium', reasons: [{ code: 'numeric_text' }],
      measure: { additive: 'yes', text: true, percent: false, blocked_by: [] } },
    { id: 'Rate', label: 'Rate', type: 'NUMERIC', role: 'measure', confidence: 'high', reasons: [{ code: 'numeric_typed' }],
      measure: { additive: 'no', text: false, percent: true, blocked_by: [] } },
    { id: 'Code', label: 'Code', type: 'INTEGER', role: 'code', confidence: 'medium', reasons: [{ code: 'code_name' }], category: { distinct: 9, breakdown: true } },
    { id: 'Notes', label: 'Notes', type: 'TEXT', role: 'text', confidence: 'high', reasons: [{ code: 'long_text' }] },
  ],
  time_axes: [
    { id: 't:EN_YEAR', columns: ['EN_YEAR'], grain: 'year', grains: ['year'], composite: false },
    { id: 't:EN_YEAR+EN_MONTH', columns: ['EN_YEAR', 'EN_MONTH'], grain: 'month', grains: ['month', 'year'], composite: true },
  ],
  wide_groups: [],
  findings: [],
};

const y = { agg: 'sum', column: 'TOTAL', label: 'TOTAL', additive: 'yes', integer: true, lower_bound: true, unit: null, percent: false, currency: false };

export const SHARE = {
  id: 'c_aaaaaaaaaaaa',
  template: 'share_by_category',
  kind: 'donut',
  x: { type: 'category', column: 'Province', label: 'Province' },
  y,
  points: [
    { key: 'ontario', label: 'Ontario', value: 600, rows: 40, share: 0.6 },
    { key: 'quebec', label: 'Quebec', value: 300, rows: 40, share: 0.3 },
    { key: null, label: null, blank: true, value: 100, rows: 8, share: 0.1 },
  ],
  other: null,
  total: 1000,
  scope: { rows: 288, groups_total: 2, groups_shown: 2, complete: true, filtered: false },
  notes: [
    { code: 'numbers_read_from_text', level: 'info', column: 'TOTAL' },
    { code: 'placeholders_left_out', level: 'caution', column: 'TOTAL', cells: 200, share: 0.69, tokens: ['--'] },
    { code: 'not_recorded_group', level: 'info', column: 'Province', rows: 8 },
    { code: 'a_code_from_a_newer_engine', level: 'info' },
  ],
  score: 60,
  fit: { tab: true, card: true, social: true },
  title: { code: 'share_by_category', measure: 'TOTAL', by: 'Province' },
  spec: { kind: 'donut', x: { column: 'Province' }, y: { agg: 'sum', column: 'TOTAL' }, limit: 12 },
};

export const LINE = {
  id: 'c_bbbbbbbbbbbb',
  template: 'measure_over_time',
  kind: 'line',
  x: { type: 'time', axis: 't:EN_YEAR+EN_MONTH', columns: ['EN_YEAR', 'EN_MONTH'], label: 'EN_YEAR + EN_MONTH', grain: 'month' },
  y,
  points: [
    { key: '24228', start: '2019-01-01', value: 10, rows: 6 },
    { key: '24229', start: '2019-02-01', value: 20, rows: 6 },
    { key: '24230', start: '2019-03-01', value: 15, rows: 6 },
    { key: '24231', start: '2019-04-01', value: 30, rows: 6 },
  ],
  other: null,
  total: null,
  time: { grain: 'month', first: '2019-01-01', last: '2019-04-01', periods_total: 4, periods_shown: 4, missing: [] },
  scope: { rows: 288, groups_total: 4, groups_shown: 4, complete: true, filtered: false },
  notes: [{ code: 'composite_time', level: 'info', columns: ['EN_YEAR', 'EN_MONTH'] }],
  score: 58,
  fit: { tab: true, card: false, social: false },
  title: { code: 'measure_over_time', measure: 'TOTAL', by: 'EN_YEAR + EN_MONTH' },
  spec: { kind: 'line', x: { time: 't:EN_YEAR+EN_MONTH', grain: 'month' }, y: { agg: 'sum', column: 'TOTAL' }, limit: 60 },
};

export const ANALYSIS = {
  engine: 1,
  status: 'ok',
  kpis: [
    { role: 'rows', value: 288 },
    { role: 'span', grain: 'month', first: '2019-01-01', last: '2019-04-01' },
    { role: 'sum', column: 'TOTAL', label: 'TOTAL', value: 1000, lower_bound: true, integer: true, percent: false, currency: false, unit: null },
  ],
  charts: [SHARE, LINE],
  skipped: [{ id: 'c_cccccccccccc', template: 'average_by_category', x: { type: 'category', column: 'Province' }, y: { agg: 'avg', column: 'Rate' }, reason: 'flat' }],
  blocked: [],
  model: MODEL,
  builder: { default: SHARE.spec },
  scope: { rows: 288, table_rows: 288, filtered: false, pinned: [], total_rows_left_out: 0, note_rows_left_out: 0 },
};

// A value column that holds a different measure on each row.
export const BLOCKED = {
  ...ANALYSIS,
  status: 'no_charts',
  kpis: [{ role: 'rows', value: 120 }],
  charts: [],
  skipped: [],
  blocked: [{ measure: 'Measure Value', measure_label: 'Measure Value', column: 'Data Point Label', column_label: 'Data Point Label', why: 'mixed_measures',
    values: [{ value: 'Net income', rows: 40, charts: true }, { value: 'Capital ratio', rows: 40, charts: false }], charts: true }],
  model: {
    ...MODEL,
    shape: 'long_measures',
    columns: [
      { id: 'Fiscal Year', label: 'Fiscal Year', type: 'INTEGER', role: 'time', confidence: 'high', reasons: [], time: { grain: 'year', grains: ['year'] } },
      { id: 'Data Point Label', label: 'Data Point Label', type: 'TEXT', role: 'category', confidence: 'high', reasons: [], category: { distinct: 3, breakdown: true } },
      { id: 'Measure Value', label: 'Measure Value', type: 'NUMERIC', role: 'measure', confidence: 'high', reasons: [],
        measure: { additive: 'unknown', text: false, percent: false, blocked_by: ['Data Point Label'] } },
    ],
    time_axes: [{ id: 't:Fiscal Year', columns: ['Fiscal Year'], grain: 'year', grains: ['year'], composite: false }],
  },
  builder: { default: null },
};
