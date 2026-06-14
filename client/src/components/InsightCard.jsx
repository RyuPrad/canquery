import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchResourceProfile } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { classifyColumns, buildInsights, buildKpis } from './charts/classify.js';
import { ChartEmpty } from './charts/Visuals.jsx';
import InsightChart from './charts/InsightChart.jsx';
import { kpiView } from './charts/theme.js';
import { ArrowRightIcon } from './Icons.jsx';

// Most instantly legible visual first: a donut, then a trend, then anything.
function pickHero(insights) {
  return insights.find((i) => i.kind === 'donut')
    || insights.find((i) => i.kind === 'timeseries')
    || insights[0]
    || null;
}

// A gallery tile: profiles its resource (lazily, once scrolled near) and shows a
// KPI strip + one hero chart, so a visitor grasps the dataset at a glance.
export default function InsightCard({ item }) {
  const { t, lang } = useLang();
  const id = item.resource_id;
  const name = item.name?.en || item.name?.fr || item.dataset?.title?.en || item.dataset?.name || id;
  const datasetTitle = item.dataset?.title?.en || item.dataset?.title?.fr || item.dataset?.name;
  const to = '/resources/' + id + '?view=chart';

  const ref = useRef(null);
  // Eager when IntersectionObserver is unavailable (tests / old browsers).
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [classified, setClassified] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '250px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchResourceProfile(id)
      .then((env) => { if (!cancelled) setClassified(classifyColumns(env.data)); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [visible, id]);

  const hero = useMemo(() => (classified ? pickHero(buildInsights(classified)) : null), [classified]);
  const kpis = useMemo(() => (classified ? buildKpis(classified).slice(0, 3) : []), [classified]);

  let body;
  if (error) {
    body = <ChartEmpty label={t('chart.profile_failed')} height={180} />;
  } else if (!classified) {
    body = (
      <div className="space-y-3">
        <div className="cq-skel h-5 w-2/3 rounded" />
        <div className="cq-skel h-[240px] rounded-xl" />
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
          ? <InsightChart resourceId={id} spec={hero} framed={false} height={240} />
          : <ChartEmpty label={t('chart.no_insights')} height={160} />}
      </>
    );
  }

  return (
    <div ref={ref} className="cq-card p-5 space-y-4 cq-fade">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={to} className="font-display font-semibold tracking-tight hover:text-primary transition-colors block truncate">
            {name}
          </Link>
          {datasetTitle && <p className="text-xs text-base-content/45 truncate">{datasetTitle}</p>}
        </div>
        <span className="cq-chip cq-chip-red shrink-0">{t('badge.ingested')}</span>
      </div>

      {body}

      <div className="flex items-center justify-between pt-1">
        {item.row_count ? (
          <span className="text-[0.72rem] font-mono text-base-content/40">
            {item.row_count.toLocaleString()} {t('rails.rows')}
          </span>
        ) : <span />}
        <Link to={to} className="inline-flex items-center gap-1 text-sm text-[#ff8d85] hover:text-primary transition-colors">
          {t('insights.open')} <ArrowRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}
