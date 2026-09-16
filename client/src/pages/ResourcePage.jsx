import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  fetchResource,
  queryResource,
} from '../api/catalog.js';
import {
  NotFoundError,
  NotIngestedError,
  FileOnlyError,
  DatastoreFilterError,
  apiUrl,
} from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import useResourcePreparation from '../hooks/useResourcePreparation.js';
import PreparationStatus from '../components/PreparationStatus.jsx';
import useElapsed from '../hooks/useElapsed.js';
import { formatDuration } from '../utils/time.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import { track } from '../utils/analytics.js';
import DataTable from '../components/DataTable.jsx';
// Recharts is heavy and only needed on the Chart tab - split it into its own
// chunk so the rest of the app stays lean.
const ChartPanel = lazy(() => import('../components/ChartPanel.jsx'));
const MapPanel = lazy(() => import('../components/MapPanel.jsx'));
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ResourceBadge from '../components/ResourceBadge.jsx';
import Provenance from '../components/Provenance.jsx';
import CatalogOverview from '../components/CatalogOverview.jsx';
import LocalGuides from '../components/LocalGuides.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import { useLang } from '../i18n.jsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  SearchIcon,
  TableIcon,
  LineChartIcon,
  FileIcon,
  MapIcon,
  BuildingIcon,
} from '../components/Icons.jsx';

