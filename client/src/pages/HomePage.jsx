import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { searchDatasets, fetchOrganizations, fetchStats } from '../api/catalog.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import SearchBar from '../components/SearchBar.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import RecentRail from '../components/RecentRail.jsx';
import { formatRelativeTime } from '../utils/time.js';

const FORMATS = ['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML'];
const EXAMPLES = ['housing', 'wildfire', 'electric vehicles', 'water quality', 'census'];

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [org, setOrg] = useState(searchParams.get('org') || '');
  const [format, setFormat] = useState(searchParams.get('format') || '');
  const keyword = searchParams.get('keyword') || '';
  const [stats, setStats] = useState(null);
  const [orgs, setOrgs] = useState([]);

  const debouncedQuery = useDebouncedValue(query, 250);

  // Keep the URL shareable: reflect the active search in the query string.
  useEffect(() => {
    const next = {};
    if (debouncedQuery) next.q = debouncedQuery;
    if (org) next.org = org;
    if (format) next.format = format;
    if (keyword) next.keyword = keyword;
    setSearchParams(next, { replace: true });
  }, [debouncedQuery, org, format, keyword, setSearchParams]);

  const clearKeyword = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('keyword');
    setSearchParams(next, { replace: true });
  };

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
        keyword: keyword || undefined,
        limit: 20,
        cursor,
      }),
    [debouncedQuery, org, format, keyword]
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
            {stats.last_synced_at && formatRelativeTime(stats.last_synced_at) && (
              <span className="opacity-60">{' / synced '}{formatRelativeTime(stats.last_synced_at)}</span>
            )}
          </p>
        )}
      </section>

      <section className="grid sm:grid-cols-3 gap-3 mb-8 text-sm">
        <div className="card bg-base-200 p-4">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <span className="badge bg-[#d52b1e] text-white border-none">1</span>
            Search everything
          </div>
          <p className="opacity-70">Every dataset on open.canada.ca, mirrored and searchable in English and French.</p>
        </div>
        <div className="card bg-base-200 p-4">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <span className="badge bg-[#d52b1e] text-white border-none">2</span>
            Unlock any CSV
          </div>
          <p className="opacity-70">One click pulls the file into our database in seconds. No signup needed.</p>
        </div>
        <div className="card bg-base-200 p-4">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <span className="badge bg-[#d52b1e] text-white border-none">3</span>
            Query it live
          </div>
          <p className="opacity-70">Filter, sort and export to CSV without downloading anything by hand.</p>
        </div>
      </section>

      <SearchBar value={query} onChange={setQuery} />

      <div className="flex flex-wrap gap-2 items-center mt-3 justify-center">
        <span className="text-xs opacity-50">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="btn btn-xs btn-ghost rounded-full border border-base-300"
            onClick={() => setQuery(ex)}
          >
            {ex}
          </button>
        ))}
        {keyword && (
          <button
            className="badge bg-[#d52b1e] text-white border-none gap-1"
            onClick={clearKeyword}
            title="Clear keyword filter"
          >
            keyword: {keyword} (clear)
          </button>
        )}
      </div>

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

      {!debouncedQuery && !org && !format && !keyword && <RecentRail />}

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
