import { useState, useEffect } from 'react';
import { queryResource } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';

export default function ChartPanel({ resourceId, q, filters, fields, queryMode }) {
  const { t } = useLang();
  const [chartType, setChartType] = useState('line');

  if (queryMode === 'ingested') {
    return (
      <div className="space-y-2">
        <div className="cq-seg mb-2">
          <button
            className={'cq-seg-btn' + (chartType === 'line' ? ' cq-seg-active' : '')}
            onClick={() => setChartType('line')}
          >
            {t('chart.line')}
          </button>
          <button
            className={'cq-seg-btn' + (chartType === 'bar' ? ' cq-seg-active' : '')}
            onClick={() => setChartType('bar')}
          >
            {t('chart.bar')}
          </button>
        </div>
        {chartType === 'line' ? (
          <LineChart resourceId={resourceId} q={q} filters={filters} fields={fields} />
        ) : (
          <BarChart resourceId={resourceId} q={q} filters={filters} fields={fields} />
        )}
      </div>
    );
  }

  return <LineChart resourceId={resourceId} q={q} filters={filters} fields={fields} />;
}

const selectClass =
  'select select-xs bg-base-200 border-base-content/10 rounded-md font-mono text-[0.72rem]';

// Shared dashed horizontal gridlines - <line> elements on purpose: tests count
// the <rect> bars, so nothing decorative may add rects to the SVG.
function GridLines({ width, ys }) {
  return ys.map((y) => (
    <line
      key={y}
      x1="40"
      x2={width}
      y1={y}
      y2={y}
      stroke="currentColor"
      strokeOpacity="0.07"
      strokeDasharray="4 6"
    />
  ));
}

