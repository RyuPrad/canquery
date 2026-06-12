import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  fetchResource,
  queryResource,
  enqueueIngest,
} from '../api/catalog.js';
import {
  NotFoundError,
  NotIngestedError,
  FileOnlyError,
  apiUrl,
} from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import useJobPolling from '../hooks/useJobPolling.js';
import DataTable from '../components/DataTable.jsx';
import ChartPanel from '../components/ChartPanel.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ResourceBadge from '../components/ResourceBadge.jsx';
import { useLang } from '../i18n.jsx';

const PAGE_SIZE = 50;

function ResourcePage() {
  const { t } = useLang();
  const { id } = useParams();

  const [resource, setResource] = useState(null);
  const [resourceError, setResourceError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const parseCf = (raw) => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [columnFilters, setColumnFilters] = useState(() => parseCf(searchParams.get('cf')));
  const [sort, setSort] = useState(searchParams.get('sort') || null);
  const [page, setPage] = useState(() => {
    const n = Number(searchParams.get('page'));
    return Number.isInteger(n) && n > 0 ? n : 0;
  });

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [unlockState, setUnlockState] = useState(null);
  const [unlockJobId, setUnlockJobId] = useState(null);
  const [view, setView] = useState('table');
  const [reloadKey, setReloadKey] = useState(0);

  // Stable callback: an inline arrow here would re-arm the polling effect on
  // every render and turn it into a 0ms fetch loop.
  const onUnlockDone = useCallback((job) => {
    if (job.status === 'done') {
      setUnlockJobId(null);
      setUnlockState(null);
      setReloadKey((k) => k + 1);
    } else {
      setUnlockState('failed');
    }
  }, []);
  const { job: unlockJob } = useJobPolling(unlockJobId, { onDone: onUnlockDone });

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
  }, [id, reloadKey]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, debouncedFilters, sort]);

  // Keep the explorer state shareable via the URL.
  useEffect(() => {
    const next = {};
    if (debouncedQ) next.q = debouncedQ;
    const activeCf = {};
    for (const [col, text] of Object.entries(debouncedFilters)) {
      if (text) activeCf[col] = text;
    }
    if (Object.keys(activeCf).length) next.cf = JSON.stringify(activeCf);
    if (sort) next.sort = sort;
    if (page > 0) next.page = String(page);
    setSearchParams(next, { replace: true });
  }, [debouncedQ, debouncedFilters, sort, page, setSearchParams]);

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
  }, [id, debouncedQ, debouncedFilters, sort, page, reloadKey]);

  const exportFilters = {};
  for (const [col, text] of Object.entries(debouncedFilters)) {
    if (text) exportFilters[col] = { op: 'contains', value: text };
  }
  const exportHref = apiUrl('/api/v1/resources/' + id + '/query.csv', {
    q: debouncedQ || undefined,
    filters: Object.keys(exportFilters).length ? exportFilters : undefined,
    sort: sort || undefined,
  });

  const handleUnlock = async () => {
    try {
      setUnlockState('queued');
      const env = await enqueueIngest(id);
      setUnlockJobId(env.data.id);
    } catch {
      setUnlockState('failed');
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
          placeholder={t('resource.search_placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {data && (
          <span className="text-sm opacity-60 ml-auto">
            {data.total.toLocaleString()} rows
          </span>
        )}
        {data && (
          <a className="btn btn-xs btn-outline" href={exportHref} download title="Exports the current filters and sort, up to 10,000 rows">
            {t('resource.download_filtered')}
          </a>
        )}
      </div>

      {dataLoading && !data ? (
        <LoadingSpinner label={t('resource.querying')} />
      ) : dataError instanceof NotIngestedError ? (
        <div className="card bg-base-200 p-8 text-center space-y-3">
          <p>{resource?.format === 'XLSX' || resource?.format === 'XLS' ? t('resource.not_unlocked_excel') : t('resource.not_unlocked_csv')} {t('resource.one_click')}</p>
          <div className="flex justify-center">
            <button
              className="btn bg-[#d52b1e] text-white border-none btn-sm"
              onClick={handleUnlock}
              disabled={unlockState === 'queued' && !unlockJob}
            >
              {unlockState === null
                ? t('resource.unlock')
                : unlockState === 'queued'
                  ? (unlockJob && unlockJob.status === 'running' ? t('resource.loading_data') : t('resource.queued'))
                  : t('resource.failed_retry')}
            </button>
          </div>
          {unlockState === 'queued' && (
            <p className="text-xs opacity-50">{t('resource.will_appear')}</p>
          )}
          {unlockState === 'failed' && unlockJob && unlockJob.error && (
            <p className="text-xs opacity-50">{unlockJob.error}</p>
          )}
        </div>
      ) : dataError instanceof FileOnlyError ? (
        <div className="alert alert-warning">
          <span>This resource is a plain file download.</span>
          <a href={dataError.download_url} className="link">
            {t('resource.download_here')}
          </a>
        </div>
      ) : dataError ? (
        <div className="alert alert-error">{dataError.message}</div>
      ) : data ? (
        <>
          <div className="tabs tabs-boxed w-fit">
            <button className={'tab tab-sm' + (view === 'table' ? ' tab-active' : '')} onClick={() => setView('table')}>{t('resource.table')}</button>
            <button className={'tab tab-sm' + (view === 'chart' ? ' tab-active' : '')} onClick={() => setView('chart')}>{t('resource.chart')}</button>
          </div>
          {view === 'chart' ? (
            <ChartPanel resourceId={id} q={debouncedQ || undefined} filters={Object.keys(exportFilters).length ? exportFilters : undefined} fields={data.fields} queryMode={data.mode} />
          ) : (
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
          )}
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
