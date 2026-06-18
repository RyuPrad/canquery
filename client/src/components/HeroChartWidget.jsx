import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import MiniChart from './charts/MiniChart.jsx';
import { chartSummary } from './charts/theme.js';
import { SparklesIcon, ArrowRightIcon } from './Icons.jsx';

const CYCLE_MS = 5000;
const FADE_MS = 400;

// A floating glass card in the hero margins that cycles through the featured
// insight charts (crossfade + draw-on), pausing on hover/focus and holding still
// for reduced-motion users. Clicking deep-links to /insights with the dataset
// focused, so the matching card there pulses.
export default function HeroChartWidget({ items, startIndex = 0, reduced = false, className = '' }) {
  const { t, lang } = useLang();
  const n = items.length;
  const [idx, setIdx] = useState(startIndex % Math.max(1, n));
  const [visible, setVisible] = useState(true);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (reduced || n <= 1) return undefined;
    let timer;
    const tick = () => {
      if (pausedRef.current) { timer = setTimeout(tick, CYCLE_MS); return; }
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % n);
        setVisible(true);
        timer = setTimeout(tick, CYCLE_MS);
      }, FADE_MS);
    };
    timer = setTimeout(tick, CYCLE_MS);
    return () => clearTimeout(timer);
  }, [reduced, n]);

  if (n === 0) return null;
  const item = items[idx % n];
  const title = item.title?.[lang] || item.title?.en || item.title?.fr || '';
  const to = '/insights?focus=' + encodeURIComponent(item.dataset_id);
  const summary = chartSummary(item.kind, item.points, lang);

  return (
    <Link
      to={to}
      className={'cq-glass rounded-2xl border border-base-content/10 shadow-xl p-3.5 w-[192px] block no-underline transition-shadow hover:shadow-2xl ' + className}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
      onFocus={() => { pausedRef.current = true; }}
      onBlur={() => { pausedRef.current = false; }}
      aria-label={t('home.featured_aria') + ': ' + title}
    >
      <div className="flex items-center gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-base-content/45 mb-2">
        <SparklesIcon size={11} className="text-secondary" />
        {t('home.featured_label')}
      </div>
      <div style={{ opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}>
        <div className="h-[116px] flex items-center justify-center">
          <MiniChart key={idx} kind={item.kind} points={item.points} animate={!reduced} center={summary.center} endLabel={summary.endLabel} />
        </div>
        {summary.caption && (
          <div className="mt-1.5 text-[0.64rem] text-base-content/55 truncate">{summary.caption}</div>
        )}
        <div className="mt-1 text-[0.72rem] font-medium leading-snug line-clamp-2 min-h-[2.1em] text-base-content/80">
          {title}
        </div>
      </div>
      <div className="mt-2 inline-flex items-center gap-1 text-[0.7rem] cq-fg-red">
        {t('home.featured_cta')} <ArrowRightIcon size={11} />
      </div>
    </Link>
  );
}
