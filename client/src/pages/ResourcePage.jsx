import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  fetchResource,
  queryResource,
  enqueueIngest,
} from '../api/catalog.js';
import {
  NotFoundError,
  NotIngestedError,
  FileOnlyError,
} from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import DataTable from '../components/DataTable.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ResourceBadge from '../components/ResourceBadge.jsx';

const PAGE_SIZE = 50;

function ResourcePage() {
  const { id } = useParams();

  const [resource, setResource] = useState(null);
  const [resourceError, setResourceError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [q, setQ] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [unlockState, setUnlockState] = useState(null);

  const debouncedQ = useDebouncedValue(q, 250);
  const debouncedFilters = useDebouncedValue(columnFilters, 250);

  useEffect(() => {
    let cancelled = false;
    fetchResource(id)
      .then((env) => {
        if (!cancelled) setResource(env.data);
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof NotFoundError) setNotFound(true);
          else setResourceError(err);
        }
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, debouncedFilters, sort]);

  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);

    const filters = {};
    for (const [col, text] of Object.entries(debouncedFilters)) {
      if (text) filters[col] = { op: 'contains', value: text };
    }

    queryResource(id, {
      q: debouncedQ || undefined,
      filters: Object.keys(filters).length ? filters : undefined,
      sort: sort || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((env) => {
        if (!cancelled) {
          setData({
            fields: env.data.fields,
            records: env.data.records,
            total: env.data.total,
            mode: env.meta.query_mode,
          });
          setDataError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setDataError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, debouncedQ, debouncedFilters, sort, page]);

  const handleUnlock = async () => {
    try {
      setUnlockState('queued');
      await enqueueIngest(id);
    } catch {
      setUnlockState('error');
    }
  };

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Resource not found
        <Link to="/" className="link ml-2">
          Home
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-screen-2xl mx-auto space-y-4">
      {resourceError && (
        <div className="alert alert-error my-4">{resourceError.message}</div>
      )}
      {resource && (
        <div className="py-4 space-y-2">
          <Link
            to={`/datasets/${resource.dataset.id}`}
            className="link text-sm opacity-60"
          >
            back to {resource.dataset.title.en || resource.dataset.name}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">
              {resource.name.en || resource.name.fr || resource.id}
            </h1>
            <ResourceBadge mode={resource.query_mode} />
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-xs btn-ghost"
            >
              Raw download
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center mt-2">
        <input
          className="input input-bordered input-sm w-72"
          placeholder="Full-text search in this table..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {data && (
          <span className="text-sm opacity-60 ml-auto">
            {data.total.toLocaleString()} rows
          </span>
        )}
      </div>

      {dataLoading && !data ? (
        <LoadingSpinner label="Querying" />
      ) : dataError instanceof NotIngestedError ? (
        <div className="card bg-base-200 p-8 text-center space-y-3">
          <p>This CSV is not unlocked yet.</p>
          <button
            className="btn bg-[#d52b1e] text-white border-none btn-sm"
            onClick={handleUnlock}
          >
            {unlockState === null
              ? 'Unlock this resource'
              : unlockState === 'queued'
                ? 'Queued - refresh in a moment'
                : 'Failed - try again'}
          </button>
        </div>
      ) : dataError instanceof FileOnlyError ? (
        <div className="alert alert-warning">
          <span>This resource is a plain file download.</span>
          <a href={dataError.download_url} className="link">
            Download it here
          </a>
        </div>
      ) : dataError ? (
        <div className="alert alert-error">{dataError.message}</div>
      ) : data ? (
        <>
          <DataTable
            fields={data.fields}
            records={data.records}
            sort={sort}
            onSortChange={setSort}
            columnFilters={columnFilters}
            onColumnFilterChange={(id, text) =>
              setColumnFilters((prev) => ({ ...prev, [id]: text }))
            }
          />
          {data.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                className="btn btn-sm btn-outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Prev
              </button>
              <span className="text-sm opacity-70">
                page {page + 1} of {Math.max(1, Math.ceil(data.total / PAGE_SIZE))}
              </span>
              <button
                className="btn btn-sm btn-outline"
                disabled={(page + 1) * PAGE_SIZE >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default ResourcePage;
