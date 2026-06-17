import { useState, useEffect } from 'react';
import { fetchTopDownloads } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import InsightCard from '../components/InsightCard.jsx';
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
// dataset pre-ingested and visualized. Top 3 as a featured podium, the rest as a
// compact list with download-popularity sparklines.
export default function InsightsPage() {
  const { t, lang } = useLang();
  const [items, setItems] = useState(null);
  const [period, setPeriod] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchTopDownloads()
      .then((env) => {
        if (cancelled) return;
        setItems(env?.data || []);
        setPeriod(env?.meta?.period || null);
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const top3 = items ? items.slice(0, 3) : [];
  const rest = items ? items.slice(3) : [];
  const label = periodLabel(period, lang);
  const valuesOf = (it) => (it.history || []).map((h) => h.d);

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
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            {top3.map((it, i) => (
              <InsightCard
                key={it.dataset_id}
                item={toCardItem(it)}
                rank={it.rank}
                downloads={it.downloads}
                fallbackValues={valuesOf(it)}
                featured={i === 0}
                showDataset={false}
              />
            ))}
          </div>

          {rest.length > 0 && (
            <div className="cq-card p-2 sm:p-3">
              <div className="divide-y divide-base-content/5">
                {rest.map((it) => <TopDownloadRow key={it.dataset_id} item={it} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
