import { useState } from 'react';
import { Link } from 'react-router-dom';
import usePaginatedCollection from '../hooks/usePaginatedCollection';
import { fetchOrganizations } from '../api/catalog';
import LoadingSpinner from '../components/LoadingSpinner';
import { useLang } from '../i18n.jsx';

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
    <div>
      <h1 className="text-3xl font-bold py-6">Organizations</h1>
      <input
        className="input input-bordered w-full max-w-md"
        placeholder={t('orgs.filter_placeholder')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {loading ? (
        <LoadingSpinner label={t('orgs.loading')} />
      ) : error ? (
        <div className="alert alert-error">{error.message}</div>
      ) : (
        <>
          <div className="grid gap-2 mt-4 sm:grid-cols-2">
            {visible.map(o => (
              <Link key={o.id} to={'/?org=' + encodeURIComponent(o.name)} title={'See every dataset from ' + (o.title.en || o.name)} className="card bg-base-200 p-4 flex flex-row justify-between items-center hover:bg-base-300 transition-colors">
                <div>
                  <div className="font-medium">{o.title.en || o.name}</div>
                  <div className="text-xs opacity-50">{o.name}</div>
                </div>
                <span className="badge badge-ghost">{o.dataset_count} {t('orgs.datasets')}</span>
              </Link>
            ))}
          </div>
          {hasMore && (
            <div className="text-center">
              <button
                className="btn btn-outline btn-sm mt-4"
                onClick={loadMore}
                disabled={loadingMore}
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
