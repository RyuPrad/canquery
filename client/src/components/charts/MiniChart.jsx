import { useState, useEffect } from 'react';
import { useLang } from '../../i18n.jsx';
import { fmtInt, fmtNum, fmtBucketKey } from './theme.js';

// These small homepage charts stay independent of the resource chart bundle.
// Every visual has readable values; only the entry animation is decorative.
const COLORS = [
  'var(--cq-accent-red)', 'var(--color-secondary)', 'var(--color-accent)',
  'var(--cq-chart-slate)', 'var(--cq-chart-purple)', 'var(--cq-chart-olive)',
];
const EASE = 'cubic-bezier(0.21,0.6,0.35,1)';
const finiteValue = point => typeof point?.value === 'number' && Number.isFinite(point.value);
const rangeNormalizer = values => {
  const largest = Math.max(...values.map(Math.abs));
  return 10 ** Math.floor(Math.log10(largest)) || largest || 1;
};
const valueLabel = (value, context, lang) => {
  if (context?.agg === 'count') return fmtInt(value, lang);
  if (Math.abs(value) >= 1e12) return new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    notation: 'scientific', maximumFractionDigits: 2,
  }).format(value);
  return fmtNum(value, lang);
};

function Bars({ points, context, drawn, lang }) {
  const values = points.map(point => point.value);
  const normalizer = rangeNormalizer(values);
  const min = Math.min(0, ...values.map(value => value / normalizer));
  const max = Math.max(0, ...values.map(value => value / normalizer));
  const span = max - min || 1;
  const zero = -min / span * 100;
  return <div className="cq-chart-bars-wrap">
    <ol className="cq-chart-bars">
      {points.map((point, index) => {
        const end = (point.value / normalizer - min) / span * 100;
        return <li className="cq-chart-bar-row" key={point.key ?? point.label} data-value={point.value}>
          <div className="cq-chart-bar-label">
            <span>{point.label}</span>
            <strong>{valueLabel(point.value, context, lang)}</strong>
          </div>
          <div className="cq-chart-bar-track" aria-hidden="true">
            {min < 0 && <span className="cq-chart-zero" style={{ left: `${zero}%` }} />}
            <span className="cq-chart-bar-fill" style={{
              left: `${Math.min(zero, end)}%`, width: `${Math.abs(end - zero)}%`,
              transform: drawn ? 'scaleX(1)' : 'scaleX(0)',
              transformOrigin: point.value < 0 ? 'right' : 'left',
              transition: `transform 0.5s ${EASE}`, transitionDelay: `${index * 45}ms`,
            }} />
          </div>
        </li>;
      })}
    </ol>
    <div className="cq-chart-bar-scale" aria-hidden="true">
      <span>{valueLabel(min * normalizer, context, lang)}</span>
      {min < 0 && max > 0 && zero > 12 && zero < 88 && <span className="cq-chart-scale-zero" style={{ left: `${zero}%` }}>0</span>}
      <span>{valueLabel(max * normalizer, context, lang)}</span>
    </div>
  </div>;
}

