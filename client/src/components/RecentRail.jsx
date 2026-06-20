import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentlyUnlocked } from '../api/catalog.js';
import { formatRelativeTime } from '../utils/time.js';
import { useLang } from '../i18n.jsx';
import { SparklesIcon } from './Icons.jsx';

export default function RecentRail() {
  const { t, lang } = useLang();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchRecentlyUnlocked().then(env => {
      if (!cancelled && env) setItems(env.data || []);
    });
    return () => { cancelled = true; };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mt-10 cq-fade">
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content/55 mb-3">
        <SparklesIcon size={15} className="text-secondary" />
        {t('rails.recent')}
      </div>
      <div className="cq-rail">
        {items.map(item => (
          <Link
            key={item.resource_id}
            to={item.dataset?.id ? '/datasets/' + item.dataset.id + '?highlight=' + item.resource_id : '/resources/' + item.resource_id}
            className="cq-card p-3.5 w-60 shrink-0 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="cq-chip cq-chip-red">{t('badge.ingested')}</span>
              <span className="text-[0.68rem] text-base-content/40 font-mono">
                {formatRelativeTime(item.ingested_at, lang)}
              </span>
            </div>
            <div className="font-medium text-sm truncate">
              {item.name?.en || item.dataset?.title?.en || item.dataset?.name}
            </div>
            <div className="text-xs text-base-content/45 truncate">
              {item.dataset?.title?.en || item.dataset?.name}
            </div>
            {item.row_count ? (
              <div className="text-[0.68rem] font-mono text-base-content/40">
                {item.row_count.toLocaleString()} {t('rails.rows')}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
