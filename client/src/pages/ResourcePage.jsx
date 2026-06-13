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
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  LockIcon,
  SearchIcon,
  TableIcon,
  LineChartIcon,
  FileIcon,
} from '../components/Icons.jsx';

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
      <div className="text-center py-28 space-y-3 oc-fade">
        <h1 className="text-2xl font-bold font-display">{t('common.resource_not_found')}</h1>
        <Link to="/" className="link link-hover text-base-content/60">
          {t('common.back_search')}
        </Link>
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const unlockWorking = unlockState === 'queued';

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6 space-y-4">
      {resourceError && (
        <div className="alert alert-error my-4">{resourceError.message}</div>
      )}
      {resource && (
        <div className="space-y-2.5 oc-fade">
          <Link
            to={`/datasets/${resource.dataset.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-base-content/50 hover:text-base-content transition-colors"
          >
            <ArrowLeftIcon size={14} />
            {resource.dataset.title.en || resource.dataset.name}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold font-display tracking-tight">
              {resource.name.en || resource.name.fr || resource.id}
            </h1>
            <ResourceBadge mode={resource.query_mode} />
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="oc-nav-link !text-xs opacity-70"
            >
              <DownloadIcon size={13} />
              {t('resource.raw')}
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5 items-center">
        <div className="oc-search oc-search-sm w-full sm:w-80">
          <SearchIcon size={14} className="opacity-40 shrink-0" />
          <input
            placeholder={t('resource.search_placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {data && (
          <span className="oc-chip oc-chip-mono ml-auto">
            {data.total.toLocaleString()} {t('resource.rows')}
          </span>
        )}
        {data && (
          <a
            className="btn btn-sm btn-outline border-base-content/20 rounded-lg gap-1.5 font-normal"
            href={exportHref}
            download
            title={t('resource.export_tip')}
          >
            <DownloadIcon size={13} />
            {t('resource.download_filtered')}
          </a>
        )}
      </div>

      {dataLoading && !data ? (
        <div className="space-y-3">
          <div className="oc-skel h-10 w-64" />
          <div className="oc-skel h-[420px]" />
        </div>
      ) : dataError instanceof NotIngestedError ? (
        <div className="oc-card p-10 sm:p-14 text-center space-y-5 max-w-xl mx-auto oc-fade">
          <span
            className={
              'w-14 h-14 rounded-2xl bg-primary/15 text-[#ff8d85] inline-flex items-center justify-center' +
              (unlockWorking ? ' oc-pulse' : '')
            }
          >
            <LockIcon size={24} />
          </span>
          <p className="text-base-content/70 leading-relaxed">
            {resource?.format === 'XLSX' || resource?.format === 'XLS'
              ? t('resource.not_unlocked_excel')
              : t('resource.not_unlocked_csv')}{' '}
            {t('resource.one_click')}
          </p>
          <div className="flex justify-center">
            <button
              className="btn btn-primary rounded-xl px-7 shadow-lg shadow-primary/25"
              onClick={handleUnlock}
              disabled={unlockWorking && !unlockJob}
            >
              {unlockWorking && (
                <span className="loading loading-spinner loading-xs"></span>
              )}
              {unlockState === null
                ? t('resource.unlock')
                : unlockState === 'queued'
                  ? (unlockJob && unlockJob.status === 'running' ? t('resource.loading_data') : t('resource.queued'))
                  : t('resource.failed_retry')}
            </button>
          </div>
          {unlockState === 'queued' && (
            <p className="text-xs text-base-content/40">{t('resource.will_appear')}</p>
          )}
          {unlockState === 'failed' && unlockJob && unlockJob.error && (
            <p className="text-xs text-base-content/40">{unlockJob.error}</p>
          )}
        </div>
      ) : dataError instanceof FileOnlyError ? (
        <div className="oc-card p-10 text-center space-y-4 max-w-xl mx-auto oc-fade">
          <span className="w-14 h-14 rounded-2xl bg-base-300/60 text-base-content/60 inline-flex items-center justify-center">
            <FileIcon size={24} />
          </span>
          <p className="text-base-content/70">{t('resource.file_only')}</p>
          <a
            href={dataError.download_url}
            className="btn btn-outline btn-sm rounded-lg gap-1.5 border-base-content/20"
          >
            <DownloadIcon size={13} />
            {t('resource.download_here')}
          </a>
        </div>
      ) : dataError ? (
        <div className="alert alert-error">{dataError.message}</div>
      ) : data ? (
        <>
          <div className="oc-seg">
            <button
              className={'oc-seg-btn' + (view === 'table' ? ' oc-seg-active' : '')}
              onClick={() => setView('table')}
            >
              <TableIcon size={13} />
              {t('resource.table')}
            </button>
            <button
              className={'oc-seg-btn' + (view === 'chart' ? ' oc-seg-active' : '')}
              onClick={() => setView('chart')}
            >
              <LineChartIcon size={13} />
              {t('resource.chart')}
            </button>
          </div>
          {view === 'chart' ? (
            <ChartPanel resourceId={id} q={debouncedQ || undefined} filters={Object.keys(exportFilters).length ? exportFilters : undefined} fields={data.fields} queryMode={data.mode} />
          ) : (
            <div className={dataLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
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
            </div>
          )}
          {data.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                aria-label={t('resource.prev')}
              >
                <ArrowLeftIcon size={14} />
              </button>
              <span className="text-sm text-base-content/60 font-mono tabular-nums">
                {t('resource.page')} {page + 1} / {totalPages}
              </span>
              <button
                className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
                disabled={(page + 1) * PAGE_SIZE >= data.total}
                onClick={() => setPage(page + 1)}
                aria-label={t('resource.next')}
              >
                <ArrowRightIcon size={14} />
              </button>
            </div>
          )}
        </>
      ) : (
        <LoadingSpinner label={t('resource.querying')} />
      )}
    </div>
  );
}

export default ResourcePage;