function LineChart({ resourceId, q, filters, fields }) {
  const { t } = useLang();
  // Type names differ by mode: ingested tables report INTEGER/TIMESTAMPTZ, while
  // datastore fields come straight from CKAN as int4/int8/timestamp/float8.
  // Match both vocabularies so datastore resources stay chartable.
  const xCandidates = fields.filter(
    (f) => f.id !== '_id' && /date|time|int/i.test(f.type)
  );
  // Row order (_id) is a perfectly serviceable X axis when no date or
  // integer column exists - keeps every numeric table chartable.
  const xField = xCandidates[0]?.id || (fields.some((f) => f.id === '_id') ? '_id' : undefined);
  const yCandidates = fields.filter(
    (f) => f.id !== '_id' && f.id !== xField && /int|numeric|float|double|real|money/i.test(f.type)
  );
  const [yField, setYField] = useState(yCandidates[0]?.id || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const filtersKey = JSON.stringify(filters || {});

  useEffect(() => {
    if (!xField || !yField) return;
    let cancelled = false;
    setLoading(true);
    queryResource(resourceId, {
      q,
      filters,
      sort: xField + ' asc',
      limit: 100,
      offset: 0,
    })
      .then((env) => {
        if (!cancelled) {
          setRows(env.data.records);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // filters participates via its serialized form below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, xField, yField]);

  if (!xField || !yCandidates.length) {
    return (
      <div className="text-center text-base-content/50 py-10">{t('chart.no_numeric')}</div>
    );
  }

  const points = rows
    .map((row, i) => ({ x: i, y: Number(row[yField]) }))
    .filter((p) => !Number.isNaN(p.y));

  if (points.length < 2) {
    return (
      <div className="text-center text-base-content/50 py-10">{t('chart.not_enough')}</div>
    );
  }

  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const px = (i) => 40 + (i / Math.max(1, points.length - 1)) * 740;
  const py = (y) => 250 - ((y - minY) / span) * 220;
  const linePoints = points.map((p, i) => px(i) + ',' + py(p.y)).join(' ');
  const areaPath =
    'M' + px(0) + ',250 L' + linePoints.replaceAll(' ', ' L') + ' L' + px(points.length - 1) + ',250 Z';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-base-content/50">{t('chart.y')}:</span>
        <select className={selectClass} value={yField} onChange={(e) => setYField(e.target.value)}>
          {yCandidates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id}
            </option>
          ))}
        </select>
        <span className="text-xs text-base-content/35 ml-auto font-mono">
          X: {xField} · {points.length} {t('resource.rows')}
        </span>
      </div>
      {loading ? (
        <div className="text-center text-base-content/50 py-10">{t('chart.drawing')}</div>
      ) : error ? (
        <div className="alert alert-error">{error.message}</div>
      ) : (
        <svg
          width="100%"
          viewBox="0 0 800 280"
          preserveAspectRatio="none"
          className="w-full h-72 cq-card"
        >
          <defs>
            <linearGradient id="ocAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d52b1e" stopOpacity="0.35" />
              <stop offset="1" stopColor="#d52b1e" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <GridLines width={780} ys={[30, 103, 177, 250]} />
          <path d={areaPath} fill="url(#ocAreaGrad)" />
          <polyline
            points={linePoints}
            fill="none"
            stroke="#ff5d50"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <text x="6" y="34" fill="currentColor" fontSize="11" opacity="0.5" fontFamily="monospace">
            {maxY.toFixed(2)}
          </text>
          <text x="6" y="252" fill="currentColor" fontSize="11" opacity="0.5" fontFamily="monospace">
            {minY.toFixed(2)}
          </text>
        </svg>
      )}
    </div>
  );
}

function BarChart({ resourceId, q, filters, fields }) {
  const { t } = useLang();
  const candidates = fields.filter(f => f.id !== '_id');
  const numericFields = candidates.filter(f => /numeric|integer/i.test(f.type));
  const [xCol, setXCol] = useState(candidates[0]?.id || '');
  const [aggFn, setAggFn] = useState('count');
  const [aggCol, setAggCol] = useState(numericFields[0]?.id || '');
  const [bucket, setBucket] = useState('month');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const xField = candidates.find(f => f.id === xCol);
  const dateX = xField ? /^(DATE|TIMESTAMPTZ)$/i.test(xField.type) : false;
  const filtersKey = JSON.stringify(filters || {});

  useEffect(() => {
    if (!xCol) return;
    if (aggFn !== 'count' && !aggCol) return;
    let cancelled = false;
    setLoading(true);
    queryResource(resourceId, {
      q,
      filters,
      group_by: xCol,
      agg: aggFn,
      agg_column: aggFn === 'count' ? undefined : aggCol,
      bucket: dateX ? bucket : undefined,
      sort: dateX ? 'key asc' : 'value desc',
      limit: 100
    })
      .then((env) => {
        if (!cancelled) {
          setRows(env.data.records);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, xCol, aggFn, aggCol, bucket, dateX]);

  if (candidates.length === 0) {
    return (
      <div className="text-center text-base-content/50 py-10">{t('chart.no_numeric')}</div>
    );
  }

  const bars = rows
    .map(r => ({ key: r.key, value: Number(r.value) }))
    .filter(b => !Number.isNaN(b.value));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-base-content/50">{t('chart.x')}:</span>
        <select className={selectClass} value={xCol} onChange={(e) => setXCol(e.target.value)}>
          {candidates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id}
            </option>
          ))}
        </select>
        <span className="text-xs text-base-content/50">{t('chart.fn')}:</span>
        <select className={selectClass} value={aggFn} onChange={(e) => setAggFn(e.target.value)}>
          <option value="count">count</option>
          <option value="sum" disabled={numericFields.length === 0}>sum</option>
          <option value="avg" disabled={numericFields.length === 0}>avg</option>
          <option value="min">min</option>
          <option value="max">max</option>
        </select>
        {aggFn !== 'count' && (
          <>
            <span className="text-xs text-base-content/50">{t('chart.value_col')}:</span>
            <select
              className={selectClass}
              value={aggCol}
              onChange={(e) => setAggCol(e.target.value)}
              disabled={aggFn === 'count'}
            >
              {(aggFn === 'sum' || aggFn === 'avg' ? numericFields : candidates).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}
                </option>
              ))}
            </select>
          </>
        )}
        {dateX && (
          <>
            <span className="text-xs text-base-content/50">{t('chart.bucket')}:</span>
            <select className={selectClass} value={bucket} onChange={(e) => setBucket(e.target.value)}>
              <option value="year">year</option>
              <option value="month">month</option>
              <option value="day">day</option>
            </select>
          </>
        )}
      </div>
      {loading ? (
        <div className="text-center text-base-content/50 py-10">{t('chart.drawing')}</div>
      ) : error ? (
        <div className="alert alert-error">{error.message}</div>
      ) : bars.length === 0 ? (
        <div className="text-center text-base-content/50 py-10">{t('chart.no_data')}</div>
      ) : (
        <svg
          width="100%"
          viewBox="0 0 800 320"
          preserveAspectRatio="none"
          className="w-full h-80 cq-card"
        >
          <defs>
            <linearGradient id="ocBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ff6a5e" />
              <stop offset="1" stopColor="#b22216" />
            </linearGradient>
          </defs>
          {(() => {
            const vals = bars.map(b => b.value);
            const minY = Math.min(0, ...vals);
            const maxY = Math.max(0, ...vals);
            const span = maxY - minY || 1;
            const y = (v) => 250 - ((v - minY) / span) * 220;
            const y0 = y(0);
            const slot = 740 / bars.length;
            const barW = Math.max(1, slot * 0.8);
            const labelEvery = bars.length > 24 ? Math.ceil(bars.length / 12) : 1;
            const fmtKey = (k) => {
              if (k === null || k === undefined || k === '') return '(empty)';
              const s = String(k);
              const isoLike = /^\d{4}-\d{2}-\d{2}T/.test(s);
              const trimmed = isoLike ? s.slice(0, 10) : s;
              return trimmed.length > 14 ? trimmed.slice(0, 13) + '…' : trimmed;
            };
            return (
              <>
                <GridLines width={780} ys={[30, 103, 177, 250]} />
                <line
                  x1="40"
                  x2="780"
                  y1={y0}
                  y2={y0}
                  stroke="currentColor"
                  strokeOpacity="0.18"
                />
                {bars.map((bar, i) => {
                  const xPos = 40 + i * slot + slot * 0.1;
                  const barY = Math.min(y(bar.value), y0);
                  const barHeight = Math.max(1, Math.abs(y(bar.value) - y0));
                  const keyLabel = bar.key === null || bar.key === undefined || bar.key === '' ? '(empty)' : String(bar.key);
                  return (
                    <g key={i} className="hover:opacity-80">
                      <rect
                        x={xPos}
                        y={barY}
                        width={barW}
                        height={barHeight}
                        rx="2"
                        fill="url(#ocBarGrad)"
                      />
                      <title>{keyLabel}: {bar.value}</title>
                    </g>
                  );
                })}
                {bars.map((bar, i) => {
                  if (i % labelEvery !== 0) return null;
                  const cx = 40 + i * slot + slot * 0.5;
                  return (
                    <text
                      key={'lbl-' + i}
                      x={cx}
                      y={268}
                      fontSize={10}
                      fill="currentColor"
                      opacity={0.5}
                      textAnchor="end"
                      fontFamily="monospace"
                      transform={'rotate(-35 ' + cx + ' 268)'}
                    >
                      {fmtKey(bar.key)}
                    </text>
                  );
                })}
                <text x="6" y="34" fill="currentColor" fontSize="11" opacity="0.5" fontFamily="monospace">
                  {maxY.toFixed(2)}
                </text>
                <text x="6" y="252" fill="currentColor" fontSize="11" opacity="0.5" fontFamily="monospace">
                  {minY.toFixed(2)}
                </text>
              </>
            );
          })()}
        </svg>
      )}
    </div>
  );
}
