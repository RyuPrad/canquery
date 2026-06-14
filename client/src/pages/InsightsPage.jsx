import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentlyUnlocked } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import InsightCard from '../components/InsightCard.jsx';
import { SparklesIcon, DatabaseIcon } from '../components/Icons.jsx';

// Bucket the flat resource list into its parent datasets, preserving the
// recently-unlocked ordering (first dataset seen appears first).
function groupByDataset(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.dataset?.id || it.resource_id;
    if (!map.has(key)) map.set(key, { dataset: it.dataset, items: [] });
    map.get(key).items.push(it);
  }
  return [...map.values()];
}

export default function InsightsPage() {
  const { t, lang } = useLang();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentlyUnlocked(24)
      .then((env) => { if (!cancelled) setItems(env?.data || []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => (items ? groupByDataset(items) : []), [items]);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8 space-y-8">
      <header className="space-y-2 cq-fade">
        <div className="inline-flex items-center gap-2 cq-chip cq-chip-red">
          <SparklesIcon size={14} />
          {t('nav.insights')}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight">
          {t('insights.title')}
        </h1>
        <p className="text-base-content/55 max-w-2xl leading-relaxed">
          {t('insights.subtitle')}
        </p>
      </header>

      {items === null ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="cq-skel h-[400px] rounded-2xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="cq-card p-14 text-center space-y-2 max-w-xl mx-auto cq-fade">
          <SparklesIcon size={28} className="mx-auto text-secondary opacity-70" />
          <p className="text-base-content/70">{t('insights.empty')}</p>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map((g) => {
            const dsTitle = g.dataset?.title?.[lang] || g.dataset?.title?.en || g.dataset?.name || t('insights.untitled');
            const count = g.items.length;
            return (
              <section key={g.dataset?.id || g.items[0].resource_id} className="space-y-4 cq-fade">
                <div className="flex items-center gap-3 border-b border-base-content/10 pb-2.5">
                  <span className="w-8 h-8 rounded-lg bg-secondary/15 text-secondary inline-flex items-center justify-center shrink-0">
                    <DatabaseIcon size={16} />
                  </span>
                  {g.dataset?.id ? (
                    <Link
                      to={'/datasets/' + g.dataset.id}
                      className="font-display font-semibold text-lg tracking-tight hover:text-primary transition-colors truncate"
                    >
                      {dsTitle}
                    </Link>
                  ) : (
                    <span className="font-display font-semibold text-lg tracking-tight truncate">{dsTitle}</span>
                  )}
                  <span className="cq-chip cq-chip-mono shrink-0">
                    {count} {count === 1 ? t('insights.resource_one') : t('insights.resource_many')}
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {g.items.map((item) => (
                    <InsightCard key={item.resource_id} item={item} showDataset={false} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
