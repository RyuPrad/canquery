import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchTopDownloads, fetchFeatured } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import InsightCard from '../components/InsightCard.jsx';
import InsightCarousel from '../components/InsightCarousel.jsx';
import TopDownloadRow from '../components/TopDownloadRow.jsx';
import { SparklesIcon } from '../components/Icons.jsx';

// Adapt a top-downloads item to the shape InsightCard consumes (it charts the
// representative resource_id and links to its full dashboard).
function toCardItem(it) {
  return {
    resource_id: it.resource_id,
    name: it.title,
    dataset: { id: it.dataset_id, title: it.title },
    row_count: it.row_count
  };
}

function periodLabel(period, lang) {
  if (!period || !period.year || !period.month) return '';
  try {
    return new Date(period.year, period.month - 1, 1)
      .toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

// The Insights section: the live "Top 100 Downloaded Datasets" leaderboard, each
// dataset pre-ingested and visualized. The datasets that actually produce a chart
// (per the server-side featured set) cycle through a Steam-style carousel on top;
// the full ranking sits below as a compact list with download-popularity sparklines.
export default function InsightsPage() {
  const { t, lang } = useLang();
  const [items, setItems] = useState(null);
  const [period, setPeriod] = useState(null);
  const [chartableIds, setChartableIds] = useState(() => new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightId, setHighlightId] = useState(null);
  const [focusId, setFocusId] = useState(null);

  // Charts follow the UI language: refetch when EN/FR toggles so each dataset's
  // representative (and the chartable set) matches the active language.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTopDownloads(lang), fetchFeatured(lang)])
      .then(([topEnv, featEnv]) => {
        if (cancelled) return;
        setItems(topEnv?.data || []);
        setPeriod(topEnv?.meta?.period || null);
        setChartableIds(new Set((featEnv?.data || []).map((f) => f.dataset_id)));
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [lang]);

  // Deep-link from a hero teaser (/insights?focus=<dataset>): bring the matching
  // card into view, page the carousel to it, and pulse it briefly, then drop the
  // param so a refresh doesn't re-trigger it. A featured (chartable) dataset lives
  // in the carousel, so scroll the whole featured section to the top of the content
  // (its in-flow position is stable - scrolling a slide inside the carousel's
  // clipped/transformed track barely moves the page); the carousel pages to the
  // card. A non-chartable dataset only has a list row, so scroll to that.
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus || !items || items.length === 0) return;
    const inCarousel = chartableIds.has(focus);
    const el = inCarousel
      ? document.getElementById('featured-section')
      : document.getElementById('dsrow-' + focus);
    if (el) {
      el.scrollIntoView?.({ behavior: 'smooth', block: inCarousel ? 'start' : 'center' });
      setHighlightId(focus);
      setFocusId(focus);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [items, chartableIds, searchParams, setSearchParams]);

  // The un-highlight timer lives on highlightId, not in the effect above:
  // dropping the param re-runs that effect, and a cleanup there would cancel
  // the timer and leave the ring stuck on the card.
  useEffect(() => {
    if (!highlightId) return undefined;
    const timer = setTimeout(() => setHighlightId(null), 3400);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const label = periodLabel(period, lang);
  const valuesOf = (it) => (it.history || []).map((h) => h.d);
  const ringClass = (id) => (highlightId === id ? 'cq-focus-ring' : '');
  const featuredItems = items ? items.filter((it) => it.dataset_id && chartableIds.has(it.dataset_id)) : [];

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8 space-y-8">
      <header className="space-y-3 cq-fade">
        <div className="inline-flex items-center gap-2 cq-chip cq-chip-red">
          <SparklesIcon size={14} />
          {t('nav.insights')}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight">
            {t('insights.top_title')}
          </h1>
          {label && <span className="cq-chip cq-chip-mono capitalize">{label}</span>}
        </div>
        <p className="text-base-content/55 max-w-2xl leading-relaxed">
          {t('insights.top_subtitle')}
        </p>
      </header>

      {items === null ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          {[0, 1, 2].map((i) => <div key={i} className="cq-skel h-[360px] rounded-2xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="cq-card p-14 text-center space-y-2 max-w-xl mx-auto cq-fade">
          <SparklesIcon size={28} className="mx-auto text-secondary opacity-70" />
          <p className="text-base-content/70">{t('insights.top_empty')}</p>
        </div>
      ) : (
        <div className="space-y-10">
          {featuredItems.length > 0 && (
            <section id="featured-section" className="space-y-4 scroll-mt-24">
              <div className="flex items-center gap-2 text-sm font-semibold text-base-content/55">
                <SparklesIcon size={15} className="text-secondary" />
                {t('insights.featured_heading')}
              </div>
              <InsightCarousel
                items={featuredItems}
                getId={(it) => it.dataset_id}
                focusId={focusId}
                ariaLabel={t('insights.featured_heading')}
                renderSlide={(it) => (
                  <div id={'ds-' + it.dataset_id} className={ringClass(it.dataset_id)}>
                    <InsightCard
                      item={toCardItem(it)}
                      rank={it.rank}
                      downloads={it.downloads}
                      fallbackValues={valuesOf(it)}
                      showDataset={false}
                    />
                  </div>
                )}
              />
            </section>
          )}

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-base-content/55">
              {t('insights.ranking_heading')}
            </div>
            <div className="cq-card p-2 sm:p-3">
              <div className="divide-y divide-base-content/5">
                {items.map((it) => (
                  <div key={it.dataset_id} id={'dsrow-' + it.dataset_id} className={ringClass(it.dataset_id)}>
                    <TopDownloadRow item={it} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
