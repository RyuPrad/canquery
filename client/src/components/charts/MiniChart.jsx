import { useState, useEffect, useId } from 'react';
import { PALETTE, colorAt } from './theme.js';

// A small, self-contained SVG chart (no Recharts) for the landing-page hero
// teasers, so the chart chunk never loads on the most performance-critical page.
// Each shape draws itself on first paint (donut slices grow, the line traces, the
// bars rise); `animate=false` (reduced motion) renders the final frame instantly.
// `center` (donut total) and `endLabel` (line latest value) overlay real numbers.

const TAU = Math.PI * 2;
const EASE = 'cubic-bezier(0.21,0.6,0.35,1)';
const NUM_FONT = "'Space Grotesk Variable', ui-sans-serif, sans-serif";

function Donut({ points, width, height, drawn, center }) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 11;
  const C = TAU * r;
  const total = points.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const slice = points.slice(0, 6);
  const slices = slice.map((p, i) => {
    const start = slice.slice(0, i).reduce((s, q) => s + Math.max(0, q.value), 0) / total;
    const frac = Math.max(0, p.value) / total;
    return { arc: frac * C, startDeg: start * 360, color: colorAt(i), key: i };
  });
  return (
    <svg width={width} height={height} aria-hidden="true">
      {slices.map((s) => (
        <circle
          key={s.key}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={13}
          transform={`rotate(${-90 + s.startDeg} ${cx} ${cy})`}
          strokeDasharray={drawn ? `${s.arc} ${C - s.arc}` : `0 ${C}`}
          style={{ transition: `stroke-dasharray 0.7s ${EASE}`, transitionDelay: `${s.key * 90}ms` }}
        />
      ))}
      {center ? (
        <text
          x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: 16, fontWeight: 700, fontFamily: NUM_FONT, fill: 'var(--color-base-content)', opacity: drawn ? 1 : 0, transition: 'opacity 0.4s ease 0.5s' }}
        >
          {center}
        </text>
      ) : null}
    </svg>
  );
}

function Line({ points, width, height, drawn, endLabel }) {
  const gid = 'mc-' + useId().replace(/[:]/g, '');
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 10;
  const iw = width - pad * 2;
  const ih = height - pad * 2;
  const step = iw / (points.length - 1 || 1);
  const xy = (v, i) => [pad + i * step, pad + ih - ((v - min) / span) * ih];
  const pts = points.map((p, i) => xy(p.value, i));
  const line = pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const area = line + ` L ${(pad + (points.length - 1) * step).toFixed(1)} ${pad + ih} L ${pad} ${pad + ih} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const c = PALETTE[0];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.26" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} style={{ opacity: drawn ? 1 : 0, transition: 'opacity 0.6s ease 0.2s' }} />
      <path
        d={line} fill="none" stroke={c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} strokeDasharray={1}
        style={{ strokeDashoffset: drawn ? 0 : 1, transition: 'stroke-dashoffset 0.85s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <circle cx={lx} cy={ly} r={3.2} fill={c} style={{ opacity: drawn ? 1 : 0, transition: 'opacity 0.3s ease 0.7s' }} />
      {endLabel ? (
        <text
          x={width - 3} y={13} textAnchor="end"
          style={{ fontSize: 12.5, fontWeight: 700, fontFamily: NUM_FONT, fill: 'var(--color-base-content)', opacity: drawn ? 1 : 0, transition: 'opacity 0.4s ease 0.6s' }}
        >
          {endLabel}
        </text>
      ) : null}
    </svg>
  );
}

function Bars({ points, width, height, drawn }) {
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, 1);
  const pad = 8;
  const n = points.length;
  const gap = n > 8 ? 4 : 6;
  const bw = (width - pad * 2 - gap * (n - 1)) / n;
  const ih = height - pad * 2;
  return (
    <svg width={width} height={height} aria-hidden="true">
      {points.map((p, i) => {
        const h = Math.max(2, (Math.max(0, p.value) / max) * ih);
        const x = pad + i * (bw + gap);
        const y = pad + ih - h;
        return (
          <rect
            key={i}
            x={x} y={y} width={Math.max(1, bw)} height={h} rx={2}
            fill={colorAt(i)}
            style={{
              transform: drawn ? 'scaleY(1)' : 'scaleY(0)',
              transformBox: 'fill-box', transformOrigin: 'bottom',
              transition: `transform 0.55s ${EASE}`, transitionDelay: `${i * 45}ms`
            }}
          />
        );
      })}
    </svg>
  );
}

export default function MiniChart({ kind, points, width = 188, height = 116, animate = true, center = '', endLabel = '' }) {
  const [drawn, setDrawn] = useState(!animate);
  useEffect(() => {
    if (!animate) { setDrawn(true); return undefined; }
    const t = setTimeout(() => setDrawn(true), 40);
    return () => clearTimeout(t);
  }, [animate]);

  if (!points || points.length === 0) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }
  if (kind === 'donut') return <Donut points={points} width={width} height={height} drawn={drawn} center={center} />;
  if (kind === 'bars') return <Bars points={points} width={width} height={height} drawn={drawn} />;
  return <Line points={points} width={width} height={height} drawn={drawn} endLabel={endLabel} />;
}