const PAGE_SIZE = 50;
const MAX_QUERY_OFFSET = 10000;
const MAX_PAGE_INDEX = Math.floor(MAX_QUERY_OFFSET / PAGE_SIZE);
function ResourceExplorer({ id }) {
  const { lang, t } = useLang();

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
    return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGE_INDEX) : 0;
  });

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [view, setView] = useState(() => {
    const requested = searchParams.get('view');
    return requested === 'chart' || requested === 'map' ? requested : 'table';
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [filterUpgrade, setFilterUpgrade] = useState(false);
  const [schemaChanged, setSchemaChanged] = useState(false);
  const onPrepared = useCallback(() => setReloadKey(k => k + 1), []);
  useEffect(() => {
    if (resource && view === 'map' && !resource.map) setView('table');
  }, [resource, view]);

  const debouncedQ = useDebouncedValue(q, 250);
  const debouncedFilters = useDebouncedValue(columnFilters, 250);
  const hasNonEq = Object.values(buildColumnFilters(debouncedFilters)).some(f => f.op !== 'eq');
  const preparation = useResourcePreparation({ id, resource, active: view !== 'map',
    needsLocal: view === 'chart' || hasNonEq || filterUpgrade, onReady: onPrepared });
  const loadElapsed = useElapsed(preparation.job?.age_seconds, preparation.working);
  const preparationRequired = resource && (resource.query_mode === 'ingestable' ||
    (view === 'chart' && resource.query_mode !== 'ingested'));
  const previousSnapshot = useRef(null);
  useEffect(() => {
    const stamp = resource?.ingestion?.ingested_at;
    const fields = resource?.ingestion?.fields;
    if (stamp && previousSnapshot.current && previousSnapshot.current !== stamp && fields) {
      const names = new Set(fields.map(f => f.id));
      const valid = Object.fromEntries(Object.entries(columnFilters).filter(([name]) => names.has(name)));
      const removedFilter = Object.keys(valid).length !== Object.keys(columnFilters).length;
      const removedSort = sort && !names.has(sort.replace(/\s+(asc|desc)$/i, ''));
      if (removedFilter) setColumnFilters(valid);
      if (removedSort) setSort(null);
      if (removedFilter || removedSort) setSchemaChanged(true);
      setPage(0);
    }
    if (stamp) previousSnapshot.current = stamp;
  }, [resource, columnFilters, sort]);


  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchResource(id, { signal: controller.signal })
      .then((env) => {
        if (!cancelled) {
          setResource(env.data);
          track('resource_open', {
            resource_id: env.data.id,
            dataset_id: env.data.dataset?.id || '',
            format: env.data.format || '',
            query_mode: env.data.query_mode || '',
            source: 'page',
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof NotFoundError) setNotFound(true);
          else setResourceError(err);
        }
      });
    return () => { cancelled = true; controller.abort(); };
  }, [id, reloadKey]);

  useEffect(() => {
    const active = Object.fromEntries(Object.entries(debouncedFilters).filter(([, value]) => value));
    if (Object.keys(active).length) {
      track('resource_filter', { resource_id: id, filters: JSON.stringify(active) });
    }
  }, [id, debouncedFilters]);

  // Snap back to the first page when the query changes - but not on the mount
  // run (every effect runs once on mount), which would wipe a ?page= deep-link
  // right after the state initializer restored it.
  const pageResetArmedRef = useRef(false);
  useEffect(() => {
    if (!pageResetArmedRef.current) {
      pageResetArmedRef.current = true;
      return;
    }
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
    if (view !== 'table') next.view = view;
    setSearchParams(next, { replace: true });
  }, [debouncedQ, debouncedFilters, sort, page, view, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    if (view === 'map') {
      setDataLoading(false);
      return () => { cancelled = true; };
    }
    setDataLoading(true);

    if (!resource || preparationRequired || (resource.query_mode === 'datastore' && hasNonEq)) {
      setDataLoading(false);
      return () => { cancelled = true; };
    }
    const filters = buildColumnFilters(debouncedFilters);
    const controller = new AbortController();
    queryResource(id, {
      q: debouncedQ || undefined,
      filters: Object.keys(filters).length ? filters : undefined,
      sort: sort || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }, { signal: controller.signal })
      .then((env) => {
        if (!cancelled) {
          setData({
            fields: env.data.fields,
            records: env.data.records,
            total: env.data.total,
            mode: env.meta.query_mode,
          });
          setDataError(null);
          track('resource_query', {
            resource_id: id,
            query: debouncedQ || '',
            filters: JSON.stringify(debouncedFilters),
            sort: sort || '',
            page: page + 1,
            query_mode: env.meta.query_mode || '',
            total: Number(env.data.total) || 0,
            status: 'success',
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DatastoreFilterError) {
          // Fallback for the first load before the mode is known: the proxy
          // rejected a non-equality filter, so upgrade to local storage. The
          // rows already on screen stay visible while the ingest runs.
          setFilterUpgrade(true);
          return;
        }
        track('resource_query', {
          resource_id: id,
          query: debouncedQ || '',
          filters: JSON.stringify(debouncedFilters),
          sort: sort || '',
          page: page + 1,
          status: err instanceof NotIngestedError ? 'not_loaded' : err instanceof FileOnlyError ? 'file_only' : 'failed',
        });
        if (err instanceof NotIngestedError && resource.query_mode !== 'ingestable') onPrepared();
        setData(null);
        setDataError(err);
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => { cancelled = true; controller.abort(); };
  }, [id, debouncedQ, debouncedFilters, sort, page, view, reloadKey, resource, preparationRequired, hasNonEq, onPrepared]);

  const exportFilters = buildColumnFilters(debouncedFilters);
  const exportHref = apiUrl('/api/v1/resources/' + id + '/query.csv', {
    q: debouncedQ || undefined,
    filters: Object.keys(exportFilters).length ? exportFilters : undefined,
    sort: sort || undefined,
  });

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

  const totalPages = data
    ? Math.min(MAX_PAGE_INDEX + 1, Math.max(1, Math.ceil(data.total / PAGE_SIZE)))
    : 1;


  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6 space-y-4">
      {resourceError && (
        <div className="alert alert-error my-4">{resourceError.message}</div>
      )}
      {resource && (
        <div className="space-y-2.5 cq-fade">
          <Breadcrumbs
            label={t('breadcrumbs.label')}
            items={[
              { label: t('nav.datasets'), to: '/datasets' },
              {
                label: resource.dataset.title?.[lang] || resource.dataset.title?.en || resource.dataset.name,
                to: `/datasets/${resource.dataset.name || resource.dataset.id}`
              },
              { label: resource.name?.[lang] || resource.name?.en || resource.name?.fr || resource.id }
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold font-display tracking-tight">
              {resource.presentation?.title?.[lang] || resource.name?.[lang] || resource.name?.en || resource.name?.fr || resource.id}
            </h1>
            <ResourceBadge mode={resource.query_mode} />
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="cq-nav-link !text-xs opacity-70"
              data-analytics-event="resource_download"
              data-analytics-resource-id={id}
              data-analytics-format={resource.format || ''}
              data-analytics-source="resource_header"
            >
              <DownloadIcon size={13} />
              {t('resource.raw')}
            </a>
          </div>
          {resource.dataset.organization && (
            <Link
              to={'/organizations/' + encodeURIComponent(resource.dataset.organization.name)}
              className="inline-flex items-center gap-1.5 text-sm text-base-content/55 hover:text-base-content"
            >
              <BuildingIcon size={13} />
              {resource.dataset.organization.title?.[lang] ||
                resource.dataset.organization.title?.en ||
                resource.dataset.organization.title?.fr ||
                resource.dataset.organization.name}
            </Link>
          )}
          {resource.last_modified && <p className="text-xs text-base-content/60">{t('preview.resource_updated')} {new Date(resource.last_modified).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</p>}
          <Provenance provenance={resource.provenance} compact />
          {resource.presentation?.context?.[lang] && <p className="max-w-3xl whitespace-pre-wrap break-words text-base-content/70">{resource.presentation.context[lang]}</p>}
          <CatalogOverview presentation={resource.presentation} />
        </div>
      )}

      {view !== 'map' && resource?.ingestion?.ingested_at && (
        <p className="text-xs text-base-content/60">
          {t('preparation.prepared_at')}{' '}
          <time dateTime={resource.ingestion.ingested_at}>{new Date(resource.ingestion.ingested_at).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</time>
          {resource.preparation?.freshness !== 'current' && <> · {t('preparation.older_copy')}</>}
        </p>
      )}
      {schemaChanged && <p role="status" className="text-sm">{t('preparation.schema_changed')}</p>}
      {view !== 'map' && !preparationRequired && (preparation.phase !== 'idle' || (resource?.query_mode === 'datastore' && hasNonEq)) && (
        <PreparationStatus preparation={preparation} elapsed={formatDuration(loadElapsed)} compact />
      )}

      {view !== 'map' && <div className="flex flex-wrap gap-2.5 items-center">
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
            data-analytics-event="resource_export"
            data-analytics-resource-id={id}
            data-analytics-query={debouncedQ || ''}
            data-analytics-filters={JSON.stringify(exportFilters)}
            data-analytics-sort={sort || ''}
          >
            <DownloadIcon size={13} />
            {t('resource.download_filtered')}
          </a>
        )}
      </div>}

      {resource && (
        <div className="cq-seg w-fit">
          <button
            className={'cq-seg-btn' + (view === 'table' ? ' cq-seg-active' : '')}
            onClick={() => { track('resource_view', { resource_id: id, view: 'table' }); setView('table'); }}
          >
            <TableIcon size={13} />
            {t('resource.table')}
          </button>
          <button
            className={'cq-seg-btn' + (view === 'chart' ? ' cq-seg-active' : '')}
            onClick={() => { track('resource_view', { resource_id: id, view: 'chart' }); setView('chart'); }}
          >
            <LineChartIcon size={13} />
            {t('resource.chart')}
          </button>
          {resource.map && (
            <button
              className={'cq-seg-btn' + (view === 'map' ? ' cq-seg-active' : '')}
              onClick={() => { track('resource_view', { resource_id: id, view: 'map' }); setView('map'); }}
            >
              <MapIcon size={13} />
              {t('places.map')}
            </button>
          )}
        </div>
      )}

      {view === 'map' ? (
        resource?.map ? (
          <Suspense fallback={<div className="cq-skel h-[560px] rounded-xl" />}>
            <MapPanel resourceId={id} map={resource.map} />
          </Suspense>
        ) : <LoadingSpinner label={t('map.loading')} />
      ) : dataLoading && !data && !preparationRequired ? (
        <div className="space-y-3">
          <div className="cq-skel h-10 w-64" />
          <div className="cq-skel h-[420px]" />
        </div>
      ) : preparationRequired || dataError instanceof NotIngestedError ? (
        <PreparationStatus preparation={preparation} elapsed={formatDuration(loadElapsed)} />
      ) : dataError instanceof FileOnlyError ? (
        <div className="cq-card p-10 text-center space-y-4 max-w-xl mx-auto cq-fade">
          <span className="w-14 h-14 rounded-2xl bg-base-300/60 text-base-content/60 inline-flex items-center justify-center">
            <FileIcon size={24} />
          </span>
          <p className="text-base-content/70">{t('resource.file_only')}</p>
          <a
            href={dataError.download_url}
            className="btn btn-outline btn-sm rounded-lg gap-1.5 border-base-content/20"
            data-analytics-event="resource_download"
            data-analytics-resource-id={id}
            data-analytics-source="file_only"
          >
            <DownloadIcon size={13} />
            {t('resource.download_here')}
          </a>
        </div>
      ) : dataError ? (
        <div className="alert alert-error">{dataError.message}</div>
      ) : data ? (
        <>
          {view === 'chart' ? (
            <Suspense fallback={<div className="cq-skel h-[420px] rounded-xl" />}>
              <ChartPanel key={resource?.ingestion?.ingested_at || id} resourceId={id} q={debouncedQ || undefined} filters={Object.keys(exportFilters).length ? exportFilters : undefined} fields={resource?.ingestion?.fields || data.fields} queryMode={data.mode} />
            </Suspense>
          ) : (
            <div className={dataLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <DataTable
                fields={data.fields}
                records={data.records}
                sort={sort}
                onSortChange={(next) => {
                  track('resource_sort', { resource_id: id, sort: next || '' });
                  setSort(next);
                }}
                columnFilters={columnFilters}
                onColumnFilterChange={(id, text) =>
                  setColumnFilters((prev) => ({ ...prev, [id]: text }))
                }
              />
            </div>
          )}
          {view !== 'chart' && data.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
                disabled={page === 0}
                onClick={() => {
                  track('resource_page', { resource_id: id, page: page, direction: 'previous' });
                  setPage(page - 1);
                }}
                aria-label={t('resource.prev')}
              >
                <ArrowLeftIcon size={14} />
              </button>
              <span className="text-sm text-base-content/60 font-mono tabular-nums">
                {t('resource.page')} {page + 1} / {totalPages}
              </span>
              <button
                className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
                disabled={page >= MAX_PAGE_INDEX || (page + 1) * PAGE_SIZE >= data.total}
                onClick={() => {
                  track('resource_page', { resource_id: id, page: page + 2, direction: 'next' });
                  setPage(page + 1);
                }}
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
      {resource?.dataset?.id && <LocalGuides dataset={resource.dataset.id} />}
    </div>
  );
}

// React Router reuses the route element when only :id changes. Key the
// stateful explorer so filters, sorting, pagination, loaded rows and mutable
// refs from one resource can never carry into the next resource.
function ResourcePage() {
  const { id } = useParams();
  return <ResourceExplorer key={id} id={id} />;
}

export default ResourcePage;