function Donut({ points, context, drawn, lang, t }) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (total <= 0 || points.some(point => point.value < 0) || context?.limited || points.length > 6) return null;
  const radius = 58;
  const circumference = Math.PI * 2 * radius;
  const percentage = value => value > 0 && value / total < 0.0001
    ? `${fmtNum(value / total * 100, lang)}${lang === 'fr' ? ' %' : '%'}`
    : new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
      style: 'percent', maximumFractionDigits: 2,
    }).format(value / total);

  return <div className="cq-chart-donut">
    <svg className="cq-chart-ring" viewBox="0 0 150 150" width="150" height="150" aria-hidden="true">
      <circle className="cq-chart-ring-track" cx="75" cy="75" r={radius} fill="none" strokeWidth="14" />
      {points.map((point, index) => {
        const rotation = points.slice(0, index).reduce((sum, previous) => sum + previous.value, 0) / total * 360 - 90;
        const arc = point.value / total * circumference;
        return <circle key={point.key ?? point.label} cx="75" cy="75" r={radius} fill="none"
          stroke={COLORS[index]} strokeWidth="14" transform={`rotate(${rotation} 75 75)`}
          strokeDasharray={drawn ? `${arc} ${circumference - arc}` : `0 ${circumference}`}
          style={{ transition: `stroke-dasharray 0.65s ${EASE}`, transitionDelay: `${index * 50}ms` }} />;
      })}
      <text className="cq-chart-ring-total" x="75" y="73" textAnchor="middle">{fmtInt(total, lang)}</text>
      <text className="cq-chart-ring-unit" x="75" y="92" textAnchor="middle">{t('chart.records')}</text>
    </svg>
    <ul className="cq-chart-legend" aria-label={t('chart.legend')}>
      {points.map((point, index) => <li key={point.key ?? point.label}>
        <span className="cq-chart-legend-dot" style={{ background: COLORS[index] }} aria-hidden="true" />
        <span className="cq-chart-legend-label">{point.label}</span>
        <span className="cq-chart-legend-values">
          <strong>{fmtInt(point.value, lang)}</strong>
          <span>{percentage(point.value)}</span>
        </span>
      </li>)}
    </ul>
  </div>;
}

function timestamp(key) {
  if (typeof key !== 'string' || !key.trim()) return NaN;
  // Numeric year columns are real temporal keys too; Date.parse('2024') is
  // implementation-dependent, so make their UTC interpretation explicit.
  if (/^\d{4}$/.test(key)) return Date.UTC(Number(key), 0, 1);
  return Date.parse(key);
}

