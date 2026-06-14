import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchPopular } from '../api/catalog.js';
import { formatRelativeTime } from '../utils/time.js';
import { useLang } from '../i18n.jsx';
import { ZapIcon } from './Icons.jsx';

export default function PopularRail() {
  const { t, lang } = useLang();
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
    <section className="mt-10 cq-fade">
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content/55 mb-3">
        <ZapIcon size={15} className="text-warning" />
        {t('rails.popular')}
      </div>
      <div className="cq-rail">
        {items.map(item => (
          <Link
            key={item.resource_id}
            to={'/resources/' + item.resource_id}
            className="cq-card p-3.5 w-60 shrink-0 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="cq-chip">
                <ZapIcon size={10} />
                {item.hits} {item.hits === 1 ? t('rails.query_one') : t('rails.query_many')}
              </span>
              <span className="text-[0.68rem] text-base-content/40 font-mono">
                {formatRelativeTime(item.last_queried_at, lang)}
              </span>
            </div>
            <div className="font-medium text-sm truncate">
              {item.name?.en || item.dataset?.title?.en || item.dataset?.name}
            </div>
            <div className="text-xs text-base-content/45 truncate">
              {item.dataset?.title?.en || item.dataset?.name}
              {item.format ? ' · ' + item.format : ''}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
