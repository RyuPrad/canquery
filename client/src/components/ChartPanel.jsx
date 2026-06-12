import { useState, useEffect } from 'react';
import { queryResource } from '../api/catalog.js';

export default function ChartPanel({ resourceId, q, filters, fields }) {
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
