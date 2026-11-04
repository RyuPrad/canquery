import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { formatRelativeTime } from '../utils/time.js';
import { clearRecentlyViewed, readRecentlyViewed, subscribeRecentlyViewed } from '../utils/recentlyViewed.js';
import { CalendarIcon, FileIcon } from './Icons.jsx';

// The datasets and files this browser opened lately, newest first. The list
// lives only in this browser; Clear empties it and says so where it was, so
// keyboard focus does not fall back to the top of the page.
export default function RecentlyViewedRail() {
  const { t, lang } = useLang();
  const [items, setItems] = useState(() => readRecentlyViewed());
  const [cleared, setCleared] = useState(false);
  const status = useRef(null);
  useEffect(() => subscribeRecentlyViewed(() => setItems(readRecentlyViewed())), []);
  useEffect(() => { if (cleared) status.current?.focus(); }, [cleared]);

  if (items.length === 0) {
    return cleared ? (
      <p ref={status} tabIndex={-1} role="status" className="mt-10 text-sm text-base-content/65">{t('rails.viewed_cleared')}</p>
    ) : null;
  }

  return (
    <section className="mt-10 cq-fade" aria-labelledby="home-recently-viewed">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="home-recently-viewed" className="flex items-center gap-2 font-semibold">
          <CalendarIcon size={15} className="text-info" />
          {t('rails.viewed')}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          aria-label={t('rails.viewed_clear_label')}
          onClick={() => { clearRecentlyViewed(); setCleared(true); }}
        >
          {t('rails.viewed_clear')}
        </button>
      </div>
      <div className="cq-rail">
        {items.map(item => (
          <Link key={item.kind + ':' + item.id} to={item.path} className="cq-card p-3.5 w-60 shrink-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="cq-chip">
                <FileIcon size={10} />
                {t(item.kind === 'dataset' ? 'rails.viewed_dataset' : 'rails.viewed_file')}
              </span>
              {item.at > 0 && (
                <span className="text-[0.68rem] text-base-content/40 font-mono">
                  {formatRelativeTime(new Date(item.at).toISOString(), lang)}
                </span>
              )}
            </div>
            <div className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">{item.title[lang] || item.title.en || item.title.fr}</div>
          </Link>
        ))}
      </div>
      <p className="text-xs text-base-content/50 mt-2">{t('rails.viewed_note')}</p>
    </section>
  );
}
