import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchPopular } from '../api/catalog.js';
import { formatRelativeTime } from '../utils/time.js';
import { useLang } from '../i18n.jsx';

export default function PopularRail() {
  const { t } = useLang();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchPopular().then(env => {
      if (!cancelled && env) setItems(env.data || []);
    });
    return () => { cancelled = true; };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="text-sm font-semibold opacity-60 mb-2">{t('rails.popular')}</div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map(item => (
          <Link
            key={item.resource_id}
            to={'/resources/' + item.resource_id}
            className="card bg-base-200 hover:bg-base-300 transition-colors p-3 min-w-56 shrink-0"
          >
            <div className="flex items-center gap-2">
              <span className="badge badge-sm badge-outline">{item.hits} {item.hits === 1 ? t('rails.query_one') : t('rails.query_many')}</span>
              <span className="text-xs opacity-50">{formatRelativeTime(item.last_queried_at)}</span>
            </div>
            <div className="font-medium text-sm truncate">
              {item.name?.en || item.dataset?.title?.en || item.dataset?.name}
            </div>
            <div className="text-xs opacity-50 truncate">
              {item.dataset?.title?.en || item.dataset?.name}
              {item.format ? ' - ' + item.format : ''}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
