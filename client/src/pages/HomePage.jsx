import { useState, useEffect } from 'react';
import { searchDatasets, fetchOrganizations, fetchStats } from '../api/catalog.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import SearchBar from '../components/SearchBar.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

const FORMATS = ['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML'];

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [org, setOrg] = useState('');
  const [format, setFormat] = useState('');
  const [stats, setStats] = useState(null);
  const [orgs, setOrgs] = useState([]);

  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    let cancelled = false;
    fetchStats().then((env) => {
      if (!cancelled && env) setStats(env.data);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOrganizations({ limit: 50 })
      .then((env) => {
        if (!cancelled) setOrgs(env.data || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePaginatedCollection(
    (cursor) =>
      searchDatasets({
        q: debouncedQuery || undefined,
        org: org || undefined,
        format: format || undefined,
        limit: 20,
        cursor,
      }),
    [debouncedQuery, org, format]
  );

  return (
    <div className="container mx-auto px-4">
      <section className="py-10 text-center space-y-4">
        <h1 className="text-4xl font-bold">Query Canada&apos;s open data</h1>
        <p className="text-lg opacity-70 max-w-2xl mx-auto">
          Roughly 2 percent of the catalogue is officially queryable. opencanada mirrors the rest and lets you unlock CSVs on demand.
        </p>
        {stats && (
          <p className="text-sm opacity-80">
            {stats.datasets.toLocaleString()} datasets mirrored{' / '}
            {stats.datastore_active_resources.toLocaleString()} queryable upstream{' / '}
            <span className="text-[#d52b1e] font-semibold">
              {stats.ingested_resources.toLocaleString()} unlocked here
            </span>
          </p>
        )}
      </section>

      <SearchBar value={query} onChange={setQuery} />

      <div className="flex flex-wrap gap-2 items-center mt-4">
        <button
          className={`btn btn-xs rounded-full ${format === '' ? 'bg-[#d52b1e] text-white border-none' : ''}`}
          onClick={() => setFormat('')}
        >
          All formats
        </button>
        {FORMATS.map((f) => (
          <button
            key={f}
            className={`btn btn-xs rounded-full ${format === f ? 'bg-[#d52b1e] text-white border-none' : ''}`}
            onClick={() => setFormat(f)}
          >
            {f}
          </button>
        ))}
        <select
          className="select select-bordered select-sm ml-auto"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
        >
          <option value="">All organizations</option>
          {orgs.map((o) => (
            <option key={o.name} value={o.name}>
              {o.title?.en || o.name} ({o.dataset_count})
            </option>
          ))}
        </select>
      </div>

      <section className="mt-6 space-y-3">
        {loading && <LoadingSpinner label="Searching the catalogue" />}
        {error && <div className="alert alert-error">{error.message}</div>}
        {items.length === 0 && !loading && !error && (
          <div className="text-center opacity-60 py-10">No datasets matched.</div>
        )}
        {items.map((d) => (
          <DatasetRow key={d.id} dataset={d} />
        ))}
      </section>

      {hasMore && (
        <div className="text-center mt-4">
          <button
            className="btn btn-outline btn-sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
