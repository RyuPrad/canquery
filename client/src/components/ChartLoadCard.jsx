import { useEffect, useLayoutEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { useLang } from '../i18n.jsx';
import { fill } from '../utils/text.js';
import { formatBytes } from '../utils/bytes.js';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js';
import { IDLE_RUN, chartLoadReducer, chartLoadStage, isRunVisible } from '../utils/chartLoadProgress.js';

const ANNOUNCEMENTS = {
  queued: 'chart.progress.queued',
  downloading: 'chart.progress.download_start',
  loading: 'chart.progress.loading',
  finishing: 'preparation.progress.finishing',
  opening: 'chart.progress.opening',
  profile: 'chart.progress.profile',
  charts: 'chart.progress.drawing',
  done: 'chart.progress.done',
};

function stageDetail(info, t, lang) {
  const number = (value) => value.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  switch (info.stage) {
    case 'queued':
      return t(info.waiting ? 'chart.progress.queued' : 'chart.progress.starting');
    case 'downloading':
      if (info.bytes !== null && info.length) {
        return fill(t('preparation.progress.downloading'), { done: formatBytes(info.bytes, lang), total: formatBytes(info.length, lang) });
      }
      if (info.bytes) return fill(t('preparation.progress.downloaded'), { done: formatBytes(info.bytes, lang) });
      return t('chart.progress.download_start');
    case 'loading':
      return info.rows > 0 ? fill(t('preparation.progress.loading'), { rows: number(info.rows) }) : t('chart.progress.reading');
    case 'finishing':
      return t('preparation.progress.finishing');
    case 'profile':
      return t('chart.progress.profile');
    case 'charts':
      return fill(t('chart.progress.charts'), { done: number(info.settled), total: number(info.total) });
    case 'done':
      return t('chart.progress.done');
    default:
      return t('chart.progress.opening');
  }
}

// The Chart tab's loading card: one percentage from the file's preparation to
// the last chart drawn (utils/chartLoadProgress.js). It stays mounted in one
// place while the Chart tab is open, so the number carries on from the
// preparation into the charts, and it ticks on its own so the charts never
// re-render for it. While preparing it stands in for the preparation card;
// over the charts it floats above their top edge, so nothing moves when it goes.
export default function ChartLoadCard({ store, preparing, charting, published, phase, progress, elapsed = null }) {
  const { t, lang } = useLang();
  const reducedMotion = usePrefersReducedMotion();
  const units = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const info = useMemo(
    () => chartLoadStage({ preparing, charting, published, phase, progress }, units),
    [preparing, charting, published, phase, progress, units]
  );
  const [run, dispatch] = useReducer(chartLoadReducer, IDLE_RUN);
  // Before paint, so a preparation never shows an empty frame.
  useLayoutEffect(() => {
    dispatch({ type: 'observe', info, now: Date.now(), immediate: preparing });
  }, [info, preparing]);
  const active = run.status !== 'idle';
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'hidden') dispatch({ type: 'tick', now: Date.now(), smooth: !reducedMotion });
    };
    tick();
    const timer = setInterval(tick, reducedMotion ? 1000 : 200);
    return () => clearInterval(timer);
  }, [active, reducedMotion]);

  if (!isRunVisible(run)) return null;
  const holding = run.status === 'holding';
  const percent = holding ? 100 : Math.round(run.shown);
  const percentText = new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'percent', maximumFractionDigits: 0 }).format(percent / 100);
  const title = t('chart.progress.title');
  // "Chart ready" goes with 100%: in the moment between the last chart and 100%
  // the card still says it is drawing.
  const detail = holding
    ? t('chart.progress.done')
    : run.info.stage === 'done'
      ? t('chart.progress.drawing')
      : stageDetail(run.info, t, lang);
  const announcement = run.announced && ANNOUNCEMENTS[run.announced] ? t(ANNOUNCEMENTS[run.announced]) : '';

  const card = (
    <div className={'cq-card p-5 sm:p-6 space-y-3 w-full max-w-xl mx-auto' + (charting ? ' shadow-xl' : '')}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-medium">
          {!holding && <span className="loading loading-spinner loading-xs motion-reduce:hidden" aria-hidden="true" />}
          {title}
        </p>
        <span className="font-mono tabular-nums text-lg font-semibold" aria-hidden="true">{percentText}</span>
      </div>
      <progress
        className="progress progress-primary w-full"
        max={100}
        value={percent}
        aria-label={title}
        aria-valuetext={percentText + ' · ' + detail}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-mono text-base-content/70">
        <span>{detail}</span>
        {elapsed && <span>{t('resource.elapsed')} {elapsed}</span>}
      </div>
      {preparing && <p className="text-sm text-base-content/60">{t('preparation.automatic')}</p>}
      <p className="sr-only" role="status">{announcement}</p>
    </div>
  );
  if (!charting) return card;
  return <div className="absolute inset-x-2 top-12 z-10 pointer-events-none">{card}</div>;
}
