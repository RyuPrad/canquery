import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentlyUnlocked } from '../api/catalog.js';
import { formatRelativeTime } from '../utils/time.js';

export default function RecentRail() {
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
    <section className="mt-8">
      <div className="text-sm font-semibold opacity-60 mb-2">Recently unlocked</div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map(item => (
          <Link
            key={item.resource_id}
            to={'/resources/' + item.resource_id}
            className="card bg-base-200 hover:bg-base-300 transition-colors p-3 min-w-56 shrink-0"
          >
            <div className="flex items-center gap-2">
              <span className="badge badge-sm bg-[#d52b1e] text-white border-none">Unlocked</span>
              <span className="text-xs opacity-50">{formatRelativeTime(item.ingested_at)}</span>
            </div>
            <div className="font-medium text-sm truncate">
              {item.name?.en || item.dataset?.title?.en || item.dataset?.name}
            </div>
            <div className="text-xs opacity-50 truncate">
              {item.dataset?.title?.en || item.dataset?.name}
              {item.row_count ? ' - ' + item.row_count.toLocaleString() + ' rows' : ''}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
