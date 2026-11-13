import { useState, useEffect, useMemo, useId, useCallback } from 'react';
import { NotIngestedError } from '../api/client.js';
import { fetchCustomChart, queryResource } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { ChartCard, ChartSkeleton, ChartEmpty } from './charts/Visuals.jsx';
import ChartView from './charts/ChartView.jsx';
import { chartTitle, chartSubtitle, skipReason } from './charts/chartText.js';
import { humanize } from './charts/theme.js';
import { customSpec } from '../utils/chartContract.js';
import { track } from '../utils/analytics.js';
import { useChartLoadReport } from '../hooks/useChartLoadReport.js';

const selectClass = 'select select-sm bg-base-200 border-base-content/10 rounded-lg text-xs max-w-[16rem]';
const GROUP_ROLES = new Set(['category', 'code', 'label', 'time_part']);
const NUMERIC_TYPES = new Set(['INTEGER', 'NUMERIC']);
const AGGS = ['count', 'sum', 'avg', 'min', 'max'];
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])));

function Label({ children, htmlFor }) {
  return <label htmlFor={htmlFor} className="text-xs text-base-content/50">{children}</label>;
}

function TypeToggle({ value, onChange, options }) {
  return (
    <div className="cq-seg">
      {options.map((o) => (
        <button key={o.value} className={'cq-seg-btn' + (value === o.value ? ' cq-seg-active' : '')} aria-pressed={value === o.value}
          disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// The builder's choices, from the chart engine's model of the table: time
// axes (a year and a month column count as one), groups, period columns of a
// wide table, and the numbers that can be added up or averaged.
function choicesOf(model, all) {
  const columns = model.columns;
  const shown = (column) => all || !(column.twin && column.twin.hidden);
  const name = (id) => humanize((columns.find((column) => column.id === id) || { label: id }).label || id);
  return {
    name,
    time: (model.time_axes || []).map((axis) => ({ value: axis.id, label: axis.columns.map(name).join(' + '), axis })),
    wide: (model.wide_groups || []).map((group) => ({ value: 'w:' + group.id, group })),
    groups: columns.filter((column) => GROUP_ROLES.has(column.role) && shown(column)).map((column) => ({ value: 'c:' + column.id, column })),
    others: all ? columns.filter((column) => !GROUP_ROLES.has(column.role) && column.role !== 'time').map((column) => ({ value: 'c:' + column.id, column })) : [],
    measures: columns.filter((column) => column.role === 'measure' && shown(column)),
    numbers: all ? columns.filter((column) => column.role !== 'measure' && NUMERIC_TYPES.has(column.type)) : [],
    any: all ? columns.filter((column) => column.role !== 'measure' && !NUMERIC_TYPES.has(column.type)) : [],
  };
}

function initialState(model, spec) {
  if (spec && spec.x && spec.y) {
    if (spec.x.time) return { x: spec.x.time, grain: spec.x.grain || '', agg: spec.y.agg, y: spec.y.column || '', kind: 'bars' };
    if (spec.x.wide) return { x: 'w:' + spec.x.wide, grain: '', agg: spec.y.agg, y: '', kind: 'bars' };
    if (spec.x.column) return { x: 'c:' + spec.x.column, grain: '', agg: spec.y.agg, y: spec.y.column || '', kind: spec.kind === 'donut' ? 'donut' : 'bars' };
  }
  // Nothing was charted automatically: rows over time, or by the first group.
  const axis = (model.time_axes || [])[0];
  if (axis) return { x: axis.id, grain: axis.grain, agg: 'count', y: '', kind: 'bars' };
  const group = model.columns.find((column) => (column.role === 'category' || column.role === 'code') && !(column.twin && column.twin.hidden));
  const first = group || model.columns[0];
  return { x: first ? 'c:' + first.id : '', grain: '', agg: 'count', y: '', kind: 'bars' };
}

// What the error of a chart request means for the reader.
function errorText(error, model, request, t) {
  const code = error?.body?.code;
  if (code === 'CHARTS_BUSY' || error?.status === 429) return t('chart.busy');
  if (code === 'CHARTS_TIMEOUT') return t('chart.timeout');
  if (code === 'CHART_REFUSED') {
    const measure = model.columns.find((column) => column.id === request.y);
    const blocker = measure && measure.measure && measure.measure.blocked_by && measure.measure.blocked_by[0];
    const by = blocker && model.columns.find((column) => column.id === blocker);
    if (measure && by) return fill(t('chart.refused_detail'), { measure: humanize(measure.label || measure.id), column: humanize(by.label || by.id) });
    return t('chart.refused');
  }
  return error?.message || t('chart.no_data');
}

// Ingested resources: a chart built from the table's model.
function ModelBuilder({ resourceId, q, filters, model, initialSpec, onUnavailable }) {
  const { t, lang } = useLang();
  const controlId = useId();
  const [all, setAll] = useState(false);
  const [state, setState] = useState(() => initialState(model, initialSpec));
  const choices = useMemo(() => choicesOf(model, all), [model, all]);
  const change = useCallback((setting, patch) => {
    track('chart_config', { resource_id: resourceId, setting, value: String(Object.values(patch)[0]) });
    setState((previous) => ({ ...previous, ...patch }));
  }, [resourceId]);

  const isTime = state.x.startsWith('t:');
  const isWide = state.x.startsWith('w:');
  const axis = isTime ? choices.time.find((entry) => entry.value === state.x)?.axis : null;
  const grain = axis ? (axis.grains.includes(state.grain) ? state.grain : axis.grain) : null;
  const aggs = isWide ? ['sum', 'avg'] : AGGS;
  const agg = aggs.includes(state.agg) ? state.agg : aggs[0];
  // Numbers to add up or average; any column for the lowest or highest of a group.
  const values = agg === 'count' || isWide ? [] : [...choices.measures, ...choices.numbers,
    ...((agg === 'min' || agg === 'max') && !isTime ? choices.any : [])];
  const y = values.some((column) => column.id === state.y) ? state.y : values[0]?.id || '';
  const yColumn = values.find((column) => column.id === y);
  // The lowest or highest text of a group is read as the table query reads it.
  const plain = Boolean(yColumn) && yColumn.role !== 'measure' && !NUMERIC_TYPES.has(yColumn.type);
  const ready = Boolean(state.x) && (agg === 'count' || isWide || Boolean(y));

  let request = null;
  if (ready && isWide) request = customSpec({ wide: state.x.slice(2), agg });
  else if (ready && isTime) request = customSpec({ time: state.x, grain, agg, column: y });
  else if (ready) {
    request = customSpec({ x: state.x.slice(2), kind: state.kind === 'donut' && (agg === 'count' || agg === 'sum') ? 'donut' : 'bars', agg, column: y });
  }
  const requestKey = JSON.stringify([request, plain]);
  const filtersKey = JSON.stringify(filters || {});

  const [result, setResult] = useState({ key: null, data: null, rows: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const loading = Boolean(request) && result.key !== requestKey + filtersKey + (q || '') + lang + attempt;
  useChartLoadReport('chart', loading ? 'loading' : 'settled');

  useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const key = requestKey + filtersKey + (q || '') + lang + attempt;
    const done = (patch) => { if (!cancelled) setResult({ key, data: null, rows: null, error: null, ...patch }); };
    const failed = (error) => {
      if (cancelled) return;
      done({ error });
      if (error instanceof NotIngestedError) onUnavailable?.();
    };
    if (plain) {
      queryResource(resourceId, { q, filters, group_by: request.x.column, agg: request.y.agg, agg_column: request.y.column, sort: 'value desc', limit: 50 },
        { signal: controller.signal }).then((env) => done({ rows: env.data.records }), failed);
    } else {
      fetchCustomChart(resourceId, request, { q, filters, lang }, { signal: controller.signal }).then((env) => done({ data: env.data }), failed);
    }
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, requestKey, filtersKey, q, lang, attempt]);

  const chart = !loading && result.data ? result.data.chart : null;
  let body;
  if (!ready) body = <ChartEmpty label={t('chart.no_data')} height={320} />;
  else if (loading) body = <ChartSkeleton height={320} />;
  else if (result.error) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 text-center text-sm text-base-content/60" style={{ minHeight: 200 }}>
        <p>{errorText(result.error, model, { y }, t)}</p>
        {['CHARTS_BUSY', 'CHARTS_TIMEOUT'].includes(result.error?.body?.code) &&
          <button type="button" className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>{t('chart.retry')}</button>}
      </div>
    );
  } else if (result.rows) {
    body = (
      <div className="cq-table-wrap">
        <table className="cq-table">
          <thead><tr><th scope="col">{choices.name(request.x.column)}</th><th scope="col">{t('chart.agg.' + agg)} · {choices.name(y)}</th></tr></thead>
          <tbody>{result.rows.map((row, index) => <tr key={index}><td>{row.key == null ? '∅' : String(row.key)}</td><td>{row.value == null ? '∅' : String(row.value)}</td></tr>)}</tbody>
        </table>
      </div>
    );
  } else if (chart) body = <ChartView chart={chart} framed={false} height={320} />;
  else body = <ChartEmpty label={fill(t('chart.builder.none'), { reason: skipReason(result.data?.reason || 'no_groups', t) })} height={320} />;

  const optionLabel = (column) => humanize(column.label || column.id) + (column.measure && column.measure.text ? ' (' + t('chart.builder.text_numbers') + ')' : '');
  return (
    <ChartCard title={chart ? chartTitle(chart, t) : t('chart.custom')} subtitle={chart ? chartSubtitle(chart, t, lang) : undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
        <Label htmlFor={controlId + '-x'}>{t('chart.x')}</Label>
        <select id={controlId + '-x'} className={selectClass} value={state.x} onChange={(event) => change('group_by', { x: event.target.value })}>
          {choices.time.length > 0 && (
            <optgroup label={t('chart.builder.time')}>
              {choices.time.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </optgroup>
          )}
          {choices.wide.length > 0 && (
            <optgroup label={t('chart.builder.periods')}>
              {choices.wide.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {(entry.group.stem ? humanize(entry.group.stem) : t('chart.builder.periods')) + ' (' + entry.group.columns + ' × ' + t('chart.grain.' + entry.group.grain) + ')'}
                </option>
              ))}
            </optgroup>
          )}
          {choices.groups.length > 0 && (
            <optgroup label={t('chart.builder.categories')}>
              {choices.groups.map((entry) => <option key={entry.value} value={entry.value}>{humanize(entry.column.label || entry.column.id)}</option>)}
            </optgroup>
          )}
          {choices.others.length > 0 && (
            <optgroup label={t('chart.builder.other')}>
              {choices.others.map((entry) => <option key={entry.value} value={entry.value}>{humanize(entry.column.label || entry.column.id)}</option>)}
            </optgroup>
          )}
        </select>
        {axis && axis.grains.length > 1 && (
          <>
            <Label htmlFor={controlId + '-grain'}>{t('chart.builder.grain')}</Label>
            <select id={controlId + '-grain'} className={selectClass} value={grain} onChange={(event) => change('bucket', { grain: event.target.value })}>
              {axis.grains.map((entry) => <option key={entry} value={entry}>{t('chart.grain.' + entry)}</option>)}
            </select>
          </>
        )}
        <Label htmlFor={controlId + '-agg'}>{t('chart.fn')}</Label>
        <select id={controlId + '-agg'} className={selectClass} value={agg} onChange={(event) => change('aggregation', { agg: event.target.value })}>
          {aggs.map((entry) => (
            <option key={entry} value={entry} disabled={entry !== 'count' && !isWide && !choices.measures.length && !choices.numbers.length && !(entry === 'min' || entry === 'max')}>
              {t('chart.agg.' + entry)}
            </option>
          ))}
        </select>
        {values.length > 0 && (
          <>
            <Label htmlFor={controlId + '-value'}>{t('chart.value_col')}</Label>
            <select id={controlId + '-value'} className={selectClass} value={y} onChange={(event) => change('value_column', { y: event.target.value })}>
              {values.map((column) => <option key={column.id} value={column.id}>{optionLabel(column)}</option>)}
            </select>
          </>
        )}
        <label className="label cursor-pointer gap-1.5 text-xs text-base-content/60">
          <input type="checkbox" className="checkbox checkbox-xs" checked={all} onChange={(event) => {
            track('chart_config', { resource_id: resourceId, setting: 'all_columns', value: String(event.target.checked) });
            setAll(event.target.checked);
          }} />
          {t('chart.builder.all_columns')}
        </label>
        {!isTime && !isWide && !plain && (
          <div className="ml-auto">
            <TypeToggle value={state.kind === 'donut' && (agg === 'count' || agg === 'sum') ? 'donut' : 'bars'}
              onChange={(value) => change('chart_type', { kind: value })}
              options={[{ value: 'bars', label: t('chart.type_bars') },
                { value: 'donut', label: t('chart.type_donut'), disabled: !(agg === 'count' || agg === 'sum') }]} />
          </div>
        )}
      </div>
      {body}
    </ChartCard>
  );
}

export default function ChartBuilder({ resourceId, q, filters, queryMode, model, initialSpec, onUnavailable }) {
  const { t } = useLang();
  if (queryMode !== 'ingested') return <ChartEmpty label={t('preparation.chart_unavailable')} height={200} />;
  if (!model || !Array.isArray(model.columns) || !model.columns.length) return <ChartEmpty label={t('chart.profile_failed')} height={200} />;
  return <ModelBuilder resourceId={resourceId} q={q} filters={filters} model={model} initialSpec={initialSpec} onUnavailable={onUnavailable} />;
}
