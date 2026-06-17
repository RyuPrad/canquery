// A tiny inline-SVG sparkline (no Recharts) for the dense Top 100 list rows, so
// ~97 of them stay cheap. Colour follows currentColor - callers theme it with a
// text-* class that flips in light/dark via daisyUI tokens.
export default function Sparkline({ values, width = 96, height = 28, strokeWidth = 1.5, className = '' }) {
  const nums = (values || []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  const pad = strokeWidth + 1;

  if (nums.length === 0) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }
  if (nums.length === 1) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <circle cx={width / 2} cy={height / 2} r={strokeWidth * 1.4} fill="currentColor" />
      </svg>
    );
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;
  const step = innerW / (nums.length - 1);
  const xy = (v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y];
  };
  const points = nums.map((v, i) => xy(v, i).map((n) => n.toFixed(2)).join(',')).join(' ');
  const [lastX, lastY] = xy(nums[nums.length - 1], nums.length - 1);

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX.toFixed(2)} cy={lastY.toFixed(2)} r={strokeWidth * 1.3} fill="currentColor" />
    </svg>
  );
}
