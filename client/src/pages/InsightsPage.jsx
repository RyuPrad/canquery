import { useState, useEffect } from 'react';
import { fetchRecentlyUnlocked } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import InsightCard from '../components/InsightCard.jsx';
import { SparklesIcon } from '../components/Icons.jsx';

export default function InsightsPage() {
  const { t } = useLang();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentlyUnlocked(24)
      .then((env) => { if (!cancelled) setItems(env?.data || []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-8 space-y-7">
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {items.map((item) => <InsightCard key={item.resource_id} item={item} />)}
        </div>
      )}
    </div>
  );
}
