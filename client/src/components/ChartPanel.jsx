import { useState, useEffect } from 'react';
import { queryResource } from '../api/catalog.js';

export default function ChartPanel({ resourceId, q, filters, fields, queryMode }) {
  const [chartType, setChartType] = useState('line');

  if (queryMode === 'ingested') {
    return (
      <div className="space-y-2">
        <div className="tabs tabs-boxed w-fit mb-2">
          <button
            className={`tab tab-sm${chartType === 'line' ? ' tab-active' : ''}`}
            onClick={() => setChartType('line')}
          >
            Line
          </button>
          <button
            className={`tab tab-sm${chartType === 'bar' ? ' tab-active' : ''}`}
            onClick={() => setChartType('bar')}
          >
            Bar
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

function LineChart({ resourceId, q, filters, fields }) {
  const xCandidates = fields.filter(
    (f) => f.id !== '_id' && /date|timestamptz|integer/i.test(f.type)
  );
  // Row order (_id) is a perfectly serviceable X axis when no date or
  // integer column exists - keeps every numeric table chartable.
  const xField = xCandidates[0]?.id || (fields.some((f) => f.id === '_id') ? '_id' : undefined);
  const yCandidates = fields.filter(
    (f) => f.id !== '_id' && f.id !== xField && /numeric|integer/i.test(f.type)
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
      <div className="text-center opacity-60 py-10">
        No numeric columns to chart in this table.
      </div>
    );
  }

  const points = rows
    .map((row, i) => ({ x: i, y: Number(row[yField]) }))
    .filter((p) => !Number.isNaN(p.y));

  if (points.length < 2) {
    return (
      <div className="text-center opacity-60 py-10">
        Not enough numeric data to draw a chart.
      </div>
    );
  }

  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const px = (i) => 40 + (i / Math.max(1, points.length - 1)) * 740;
  const py = (y) => 250 - ((y - minY) / span) * 220;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs opacity-60">Y axis:</span>
        <select
          className="select select-bordered select-xs"
          value={yField}
          onChange={(e) => setYField(e.target.value)}
        >
          {yCandidates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id}
            </option>
          ))}
        </select>
        <span className="text-xs opacity-40 ml-auto">
          X: {xField} (first {points.length} rows)
        </span>
      </div>
      {loading ? (
        <div className="text-center opacity-60 py-10">Drawing chart...</div>
      ) : error ? (
        <div className="alert alert-error">{error.message}</div>
      ) : (
        <svg
          width="100%"
          viewBox="0 0 800 280"
          preserveAspectRatio="none"
          className="w-full h-72 bg-base-200 rounded-lg"
        >
          <polyline
            points={points.map((p, i) => px(i) + ',' + py(p.y)).join(' ')}
            fill="none"
            stroke="#d52b1e"
            strokeWidth="2"
          />
          <text x="6" y="34" fill="currentColor" fontSize="11" opacity="0.6">
            {maxY.toFixed(2)}
          </text>
          <text x="6" y="252" fill="currentColor" fontSize="11" opacity="0.6">
            {minY.toFixed(2)}
          </text>
        </svg>
      )}
    </div>
  );
}

function BarChart({ resourceId, q, filters, fields }) {
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
      <div className="text-center opacity-60 py-10">
        No columns to chart in this table.
      </div>
    );
  }

  const bars = rows
    .map(r => ({ key: r.key, value: Number(r.value) }))
    .filter(b => !Number.isNaN(b.value));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs opacity-60">X axis:</span>
        <select
          className="select select-bordered select-xs"
          value={xCol}
          onChange={(e) => setXCol(e.target.value)}
        >
          {candidates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id}
            </option>
          ))}
        </select>
        <span className="text-xs opacity-60">Function:</span>
        <select
          className="select select-bordered select-xs"
          value={aggFn}
          onChange={(e) => setAggFn(e.target.value)}
        >
          <option value="count">count</option>
          <option value="sum" disabled={numericFields.length === 0}>sum</option>
          <option value="avg" disabled={numericFields.length === 0}>avg</option>
          <option value="min">min</option>
          <option value="max">max</option>
        </select>
        {aggFn !== 'count' && (
          <>
            <span className="text-xs opacity-60">Value column:</span>
            <select
              className="select select-bordered select-xs"
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
            <span className="text-xs opacity-60">Bucket:</span>
            <select
              className="select select-bordered select-xs"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
            >
              <option value="year">year</option>
              <option value="month">month</option>
              <option value="day">day</option>
            </select>
          </>
        )}
      </div>
      {loading ? (
        <div className="text-center opacity-60 py-10">Drawing chart...</div>
      ) : error ? (
        <div className="alert alert-error">{error.message}</div>
      ) : bars.length === 0 ? (
        <div className="text-center opacity-60 py-10">No data to chart.</div>
      ) : (
        <svg
          width="100%"
          viewBox="0 0 800 320"
          preserveAspectRatio="none"
          className="w-full h-80 bg-base-200 rounded-lg"
        >
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
                {bars.map((bar, i) => {
                  const xPos = 40 + i * slot + slot * 0.1;
                  const barY = Math.min(y(bar.value), y0);
                  const barHeight = Math.max(1, Math.abs(y(bar.value) - y0));
                  const keyLabel = bar.key === null || bar.key === undefined || bar.key === '' ? '(empty)' : String(bar.key);
                  return (
                    <g key={i}>
                      <rect
                        x={xPos}
                        y={barY}
                        width={barW}
                        height={barHeight}
                        fill="#d52b1e"
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
                      opacity={0.6}
                      textAnchor="end"
                      transform={'rotate(-35 ' + cx + ' 268)'}
                    >
                      {fmtKey(bar.key)}
                    </text>
                  );
                })}
                <text x="6" y="34" fill="currentColor" fontSize="11" opacity="0.6">
                  {maxY.toFixed(2)}
                </text>
                <text x="6" y="252" fill="currentColor" fontSize="11" opacity="0.6">
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
