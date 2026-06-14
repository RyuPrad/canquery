import { useState, useEffect, useMemo, useRef } from 'react';
import { queryResource } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import {
  ChartCard, ChartSkeleton, ChartEmpty,
  DonutChart, CategoryBar, TimeSeriesChart,
} from './charts/Visuals.jsx';
import { humanize, cleanRecords } from './charts/theme.js';

const selectClass = 'select select-sm bg-base-200 border-base-content/10 rounded-lg font-mono text-xs';
const NUM_RE = /int|numeric|float|double|money|real|decimal/i;
const DATE_RE = /date|time/i;
const BAD_DEFAULT_RE = /(^|[_\s])(id|uuid|guid|code|number|num|no|key|name|title)([_\s]|$)/i;

function Label({ children }) {
  return <span className="text-xs text-base-content/50">{children}</span>;
}

function TypeToggle({ value, onChange, options }) {
  return (
    <div className="cq-seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={'cq-seg-btn' + (value === o.value ? ' cq-seg-active' : '')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function pickDefaultGroup(cols) {
  const text = cols.find((c) => !NUM_RE.test(c.type) && !DATE_RE.test(c.type) && !BAD_DEFAULT_RE.test(c.id));
  if (text) return text.id;
  const cat = cols.find((c) => !BAD_DEFAULT_RE.test(c.id));
  return (cat || cols[0])?.id || '';
}

// Seed the builder from the shared classification so its first view is already
// meaningful (a time series for metric tables, a donut/bar for categoricals) -
// never a count grouped by a unique key.
function initialConfig(cols, classified) {
  if (classified) {
    const time = classified.dates[0];
    const dim = classified.dimensions[0];
    const m0 = classified.measures[0];
    if (time && m0) return { groupBy: time.id, agg: 'avg', aggCol: m0.id, chartType: 'line', bucket: time.bucket || 'year' };
    if (dim) return { groupBy: dim.id, agg: 'count', aggCol: '', chartType: dim.distinct <= 6 ? 'donut' : 'bars', bucket: 'year' };
    if (time) return { groupBy: time.id, agg: 'count', aggCol: '', chartType: 'line', bucket: time.bucket || 'year' };
  }
  return { groupBy: pickDefaultGroup(cols), agg: 'count', aggCol: '', chartType: 'bars', bucket: 'year' };
}

// Ingested resources: full group-by + aggregate builder.
function AggregateBuilder({ resourceId, q, filters, fields, classified }) {
  const { t, lang } = useLang();
  const cols = useMemo(() => fields.filter((f) => f.id !== '_id'), [fields]);
  const numericCols = useMemo(() => cols.filter((c) => NUM_RE.test(c.type)), [cols]);
  const init = useMemo(() => initialConfig(cols, classified), [cols, classified]);

  const [groupBy, setGroupBy] = useState(init.groupBy);
  const [agg, setAgg] = useState(init.agg);
  const [aggCol, setAggCol] = useState(init.aggCol || numericCols[0]?.id || '');
  const [bucket, setBucket] = useState(init.bucket);
  const [chartType, setChartType] = useState(init.chartType);

  const groupCol = cols.find((c) => c.id === groupBy);
  const isDate = groupCol ? DATE_RE.test(groupCol.type) : false;
  const wantsAggCol = agg !== 'count';

  // When the user switches group-by to/from a date, follow with a sensible chart
  // type - but don't clobber the smart initial choice (e.g. a donut) on mount.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setChartType(isDate ? 'line' : 'bars');
  }, [isDate]);
  // sum/avg need a numeric target.
  useEffect(() => {
    if ((agg === 'sum' || agg === 'avg') && !numericCols.some((c) => c.id === aggCol)) {
      setAggCol(numericCols[0]?.id || '');
    }
  }, [agg, aggCol, numericCols]);

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const filtersKey = JSON.stringify(filters || {});

  useEffect(() => {
    if (!groupBy) return;
    if (wantsAggCol && !aggCol) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    const isLine = chartType === 'line';
    queryResource(resourceId, {
      q,
      filters,
      group_by: groupBy,
      agg,
      agg_column: wantsAggCol ? aggCol : undefined,
      bucket: isDate ? bucket : undefined,
      sort: (isDate || isLine) ? 'key asc' : 'value desc',
      limit: chartType === 'donut' ? 16 : (isDate ? 200 : 50),
    })
      .then((env) => { if (!cancelled) setRows(cleanRecords(env.data.records)); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, groupBy, agg, aggCol, bucket, isDate, chartType, wantsAggCol]);

  const aggColOptions = (agg === 'sum' || agg === 'avg') ? numericCols : cols;

  let body;
  if (error) body = <ChartEmpty label={error.message || t('chart.no_data')} height={320} />;
  else if (rows === null) body = <ChartSkeleton height={320} />;
  else if (!rows.length) body = <ChartEmpty label={t('chart.no_data')} height={320} />;
  else if (chartType === 'donut') body = <DonutChart records={rows} lang={lang} height={320} totalLabel={t('chart.total')} />;
  else if (chartType === 'line') body = <TimeSeriesChart records={rows} lang={lang} bucket={isDate ? bucket : null} categorical={!isDate} type="area" height={320} />;
  else body = <CategoryBar records={rows} lang={lang} height={320} />;

  const title = agg === 'count' ? humanize(groupBy) : humanize(aggCol);
  const subtitle = agg === 'count'
    ? t('chart.role_share')
    : agg + ' ' + t('chart.by') + ' ' + humanize(groupBy);

  return (
    <ChartCard title={title} subtitle={subtitle}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
        <Label>{t('chart.x')}</Label>
        <select className={selectClass} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
          {cols.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
        <Label>{t('chart.fn')}</Label>
        <select className={selectClass} value={agg} onChange={(e) => setAgg(e.target.value)}>
          <option value="count">count</option>
          <option value="sum" disabled={numericCols.length === 0}>sum</option>
          <option value="avg" disabled={numericCols.length === 0}>avg</option>
          <option value="min">min</option>
          <option value="max">max</option>
        </select>
        {wantsAggCol && (
          <>
            <Label>{t('chart.value_col')}</Label>
            <select className={selectClass} value={aggCol} onChange={(e) => setAggCol(e.target.value)}>
              {aggColOptions.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
          </>
        )}
        {isDate && (
          <>
            <Label>{t('chart.bucket')}</Label>
            <select className={selectClass} value={bucket} onChange={(e) => setBucket(e.target.value)}>
              <option value="year">year</option>
              <option value="month">month</option>
              <option value="day">day</option>
            </select>
          </>
        )}
        <div className="ml-auto">
          <TypeToggle
            value={chartType}
            onChange={setChartType}
            options={[
              { value: 'bars', label: t('chart.type_bars') },
              { value: 'donut', label: t('chart.type_donut') },
              { value: 'line', label: t('chart.type_line') },
            ]}
          />
        </div>
      </div>
      {body}
    </ChartCard>
  );
}

// Datastore resources can't aggregate (CKAN limitation): plot a numeric column
// against an X column over the current page, the way the old explorer did - but
// with the new themed visuals.
function SeriesBuilder({ resourceId, q, filters, fields }) {
  const { t, lang } = useLang();
  const cols = useMemo(() => fields.filter((f) => f.id !== '_id'), [fields]);
  const numericCols = useMemo(() => cols.filter((c) => NUM_RE.test(c.type)), [cols]);

  const [xField, setXField] = useState(() => (cols.find((c) => DATE_RE.test(c.type))?.id) || cols[0]?.id || '');
  const [yField, setYField] = useState(numericCols[0]?.id || '');
  const [chartType, setChartType] = useState('line');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const filtersKey = JSON.stringify(filters || {});

  useEffect(() => {
    if (!xField || !yField) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    queryResource(resourceId, { q, filters, sort: xField + ' asc', limit: 200, offset: 0 })
      .then((env) => {
        if (cancelled) return;
        setRows(env.data.records
          .map((r) => ({ key: r[xField], value: Number(r[yField]) }))
          .filter((p) => !Number.isNaN(p.value)));
      })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, xField, yField]);

  if (!numericCols.length) return <ChartEmpty label={t('chart.no_numeric')} height={300} />;

  let body;
  if (error) body = <ChartEmpty label={error.message || t('chart.no_data')} height={320} />;
  else if (rows === null) body = <ChartSkeleton height={320} />;
  else if (rows.length < 2) body = <ChartEmpty label={t('chart.not_enough')} height={320} />;
  else if (chartType === 'bars') body = <CategoryBar records={rows} lang={lang} height={320} />;
  else body = <TimeSeriesChart records={rows} lang={lang} categorical type={chartType === 'area' ? 'area' : 'line'} height={320} />;

  return (
    <ChartCard title={humanize(yField)} subtitle={t('chart.by') + ' ' + humanize(xField)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
        <Label>{t('chart.x')}</Label>
        <select className={selectClass} value={xField} onChange={(e) => setXField(e.target.value)}>
          {cols.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
        <Label>{t('chart.y')}</Label>
        <select className={selectClass} value={yField} onChange={(e) => setYField(e.target.value)}>
          {numericCols.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
        </select>
        <div className="ml-auto">
          <TypeToggle
            value={chartType}
            onChange={setChartType}
            options={[
              { value: 'line', label: t('chart.type_line') },
              { value: 'area', label: t('chart.type_area') },
              { value: 'bars', label: t('chart.type_bars') },
            ]}
          />
        </div>
      </div>
      {body}
    </ChartCard>
  );
}

export default function ChartBuilder({ resourceId, q, filters, fields, queryMode, classified }) {
  if (queryMode === 'ingested') {
    return <AggregateBuilder resourceId={resourceId} q={q} filters={filters} fields={fields} classified={classified} />;
  }
  return <SeriesBuilder resourceId={resourceId} q={q} filters={filters} fields={fields} />;
}
