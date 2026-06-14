import { useState } from 'react';
import { Link } from 'react-router-dom';
import usePaginatedCollection from '../hooks/usePaginatedCollection';
import { fetchOrganizations } from '../api/catalog';
import { useLang } from '../i18n.jsx';
import { SearchIcon } from '../components/Icons.jsx';

function OrgCard({ org, t }) {
  const title = org.title.en || org.name;
  return (
    <Link
      key={org.id}
      to={'/?org=' + encodeURIComponent(org.name)}
      title={'See every dataset from ' + title}
      className="cq-card p-4 flex items-center gap-3.5 group"
    >
      <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-display font-bold text-base shrink-0">
        {title.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[0.92rem] leading-snug line-clamp-2 group-hover:text-white transition-colors">
          {title}
        </div>
        <div className="text-xs text-base-content/35 font-mono truncate mt-0.5">{org.name}</div>
      </div>
      <span className="cq-chip cq-chip-mono shrink-0">
        {org.dataset_count} {t('orgs.datasets')}
      </span>
    </Link>
  );
}

export default function OrganizationsPage() {
  const { t } = useLang();
  const [filter, setFilter] = useState('');
  const { items, loading, loadingMore, error, hasMore, loadMore } = usePaginatedCollection(
    (cursor) => fetchOrganizations({ limit: 100, cursor }),
    []
  );

  const visible = items.filter(o =>
    !filter || (o.title.en || o.name).toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <h1 className="text-3xl font-bold font-display tracking-tight pb-6">
        {t('nav.organizations')}
      </h1>
      <div className="cq-search cq-search-sm w-full max-w-md">
        <SearchIcon size={14} className="opacity-40 shrink-0" />
        <input
          placeholder={t('orgs.filter_placeholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {loading ? (
        <div className="grid gap-3 mt-5 sm:grid-cols-2" aria-label={t('orgs.loading')}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="cq-skel h-[74px]" />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert-error mt-5">{error.message}</div>
      ) : (
        <>
          <div className="grid gap-3 mt-5 sm:grid-cols-2">
            {visible.map(o => (
              <OrgCard key={o.id} org={o} t={t} />
            ))}
          </div>
          {hasMore && (
            <div className="text-center mt-6">
              <button
                className="btn btn-outline btn-sm rounded-full px-7 border-base-content/20"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? t('home.loading') : t('home.load_more')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
