import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
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
  DatastoreFilterError,
  apiUrl,
} from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import useJobPolling from '../hooks/useJobPolling.js';
import { readUnlockJob, writeUnlockJob, clearUnlockJob } from '../utils/unlockStore.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import DataTable from '../components/DataTable.jsx';
// Recharts is heavy and only needed on the Chart tab - split it into its own
// chunk so the rest of the app stays lean.
const ChartPanel = lazy(() => import('../components/ChartPanel.jsx'));
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
// Auto-upgrade (ingest) a proxied datastore resource only when its file is this
// size or smaller, so the transparent upgrade stays quick. Larger ones keep the
// live proxy (equality + full-text search). size_bytes is often unknown
// upstream, in which case we proceed and rely on the hard ingest cap.
const AUTO_INGEST_MAX_BYTES = 100 * 1024 * 1024;

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

  // Seed from storage so an unlock already in flight keeps showing the loading
  // indicator across a refresh instead of snapping back to the Unlock button.
  const [unlockState, setUnlockState] = useState(() => (readUnlockJob(id) ? 'queued' : null));
  const [unlockJobId, setUnlockJobId] = useState(() => readUnlockJob(id));
  const [view, setView] = useState(() => (searchParams.get('view') === 'chart' ? 'chart' : 'table'));
  const [reloadKey, setReloadKey] = useState(0);
  // Transparent upgrade of a proxied datastore resource into local storage when
  // the user needs a filter the upstream can't serve:
  // null | 'preparing' | 'blocked' (too large) | 'unavailable' (not loadable) | 'failed'.
  const [upgrade, setUpgrade] = useState(null);
  const resourceRef = useRef(null);
  const upgradeRequestedRef = useRef(false);
  const upgradedRef = useRef(false);

  // Resume (or reset) the in-flight unlock when the resource changes - covers
  // both a fresh refresh and client-side navigation between resources.
  useEffect(() => {
    const stored = readUnlockJob(id);
    setUnlockJobId(stored);
    setUnlockState(stored ? 'queued' : null);
    setUpgrade(null);
  }, [id]);

  // Keep a ref to the loaded resource so the query effect can read its mode/size
  // without taking it as a dependency. The upgrade guards reset only when the
  // resource id changes (not on the post-upgrade reload), so a given resource is
  // upgraded at most once per visit and the reload query is allowed through.
  useEffect(() => { resourceRef.current = resource; }, [resource]);
  useEffect(() => {
    upgradeRequestedRef.current = false;
    upgradedRef.current = false;
  }, [id]);

  // Stable per-resource callback: an inline arrow here would re-arm the polling
  // effect on every render and turn it into a 0ms fetch loop.
  const onUnlockDone = useCallback((job) => {
    clearUnlockJob(id);
    if (job.status === 'done') {
      // The resource is now ingested; let the reload query run against local
      // storage instead of re-detecting it as a datastore resource.
      upgradedRef.current = true;
      setUnlockJobId(null);
      setUnlockState(null);
      setUpgrade(null);
      setReloadKey((k) => k + 1);
    } else {
      setUnlockState('failed');
      setUpgrade((u) => (u === 'preparing' ? 'failed' : u));
    }
  }, [id]);
  const { job: unlockJob } = useJobPolling(unlockJobId, { onDone: onUnlockDone });

  // Pull a proxied (datastore) resource into local storage so the full filter
  // grammar works. Idempotent per visit; used both proactively (mode known) and
  // as a fallback when a query returns the upgrade hint.
  const triggerUpgrade = useCallback(() => {
    if (upgradeRequestedRef.current) return;
    const size = resourceRef.current?.size_bytes;
    if (typeof size === 'number' && size > AUTO_INGEST_MAX_BYTES) {
      upgradeRequestedRef.current = true;
      setUpgrade('blocked');
      return;
    }
    upgradeRequestedRef.current = true;
    setUpgrade('preparing');
    enqueueIngest(id)
      .then((env) => {
        writeUnlockJob(id, env.data.id);
        setUnlockJobId(env.data.id);
      })
      .catch(() => setUpgrade('unavailable'));
  }, [id]);

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
    if (view === 'chart') next.view = 'chart';
    setSearchParams(next, { replace: true });
  }, [debouncedQ, debouncedFilters, sort, page, view, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);

    const filters = buildColumnFilters(debouncedFilters);
    const hasNonEq = Object.values(filters).some((f) => f.op !== 'eq');

    // Known proxied datastore resource + a filter the upstream can't serve:
    // upgrade it locally instead of firing a query that would 400. Once the
    // upgrade has completed (upgradedRef) the reload query is allowed through.
    if (resourceRef.current?.query_mode === 'datastore' && hasNonEq && !upgradedRef.current) {
      triggerUpgrade();
      setDataLoading(false);
      return () => { cancelled = true; };
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
          setUpgrade(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DatastoreFilterError) {
          // Fallback for the first load before the mode is known: the proxy
          // rejected a non-equality filter, so upgrade to local storage. The
          // rows already on screen stay visible while the ingest runs.
          triggerUpgrade();
          return;
        }
        setData(null);
        setDataError(err);
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, debouncedQ, debouncedFilters, sort, page, reloadKey, triggerUpgrade]);

  const exportFilters = buildColumnFilters(debouncedFilters);
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
      writeUnlockJob(id, env.data.id);
    } catch {
      setUnlockState('failed');
    }
  };

  if (notFound) {
    return (
      <div className="text-center py-28 space-y-3 cq-fade">
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
        <div className="space-y-2.5 cq-fade">
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
              className="cq-nav-link !text-xs opacity-70"
            >
              <DownloadIcon size={13} />
              {t('resource.raw')}
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5 items-center">
        <div className="cq-search cq-search-sm w-full sm:w-80">
          <SearchIcon size={14} className="opacity-40 shrink-0" />
          <input
            placeholder={t('resource.search_placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {data && (
          <span className="cq-chip cq-chip-mono ml-auto">
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
          <div className="cq-skel h-10 w-64" />
          <div className="cq-skel h-[420px]" />
        </div>
      ) : dataError instanceof NotIngestedError ? (
        <div className="cq-card p-10 sm:p-14 text-center space-y-5 max-w-xl mx-auto cq-fade">
          <span
            className={
              'w-14 h-14 rounded-2xl bg-primary/15 cq-fg-red inline-flex items-center justify-center' +
              (unlockWorking ? ' cq-pulse' : '')
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
        <div className="cq-card p-10 text-center space-y-4 max-w-xl mx-auto cq-fade">
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
          {upgrade && (
            <div className="rounded-xl border border-base-content/10 bg-base-200/50 px-4 py-3 text-sm flex items-center gap-2.5 cq-fade">
              {upgrade === 'preparing' && (
                <span className="loading loading-spinner loading-xs shrink-0" />
              )}
              <span className="text-base-content/70">
                {upgrade === 'preparing'
                  ? t('resource.upgrading')
                  : upgrade === 'blocked'
                    ? t('resource.upgrade_blocked')
                    : upgrade === 'unavailable'
                      ? t('resource.upgrade_unavailable')
                      : t('resource.upgrade_failed')}
              </span>
            </div>
          )}
          <div className="cq-seg">
            <button
              className={'cq-seg-btn' + (view === 'table' ? ' cq-seg-active' : '')}
              onClick={() => setView('table')}
            >
              <TableIcon size={13} />
              {t('resource.table')}
            </button>
            <button
              className={'cq-seg-btn' + (view === 'chart' ? ' cq-seg-active' : '')}
              onClick={() => setView('chart')}
            >
              <LineChartIcon size={13} />
              {t('resource.chart')}
            </button>
          </div>
          {view === 'chart' ? (
            <Suspense fallback={<div className="cq-skel h-[420px] rounded-xl" />}>
              <ChartPanel resourceId={id} q={debouncedQ || undefined} filters={Object.keys(exportFilters).length ? exportFilters : undefined} fields={data.fields} queryMode={data.mode} />
            </Suspense>
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