function Line({ points, context, width, height, drawn, lang, t }) {
  const numeric = points.map(point => ({ ...point, time: timestamp(point.key) })).filter(point => Number.isFinite(point.time));
  if (numeric.length < 2) return null;
  const seen = new Set(numeric.map(point => point.time));
  const missing = (context?.missing_periods || []).map(key => ({ key, time: timestamp(key), value: null }))
    .filter(point => Number.isFinite(point.time) && !seen.has(point.time));
  const series = [...numeric, ...missing].sort((a, b) => a.time - b.time);
  const firstTime = series[0].time;
  const lastTime = series.at(-1).time;
  const elapsed = lastTime - firstTime;
  if (elapsed <= 0) return null;
  const values = numeric.map(point => point.value);
  // Normalize before subtracting: two finite signed values can have an
  // infinite raw difference. Axis rounding must also stay representable.
  const normalizer = rangeNormalizer(values);
  const min = Math.min(...values.map(value => value / normalizer));
  const max = Math.max(...values.map(value => value / normalizer));
  const rawStep = (max - min || Math.abs(max) || 1) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(context?.agg === 'count' ? 1 / normalizer : 0, [1, 2, 5, 10].find(multiplier => multiplier * magnitude >= rawStep) * magnitude);
  const ceiling = Number.MAX_VALUE / normalizer;
  let low = Math.max(-ceiling, Math.floor(min / step) * step);
  const high = Math.min(ceiling, Math.max(Math.ceil(max / step) * step, low + step));
  if (high <= low) low = Math.max(-ceiling, high - step);
  const gridValues = [high, (high + low) / 2, low].filter((value, index, all) => all.findIndex(other =>
    valueLabel(other * normalizer, { agg: 'avg' }, lang) === valueLabel(value * normalizer, { agg: 'avg' }, lang)) === index);
  const longestTick = Math.max(...gridValues.map(value => valueLabel(value * normalizer, { agg: 'avg' }, lang).length));
  const left = Math.max(52, Math.min(112, longestTick * 10 + 13));
  const right = width - 16;
  const top = 18;
  const bottom = height - 38;
  const x = time => left + (time - firstTime) / elapsed * (right - left);
  const axisY = value => bottom - (value - low) / (high - low) * (bottom - top);
  const y = value => axisY(value / normalizer);
  const path = series.map((point, index) => {
    if (point.value === null) return '';
    const command = index === 0 || series[index - 1].value === null ? 'M' : 'L';
    return `${command}${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`;
  }).filter(Boolean).join(' ');
  const middle = series.reduce((best, point) => Math.abs(point.time - (firstTime + elapsed / 2)) < Math.abs(best.time - (firstTime + elapsed / 2)) ? point : best, series[0]);
  const periodLabel = key => context?.bucket === 'year' || /^\d{4}$/.test(key) ? String(new Date(timestamp(key)).getUTCFullYear())
    : fmtBucketKey(key, context?.bucket || 'day', lang);
  const firstLabelWidth = periodLabel(series[0].key).length * 10;
  const lastLabelWidth = periodLabel(series.at(-1).key).length * 10;
  const ticks = [series[0], middle, series.at(-1)].filter((point, index, all) => all.findIndex(other => other.time === point.time) === index)
    .filter(point => point.time === firstTime || point.time === lastTime ||
      (x(point.time) - periodLabel(point.key).length * 5 > left + firstLabelWidth + 8 &&
       x(point.time) + periodLabel(point.key).length * 5 < right - lastLabelWidth - 8));

  const latest = numeric.reduce((last, point) => point.time > last.time ? point : last, numeric[0]);
  return <div className="cq-chart-line">
    <div className="cq-chart-line-current"><strong>{valueLabel(latest.value, context, lang)}</strong><span>{periodLabel(latest.key)}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {gridValues.map((value, index) => <g key={index}>
        <line className="cq-chart-grid" x1={left} x2={right} y1={axisY(value)} y2={axisY(value)} />
        <text className="cq-chart-axis" x={left - 9} y={axisY(value) + 4} textAnchor="end">{valueLabel(value * normalizer, { agg: 'avg' }, lang)}</text>
      </g>)}
      <path className="cq-chart-line-path" d={path} fill="none" stroke="var(--cq-accent-red)" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1"
        style={{ strokeDashoffset: drawn ? 0 : 1, transition: 'stroke-dashoffset 0.8s ease' }} />
      {numeric.map((point, index) => <circle className="cq-chart-line-point" key={point.key} data-period={point.key}
        cx={x(point.time)} cy={y(point.value)} r={index === numeric.length - 1 ? 3.5 : 2}
        fill="var(--cq-accent-red)" style={{ opacity: drawn ? 1 : 0, transition: 'opacity 0.3s ease 0.55s' }} />)}
      {ticks.map(point => <text className="cq-chart-axis cq-chart-time-tick" key={point.time} x={x(point.time)} y={bottom + 24}
        textAnchor={point.time === firstTime ? 'start' : point.time === lastTime ? 'end' : 'middle'}>{periodLabel(point.key)}</text>)}
    </svg>
    <table className="sr-only">
      <caption>{t('chart.scope')}</caption>
      <thead><tr><th scope="col">{t('chart.period')}</th><th scope="col">{t(context?.agg === 'count' ? 'chart.records' : 'chart.value')}</th></tr></thead>
      <tbody>{series.map(point => <tr key={point.key}><th scope="row">{periodLabel(point.key)}</th>
        <td>{point.value === null ? t('chart.missing_period') : valueLabel(point.value, context, lang)}</td></tr>)}</tbody>
    </table>
  </div>;
}

export default function MiniChart({ kind, points, context, width = 320, height = 216, animate = true }) {
  const { lang, t } = useLang();
  const [drawn, setDrawn] = useState(!animate);
  useEffect(() => {
    if (!animate) { setDrawn(true); return undefined; }
    setDrawn(false);
    const timer = setTimeout(() => setDrawn(true), 40);
    return () => clearTimeout(timer);
  }, [animate]);

  const usable = (points || []).filter(finiteValue);
  if (usable.length < 2) return null;
  if (kind === 'donut') return <Donut points={usable} context={context} drawn={drawn} lang={lang} t={t} />;
  if (kind === 'bars') return <Bars points={usable.slice(0, 5)} context={context} drawn={drawn} lang={lang} />;
  if (kind === 'line') return <Line points={usable} context={context} width={width} height={height} drawn={drawn} lang={lang} t={t} />;
  return null;
}
