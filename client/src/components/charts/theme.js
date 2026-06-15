// Visual language for every chart, derived from the "northern observatory"
// palette in index.css so Recharts output matches the hand-built UI: maple red
// leads, then aurora teal / ice blue and a spread of distinguishable hues for
// categorical slices on the deep blue-black canvas.
export const PALETTE = [
  '#ff5d50', // maple red (primary, brightened)
  '#2dd4bf', // aurora teal (secondary)
  '#6aa6ff', // ice blue (accent)
  '#f6c453', // amber
  '#c084fc', // violet
  '#fb7185', // rose
  '#34d399', // emerald
  '#f59e0b', // gold
  '#818cf8', // indigo
  '#22d3ee', // cyan
  '#a3e635', // lime
  '#fb923c', // orange
];

export const colorAt = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

// Chart chrome is theme-aware: light-on-dark in dark mode, dark-on-light in
// light mode. The categorical PALETTE above reads on both. Pass `dark` from
// useTheme() so charts re-render with the right chrome on toggle.
export const axisTick = (dark) => ({
  fill: dark ? 'rgba(230,238,250,0.45)' : 'rgba(20,30,52,0.55)',
  fontSize: 11,
  fontFamily: MONO,
});

export const gridStroke = (dark) => (dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.09)');
export const sliceStroke = (dark) => (dark ? 'rgba(10,14,22,0.65)' : '#ffffff');
export const cursorFill = (dark) => (dark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.05)');
export const tooltipMuted = (dark) => (dark ? 'rgba(230,238,250,0.6)' : 'rgba(20,30,52,0.62)');
export const tooltipValue = (dark) => (dark ? '#ffffff' : '#0c1422');

export const tooltipStyle = (dark) => ({
  background: dark ? 'rgba(17,23,38,0.96)' : 'rgba(255,255,255,0.98)',
  border: '1px solid ' + (dark ? '#1c2435' : '#e3e9f1'),
  borderRadius: '0.75rem',
  boxShadow: dark ? '0 10px 30px -10px rgba(0,0,0,0.6)' : '0 10px 30px -12px rgba(15,23,42,0.25)',
  fontSize: '0.78rem',
  fontFamily: MONO,
  padding: '0.5rem 0.7rem',
});

const localeFor = (lang) => (lang === 'fr' ? 'fr-CA' : 'en-CA');

// Counts read clearest fully separated ("643,730"); large measure sums get
// compact notation ("1.2M") so a KPI tile never overflows.
export function fmtInt(n, lang) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return new Intl.NumberFormat(localeFor(lang)).format(Math.round(Number(n)));
}

export function fmtNum(n, lang) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 100000 || (abs > 0 && abs < 0.01)) {
    return new Intl.NumberFormat(localeFor(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 2 }).format(v);
}

// Bucketed time-series keys arrive as ISO timestamps; collapse them to the
// coarsest label the bucket implies.
export function fmtBucketKey(key, bucket, lang) {
  if (key === null || key === undefined || key === '') return '-';
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return String(key);
  const loc = localeFor(lang);
  if (bucket === 'year') return String(d.getUTCFullYear());
  if (bucket === 'day') return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function fmtCategory(key) {
  if (key === null || key === undefined || key === '') return '(empty)';
  return String(key);
}

export function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// Sanitized column ids look like "incorporation_date" / "governing_legislation".
// Make them presentable without mangling acronyms (light touch: underscores →
// spaces, capitalize the first letter only).
export function humanize(id) {
  const s = String(id || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function yearOf(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : String(d.getUTCFullYear());
}

// Maps a KPI spec (from classify.buildKpis) to display { value, label, sub }.
// Lives here (not in a component file) so both KpiRow and InsightCard can share
// it without tripping react-refresh's component-only-exports rule.
export function kpiView(kpi, lang, t) {
  if (kpi.role === 'rows') return { value: fmtInt(kpi.value, lang), label: t('chart.kpi_rows') };
  if (kpi.role === 'distinct') return { value: fmtInt(kpi.value, lang), label: t('chart.kpi_categories'), sub: humanize(kpi.column) };
  if (kpi.role === 'avg') return { value: fmtNum(kpi.value, lang), label: t('chart.kpi_avg'), sub: humanize(kpi.column) };
  return { value: yearOf(kpi.min) + '–' + yearOf(kpi.max), label: t('chart.kpi_span'), sub: humanize(kpi.column) };
}

// Real catalogue files carry footnote/source rows that ingest as data with null
// metric values (and an empty key). Drop points with no usable value so a chart
// never shows a paragraph-long axis label sitting at zero. A genuine 0 is kept.
export function cleanRecords(records) {
  return (records || []).filter(
    (r) => r && r.value !== null && r.value !== undefined && r.value !== '' && Number.isFinite(Number(r.value))
  );
}
