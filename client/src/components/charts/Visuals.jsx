import { useId } from 'react';
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useTheme } from '../../theme.jsx';
import {
  PALETTE, colorAt, axisTick, gridStroke, tooltipStyle, sliceStroke, cursorFill, tooltipMuted, tooltipValue,
  fmtInt, fmtNum, fmtBucketKey, fmtCategory, truncate,
} from './theme.js';

// ── Shared tooltip ────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, lang }) {
  const { dark } = useTheme();
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload || {};
  return (
    <div style={tooltipStyle(dark)}>
      <div style={{ color: tooltipMuted(dark), marginBottom: 2 }}>{p.label}</div>
      <div style={{ color: tooltipValue(dark), fontWeight: 600 }}>
        {fmtNum(p.value, lang)}
        {p.pct != null ? '  ·  ' + p.pct + '%' : ''}
      </div>
    </div>
  );
}

// ── Layout / state helpers ──────────────────────────────────────────────────
export function ChartCard({ title, subtitle, accent, action, children, className = '' }) {
  return (
    <div className={'cq-card p-4 sm:p-5 space-y-3 ' + className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-semibold tracking-tight text-[0.97rem] flex items-center gap-2">
            {accent != null && (
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorAt(accent) }} />
            )}
            <span className="truncate">{title}</span>
          </h3>
          {subtitle && <p className="text-xs text-base-content/45 font-mono mt-0.5 truncate">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }) {
  return <div className="cq-skel rounded-xl w-full" style={{ height }} />;
}

export function ChartEmpty({ label, height = 260 }) {
  return (
    <div className="flex items-center justify-center text-center text-base-content/40 text-sm"
         style={{ height }}>
      {label}
    </div>
  );
}

export function KpiCard({ label, value, sub, accent = 0, icon }) {
  return (
    <div className="cq-card p-4 flex items-center gap-3.5">
      <span className="w-11 h-11 rounded-xl inline-flex items-center justify-center shrink-0"
            style={{ background: colorAt(accent) + '22', color: colorAt(accent) }}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[1.35rem] leading-none font-display font-bold tabular-nums tracking-tight truncate">
          {value}
        </div>
        <div className="text-[0.72rem] text-base-content/50 mt-1 truncate">{label}</div>
        {sub && <div className="text-[0.68rem] text-base-content/35 font-mono truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ── Donut (proportions) ─────────────────────────────────────────────────────
export function DonutChart({ records, lang, colorOffset = 0, totalLabel, height = 260 }) {
  const { dark } = useTheme();
  const total = records.reduce((s, r) => s + Number(r.value || 0), 0);
  const data = records.map((r, i) => ({
    label: fmtCategory(r.key),
    value: Number(r.value || 0),
    pct: total ? Math.round((Number(r.value || 0) / total) * 1000) / 10 : 0,
    color: colorAt(colorOffset + i),
  }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(0,9rem)] gap-2 items-center">
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="88%"
                 paddingAngle={1.5} stroke={sliceStroke(dark)} strokeWidth={2} startAngle={90} endAngle={-270}>
              {data.map((d) => <Cell key={d.label} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip lang={lang} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-display font-bold tabular-nums leading-none">{fmtInt(total, lang)}</span>
          {totalLabel && <span className="text-[0.66rem] text-base-content/40 mt-1">{totalLabel}</span>}
        </div>
      </div>
      <ul className="space-y-1.5 text-xs max-h-[260px] overflow-auto pr-1">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
            <span className="truncate text-base-content/70" title={d.label}>{d.label}</span>
            <span className="ml-auto tabular-nums font-mono text-base-content/45">{d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Horizontal category bars ────────────────────────────────────────────────
export function CategoryBar({ records, lang, colorOffset = 0, height = 260 }) {
  const { dark } = useTheme();
  const gradId = useId();
  const base = colorAt(colorOffset);
  const data = records.map((r) => ({ label: fmtCategory(r.key), value: Number(r.value || 0) }));
  const dynamicHeight = Math.max(height, data.length * 26 + 24);

  return (
    <ResponsiveContainer width="100%" height={Math.min(dynamicHeight, 460)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 18, top: 4, bottom: 4 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={base} stopOpacity={0.5} />
            <stop offset="1" stopColor={base} stopOpacity={1} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} stroke={gridStroke(dark)} />
        <XAxis type="number" tick={axisTick(dark)} tickLine={false} axisLine={false}
               tickFormatter={(v) => fmtNum(v, lang)} />
        <YAxis type="category" dataKey="label" width={132} tick={axisTick(dark)} tickLine={false} axisLine={false}
               interval={0} tickFormatter={(v) => truncate(v, 20)} />
        <Tooltip cursor={{ fill: cursorFill(dark) }} content={<ChartTooltip lang={lang} />} />
        <Bar dataKey="value" fill={'url(#' + gradId + ')'} radius={[0, 6, 6, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Time series (area or line over buckets) ─────────────────────────────────
export function TimeSeriesChart({ records, lang, bucket, type = 'area', categorical = false, colorOffset = 0, height = 260 }) {
  const { dark } = useTheme();
  const gradId = useId();
  const color = colorAt(colorOffset);
  const data = records.map((r) => ({
    label: categorical ? fmtCategory(r.key) : fmtBucketKey(r.key, bucket, lang),
    value: Number(r.value || 0),
  }));

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={gridStroke(dark)} />
      <XAxis dataKey="label" tick={axisTick(dark)} tickLine={false} axisLine={false} minTickGap={26} />
      <YAxis tick={axisTick(dark)} tickLine={false} axisLine={false} width={46}
             tickFormatter={(v) => fmtNum(v, lang)} />
      <Tooltip cursor={{ stroke: color, strokeOpacity: 0.35 }} content={<ChartTooltip lang={lang} />} />
    </>
  );

  if (type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          {axes}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.2}
                dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.42} />
            <stop offset="1" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {axes}
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2}
              fill={'url(#' + gradId + ')'} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export { PALETTE };
