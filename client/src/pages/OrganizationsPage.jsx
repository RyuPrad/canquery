import { useState } from 'react';
import usePaginatedCollection from '../hooks/usePaginatedCollection';
import { fetchOrganizations } from '../api/catalog';
import LoadingSpinner from '../components/LoadingSpinner';

export default function OrganizationsPage() {
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
        placeholder="Filter organizations..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {loading ? (
        <LoadingSpinner label="Loading organizations" />
      ) : error ? (
        <div className="alert alert-error">{error.message}</div>
      ) : (
        <>
          <div className="grid gap-2 mt-4 sm:grid-cols-2">
            {visible.map(o => (
              <div key={o.id} className="card bg-base-200 p-4 flex flex-row justify-between items-center">
                <div>
                  <div className="font-medium">{o.title.en || o.name}</div>
                  <div className="text-xs opacity-50">{o.name}</div>
                </div>
                <span className="badge badge-ghost">{o.dataset_count} datasets</span>
              </div>
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
