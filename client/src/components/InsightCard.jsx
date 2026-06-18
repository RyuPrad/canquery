import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchResourceProfile } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { classifyColumns, buildInsights, buildKpis } from './charts/classify.js';
import { ChartEmpty } from './charts/Visuals.jsx';
import InsightChart from './charts/InsightChart.jsx';
import Sparkline from './charts/Sparkline.jsx';
import { kpiView, fmtInt } from './charts/theme.js';
import { ArrowRightIcon } from './Icons.jsx';

// Most instantly legible visual first: a donut, then a trend, then anything.
function pickHero(insights) {
  return insights.find((i) => i.kind === 'donut')
    || insights.find((i) => i.kind === 'timeseries')
    || insights[0]
    || null;
}

// Podium ranks 1-3 get a coloured medal; brand tokens so they flip light/dark.
function RankBadge({ rank }) {
  const tone = rank === 1 ? 'bg-primary text-primary-content'
    : rank === 2 ? 'bg-secondary/20 text-secondary'
    : rank === 3 ? 'bg-accent/20 text-accent'
    : 'bg-base-content/10 text-base-content/60';
  return (
    <span className={'shrink-0 w-8 h-8 rounded-lg inline-flex items-center justify-center font-display font-bold text-sm tabular-nums ' + tone}>
      {rank}
    </span>
  );
}

// A gallery tile: profiles its resource (lazily, once scrolled near) and shows a
// KPI strip + one hero chart, so a visitor grasps the dataset at a glance.
// Optional rank/downloads/featured drive the Top 100 podium; fallbackValues
// renders a download-trend sparkline when there is no chartable insight (or the
// resource is download-only / still ingesting).
export default function InsightCard({ item, showDataset = true, rank = null, downloads = null, featured = false, fallbackValues = null }) {
  const { t, lang } = useLang();
  const id = item.resource_id;
  const name = item.name?.[lang] || item.name?.en || item.name?.fr || item.dataset?.title?.en || item.dataset?.name || id;
  const datasetTitle = item.dataset?.title?.[lang] || item.dataset?.title?.en || item.dataset?.title?.fr || item.dataset?.name;
  const datasetId = item.dataset?.id;
  const to = datasetId ? '/datasets/' + datasetId + (id ? '?highlight=' + id : '') : (id ? '/resources/' + id : '#');
  const chartHeight = featured ? 300 : 240;

  const ref = useRef(null);
  // Eager when IntersectionObserver is unavailable (tests / old browsers).
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [classified, setClassified] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id || visible) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '250px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, id]);

  useEffect(() => {
    if (!id || !visible) return;
    let cancelled = false;
    fetchResourceProfile(id)
      .then((env) => { if (!cancelled) setClassified(classifyColumns(env.data)); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [visible, id]);

  const hero = useMemo(() => (classified ? pickHero(buildInsights(classified)) : null), [classified]);
  const kpis = useMemo(() => (classified ? buildKpis(classified).slice(0, 3) : []), [classified]);

  // A download-only dataset has no table to chart, so we tease it with the
  // dataset's download-popularity trend. Anything that IS ingested but has no
  // auto-chart (or failed to profile) shows the same graceful empty state the
  // resource page does - never the download trend, which would read like data.
  const emptyChart = (label) => <ChartEmpty label={label} height={featured ? 200 : 160} />;
  const downloadTrend = (fallbackValues && fallbackValues.length) ? (
    <div className="space-y-1.5">
      <div className="text-secondary/70">
        <Sparkline values={fallbackValues} width={featured ? 360 : 260} height={featured ? 80 : 60} strokeWidth={2} />
      </div>
      <span className="text-xs text-base-content/45">{t('insights.download_trend')}</span>
    </div>
  ) : null;

  let body;
  if (!id) {
    body = downloadTrend || emptyChart(t('badge.fileonly'));
  } else if (error) {
    body = emptyChart(t('chart.profile_failed'));
  } else if (!classified) {
    body = (
      <div className="space-y-3">
        <div className="cq-skel h-5 w-2/3 rounded" />
        <div className="cq-skel rounded-xl" style={{ height: chartHeight }} />
      </div>
    );
  } else {
    body = (
      <>
        {kpis.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {kpis.map((k, i) => {
              const v = kpiView(k, lang, t);
              return (
                <div key={k.role + i} className="flex items-baseline gap-1.5">
                  <span className="font-display font-bold tabular-nums text-[0.95rem]">{v.value}</span>
                  <span className="text-xs text-base-content/45 truncate max-w-[10rem]">{v.sub || v.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {hero
          ? <InsightChart resourceId={id} spec={hero} framed={false} height={chartHeight} />
          : emptyChart(t('chart.no_insights'))}
      </>
    );
  }

  return (
    <div ref={ref} className={'cq-card p-5 space-y-4 cq-fade' + (featured ? ' ring-1 ring-primary/25' : '')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {rank !== null && <RankBadge rank={rank} />}
          <div className="min-w-0">
            <Link to={to} className="font-display font-semibold tracking-tight hover:text-primary transition-colors block truncate">
              {name}
            </Link>
            {downloads !== null ? (
              <p className="text-xs text-base-content/45">
                <span className="tabular-nums font-medium text-base-content/60">{fmtInt(downloads, lang)}</span> {t('insights.downloads')}
              </p>
            ) : (showDataset && datasetTitle && <p className="text-xs text-base-content/45 truncate">{datasetTitle}</p>)}
          </div>
        </div>
        <span className={'cq-chip shrink-0 ' + (id ? 'cq-chip-red' : 'cq-chip-mono')}>
          {id ? t('badge.ingested') : t('badge.fileonly')}
        </span>
      </div>

      {body}

      <div className="flex items-center justify-between pt-1">
        {item.row_count ? (
          <span className="text-[0.72rem] font-mono text-base-content/40">
            {item.row_count.toLocaleString()} {t('rails.rows')}
          </span>
        ) : <span />}
        <Link to={to} className="inline-flex items-center gap-1 text-sm cq-fg-red hover:text-primary transition-colors">
          {t('insights.open')} <ArrowRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}
