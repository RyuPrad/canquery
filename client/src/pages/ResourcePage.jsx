import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { NotIngestedError, FileOnlyError, apiUrl } from '../api/client.js';
import useResourceUrl from '../hooks/useResourceUrl.js';
import useResourceMetadata from '../hooks/useResourceMetadata.js';
import useResourceRows from '../hooks/useResourceRows.js';
import { PAGE_SIZE, MAX_PAGE_INDEX, resourceViewState } from '../utils/resourceExplorerState.js';
import useResourcePreparation from '../hooks/useResourcePreparation.js';
import useResourceActivity from '../hooks/useResourceActivity.js';
import PreparationStatus from '../components/PreparationStatus.jsx';
import useElapsed from '../hooks/useElapsed.js';
import { formatDuration } from '../utils/time.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import { schemaFingerprint, reconcileResourceFields } from '../utils/resourceSchema.js';
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
  BuildingIcon
} from '../components/Icons.jsx';

function ResourceExplorer({ id, navigationKey }) {
  const { lang, t } = useLang();
  const {
    resource,
    error: resourceError,
    notFound,
    reload: onPrepared,
    revision: reloadKey
  } = useResourceMetadata(id);
  const {
    q,
    setQ,
    columnFilters,
    setColumnFilters,
    sort,
    setSort,
    page,
    setPage,
    view,
    setView,
    debouncedQ,
    debouncedFilters
  } = useResourceUrl(navigationKey);
  const [filterUpgrade, setFilterUpgrade] = useState(false);
  const [schemaChanged, setSchemaChanged] = useState(false);
  const hasNonEq = Object.values(buildColumnFilters(debouncedFilters)).some(
    (filter) => filter.op !== 'eq'
  );
  const fileOnly = resource?.query_mode === 'file-only';
  const preparationRequired =
    resource &&
    !fileOnly &&
    (resource.query_mode === 'ingestable' ||
      (view === 'chart' && resource.query_mode !== 'ingested'));
  const filtersNeedPreparation = resource?.query_mode === 'datastore' && hasNonEq;
  const fields = resource?.ingestion?.fields;
  const fingerprint = schemaFingerprint(fields);
  const [observedSchema, setObservedSchema] = useState(null);
  const reconciled = reconcileResourceFields(columnFilters, sort, fields);
  const appliedFields = reconcileResourceFields(debouncedFilters, sort, fields);
  const schemaReady =
    fingerprint === null ||
    (observedSchema === fingerprint && !reconciled.changed && !appliedFields.changed);
  useEffect(() => {
    if (fingerprint === null) return;
    if (reconciled.changed) {
      setColumnFilters(reconciled.filters);
      setSort(reconciled.sort);
    }
    if ((observedSchema !== null && observedSchema !== fingerprint) || reconciled.changed) {
      setSchemaChanged(true);
      setPage(0);
    }
    setObservedSchema(fingerprint);
  }, [
    fingerprint,
    observedSchema,
    reconciled.changed,
    reconciled.filters,
    reconciled.sort,
    setColumnFilters,
    setSort,
    setPage
  ]);

  const expiredResource = useRef(null);
  const reloadAfterExpiry = useCallback(() => {
    if (!resource || expiredResource.current === resource) return false;
    expiredResource.current = resource;
    onPrepared();
    return true;
  }, [resource, onPrepared]);
  const {
    data,
    error: dataError,
    loading: dataLoading,
    invalidate
  } = useResourceRows({
    id,
    resource,
    view,
    debouncedQ,
    debouncedFilters,
    sort,
    page,
    reloadKey,
    preparationRequired,
    fileOnly,
    hasNonEq,
    schemaReady,
    setFilterUpgrade,
    onUnavailable: reloadAfterExpiry
  });
  const onUnavailable = useCallback(() => {
    if (reloadAfterExpiry()) invalidate();
  }, [reloadAfterExpiry, invalidate]);
  useResourceActivity({ id, resource, active: view !== 'map', onUnavailable });
  const preparation = useResourcePreparation({
    id,
    resource,
    active: view !== 'map',
    needsLocal: view === 'chart' || hasNonEq || filterUpgrade,
    onReady: onPrepared
  });
  const loadElapsed = useElapsed(preparation.job?.age_seconds, preparation.working);
  useEffect(() => {
    if (resource && view === 'map' && !resource.map) setView('table');
  }, [resource, view, setView]);
  useEffect(() => {
    const active = Object.fromEntries(
      Object.entries(debouncedFilters).filter(([, value]) => value)
    );
    if (Object.keys(active).length)
      track('resource_filter', { resource_id: id, filters: JSON.stringify(active) });
  }, [id, debouncedFilters]);

  const changeSort = useCallback(
    (next) => {
      track('resource_sort', { resource_id: id, sort: next || '' });
      setSort(next);
    },
    [id, setSort]
  );
  const changeColumnFilter = useCallback(
    (field, text) => {
      setColumnFilters((previous) => ({ ...previous, [field]: text }));
    },
    [setColumnFilters]
  );

  const exportFilters = buildColumnFilters(debouncedFilters);
  const exportHref = apiUrl('/web-api/v1/resources/' + id + '/query.csv', {
    q: debouncedQ || undefined,
    filters: Object.keys(exportFilters).length ? exportFilters : undefined,
    sort: sort || undefined
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

  // Metadata owns the layout above the explorer. Showing its controls first
  // moves them across the viewport when the title and overview arrive.
  // A refresh retains the existing metadata and serving rows instead.
  if (!resource) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6">
        {resourceError ? (
          <div className="alert alert-error" role="alert">
            <span>{resourceError.message}</span>
            <button type="button" className="btn btn-sm" onClick={onPrepared}>
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <div
            role="status"
            aria-label={t('resource.loading_data')}
            aria-busy="true"
            className="space-y-4"
          >
            <span className="sr-only">{t('resource.loading_data')}</span>
            <div className="cq-skel h-8 w-2/3" aria-hidden="true" />
            <div className="cq-skel h-40" aria-hidden="true" />
            <div className="cq-skel h-[420px]" aria-hidden="true" />
          </div>
        )}
      </div>
    );
  }

  const downloadOnly = fileOnly || (view === 'table' && dataError instanceof FileOnlyError);
  const downloadOnlyUrl = fileOnly ? resource.url : dataError?.download_url;
  const display = resourceViewState({
    view,
    hasMap: Boolean(resource.map),
    filtersNeedPreparation,
    hasData: Boolean(data),
    dataLoading,
    preparationRequired,
    downloadOnly,
    rowUnavailable: dataError instanceof NotIngestedError,
    rowError: Boolean(dataError)
  });

  const totalPages = data
    ? Math.min(MAX_PAGE_INDEX + 1, Math.max(1, Math.ceil(data.total / PAGE_SIZE)))
    : 1;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6 space-y-4">
      {resourceError && (
        <div className="alert alert-error my-4" role="alert">
          <span>{resourceError.message}</span>
          <button type="button" className="btn btn-sm" onClick={onPrepared}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {resource && (
        <div className="space-y-2.5">
          <Breadcrumbs
            label={t('breadcrumbs.label')}
            items={[
              { label: t('nav.datasets'), to: '/datasets' },
              {
                label:
                  resource.dataset.title?.[lang] ||
                  resource.dataset.title?.en ||
                  resource.dataset.name,
                to: `/datasets/${resource.dataset.name || resource.dataset.id}`
              },
              {
                label:
                  resource.presentation?.title?.[lang] ||
                  resource.name?.[lang] ||
                  resource.name?.en ||
                  resource.name?.fr ||
                  resource.id
              }
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold font-display tracking-tight">
              {resource.presentation?.title?.[lang] ||
                resource.name?.[lang] ||
                resource.name?.en ||
                resource.name?.fr ||
                resource.id}
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
          {resource.last_modified && (
            <p className="text-xs text-base-content/60">
              {t('preview.resource_updated')}{' '}
              {new Date(resource.last_modified).toLocaleDateString(
                lang === 'fr' ? 'fr-CA' : 'en-CA'
              )}
            </p>
          )}
          <Provenance provenance={resource.provenance} compact />
          {resource.presentation?.context?.[lang] && (
            <p className="max-w-3xl whitespace-pre-wrap break-words text-base-content/70">
              {resource.presentation.context[lang]}
            </p>
          )}
          <CatalogOverview presentation={resource.presentation} />
        </div>
      )}

      {view !== 'map' && resource?.ingestion?.ingested_at && (
        <p className="text-xs text-base-content/60">
          {t('preparation.prepared_at')}{' '}
          <time dateTime={resource.ingestion.ingested_at}>
            {new Date(resource.ingestion.ingested_at).toLocaleString(
              lang === 'fr' ? 'fr-CA' : 'en-CA'
            )}
          </time>
          {resource.preparation?.freshness !== 'current' && <> · {t('preparation.older_copy')}</>}
        </p>
      )}
      {schemaChanged && (
        <p role="status" className="text-sm">
          {t('preparation.schema_changed')}
        </p>
      )}
      {view !== 'map' &&
        !preparationRequired &&
        !filtersNeedPreparation &&
        preparation.phase !== 'idle' && (
          <PreparationStatus
            preparation={preparation}
            elapsed={formatDuration(loadElapsed)}
            compact
          />
        )}
      {view === 'table' && filtersNeedPreparation && (
        <div className="cq-card p-4 space-y-2" role="status">
          <p>
            {t(
              !preparation.supported || !preparation.enabled || preparation.phase === 'unavailable'
                ? 'resource.upgrade_unavailable'
                : preparation.phase === 'failed'
                  ? 'resource.upgrade_failed'
                  : 'resource.upgrading'
            )}
          </p>
          {data && (
            <p className="text-sm text-base-content/60">{t('resource.filters_not_applied')}</p>
          )}
          {preparation.supported && preparation.enabled && (
            <PreparationStatus
              preparation={preparation}
              elapsed={formatDuration(loadElapsed)}
              compact
            />
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => {
              setColumnFilters({});
              setFilterUpgrade(false);
            }}
          >
            {t('resource.clear_column_filters')}
          </button>
        </div>
      )}

      {view !== 'map' && !downloadOnly && (
        <div className="flex flex-wrap gap-2.5 items-center">
          <div className="cq-search cq-search-sm w-full sm:w-80">
            <SearchIcon size={14} className="opacity-40 shrink-0" />
            <input
              placeholder={t('resource.search_placeholder')}
              aria-label={t('resource.search_placeholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {data && (
            <span className="cq-chip cq-chip-mono ml-auto">
              {data.total.toLocaleString()} {t('resource.rows')}
            </span>
          )}
          {data && !filtersNeedPreparation && (
            <a
              className="btn btn-sm btn-outline border-base-content/20 rounded-lg gap-1.5 font-normal"
              href={exportHref}
              rel="nofollow"
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
        </div>
      )}

      {resource && (
        <div className="cq-seg w-fit">
          <button
            className={'cq-seg-btn' + (view === 'table' ? ' cq-seg-active' : '')}
            aria-pressed={view === 'table'}
            onClick={() => {
              track('resource_view', { resource_id: id, view: 'table' });
              setView('table');
            }}
          >
            <TableIcon size={13} />
            {t('resource.table')}
          </button>
          <button
            className={'cq-seg-btn' + (view === 'chart' ? ' cq-seg-active' : '')}
            aria-pressed={view === 'chart'}
            onClick={() => {
              track('resource_view', { resource_id: id, view: 'chart' });
              setView('chart');
            }}
          >
            <LineChartIcon size={13} />
            {t('resource.chart')}
          </button>
          {resource.map && (
            <button
              className={'cq-seg-btn' + (view === 'map' ? ' cq-seg-active' : '')}
              aria-pressed={view === 'map'}
              onClick={() => {
                track('resource_view', { resource_id: id, view: 'map' });
                setView('map');
              }}
            >
              <MapIcon size={13} />
              {t('places.map')}
            </button>
          )}
        </div>
      )}

      {display === 'map' || display === 'map-loading' ? (
        display === 'map' ? (
          <Suspense fallback={<div className="cq-skel h-[560px] rounded-xl" />}>
            <MapPanel resourceId={id} map={resource.map} />
          </Suspense>
        ) : (
          <LoadingSpinner label={t('map.loading')} />
        )
      ) : display === 'filter-preparation' ? null : display === 'loading' ? (
        <div className="space-y-3">
          <div className="cq-skel h-10 w-64" />
          <div className="cq-skel h-[420px]" />
        </div>
      ) : display === 'download' ? (
        <div className="cq-card p-10 text-center space-y-4 max-w-xl mx-auto cq-fade">
          <span className="w-14 h-14 rounded-2xl bg-base-300/60 text-base-content/60 inline-flex items-center justify-center">
            <FileIcon size={24} />
          </span>
          <p className="text-base-content/70">{t('resource.file_only')}</p>
          {downloadOnlyUrl && (
            <a
              href={downloadOnlyUrl}
              className="btn btn-outline btn-sm rounded-lg gap-1.5 border-base-content/20"
              data-analytics-event="resource_download"
              data-analytics-resource-id={id}
              data-analytics-source="file_only"
            >
              <DownloadIcon size={13} />
              {t('resource.download_here')}
            </a>
          )}
        </div>
      ) : display === 'preparation' ? (
        <PreparationStatus preparation={preparation} elapsed={formatDuration(loadElapsed)} />
      ) : display === 'chart' ? (
        <Suspense fallback={<div className="cq-skel h-[420px] rounded-xl" />}>
          {schemaReady && (
            <ChartPanel
              key={JSON.stringify([
                resource?.ingestion?.snapshot_id || resource?.ingestion?.ingested_at || id,
                fingerprint
              ])}
              resourceId={id}
              q={debouncedQ || undefined}
              filters={Object.keys(exportFilters).length ? exportFilters : undefined}
              fields={fields || []}
              queryMode={resource.query_mode}
              onUnavailable={onUnavailable}
            />
          )}
        </Suspense>
      ) : display === 'error' ? (
        <div className="alert alert-error">{dataError.message}</div>
      ) : display === 'table' ? (
        <>
          <div className={dataLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <DataTable
              fields={data.fields}
              records={data.records}
              sort={sort}
              onSortChange={changeSort}
              columnFilters={columnFilters}
              onColumnFilterChange={changeColumnFilter}
            />
          </div>
          {data.total > PAGE_SIZE && (
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
  const location = useLocation();
  // Local edits replace the current history entry without remounting the
  // controls. A new link or Back/Forward visit restores all state from its URL,
  // even when the resource id is unchanged.
  const navigationKey = location.state?.resourceExplorerKey || location.key;
  return <ResourceExplorer key={id + ':' + navigationKey} id={id} navigationKey={navigationKey} />;
}

export default ResourcePage;
