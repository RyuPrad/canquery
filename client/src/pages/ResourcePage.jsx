import { useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { NotIngestedError, FileOnlyError, apiUrl } from '../api/client.js';
import useResourceUrl from '../hooks/useResourceUrl.js';
import useResourceMetadata from '../hooks/useResourceMetadata.js';
import useResourceRows from '../hooks/useResourceRows.js';
import useResourcePreview from '../hooks/useResourcePreview.js';
import useLocalTable from '../hooks/useLocalTable.js';
import { buildCsv, csvFilename, downloadCsv } from '../utils/csvExport.js';
import { refusalOf } from '../utils/localTable.js';
import { PAGE_SIZE, MAX_PAGE_INDEX, resourceViewState } from '../utils/resourceExplorerState.js';
import useResourcePreparation from '../hooks/useResourcePreparation.js';
import useResourceActivity from '../hooks/useResourceActivity.js';
import PreparationStatus from '../components/PreparationStatus.jsx';
import ChartLoadCard from '../components/ChartLoadCard.jsx';
import {
  ChartLoadContext,
  createChartLoadStore,
  useChartLoadReport
} from '../hooks/useChartLoadReport.js';
import { preparationCovered } from '../utils/chartLoadProgress.js';
import useElapsed from '../hooks/useElapsed.js';
import { formatDuration } from '../utils/time.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import { schemaFingerprint, reconcileResourceFields } from '../utils/resourceSchema.js';
import { takeInitialData, consumeInitialData } from '../utils/initialData.js';
import { track } from '../utils/analytics.js';
import { allowQuery } from '../utils/queryGate.js';
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
import DatasetAlertSlot from '../components/DatasetAlertSlot.jsx';
import QueryGateSlot from '../components/QueryGateSlot.jsx';
import WatchTableSlot from '../components/WatchTableSlot.jsx';
import { rememberView } from '../utils/recentlyViewed.js';
import DatasetHubLink from '../components/DatasetHubLink.jsx';
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

// The CSV export's row limit, also for a download built in the browser.
const EXPORT_MAX_ROWS = 10000;

// The chart area while its code or schema is not ready yet; the loading card
// counts it as "opening the chart".
function ChartFallback() {
  useChartLoadReport('chunk', 'loading');
  return <div className="cq-skel h-[420px] rounded-xl" />;
}

// Previous/Next plus a page box. A typed page is clamped to the last page the
// server can serve; an unseen page keeps the current rows while it loads.
// While only the first rows of a file are held the total is unknown: the pager
// then shows the page alone, and Next stays open unless the table can't grow.
// onPage answers false when the page change was not made (a typed page stays).
function Pager({ resourceId, page, total, onPage, lastPage = null }) {
  const { t } = useLang();
  const [draft, setDraft] = useState('');
  const known = typeof total === 'number' && Number.isFinite(total);
  const totalPages = known
    ? Math.min(MAX_PAGE_INDEX + 1, Math.max(1, Math.ceil(total / PAGE_SIZE)))
    : null;
  const pageCount = totalPages ?? Math.min(MAX_PAGE_INDEX, lastPage ?? MAX_PAGE_INDEX) + 1;
  const jump = (event) => {
    event.preventDefault();
    const requested = Number.parseInt(draft, 10);
    if (!Number.isFinite(requested)) return;
    const target = Math.min(Math.max(requested, 1), pageCount) - 1;
    if (target === page) {
      setDraft('');
      return;
    }
    if (!onPage(target)) return;
    setDraft('');
    track('resource_page', { resource_id: resourceId, page: target + 1, direction: 'jump' });
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
      <button
        className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
        disabled={page === 0}
        onClick={() => {
          if (onPage(page - 1))
            track('resource_page', { resource_id: resourceId, page: page, direction: 'previous' });
        }}
        aria-label={t('resource.prev')}
      >
        <ArrowLeftIcon size={14} />
      </button>
      <span className="text-sm text-base-content/60 font-mono tabular-nums">
        {t('resource.page')} {page + 1}
        {totalPages !== null && <> / {totalPages}</>}
      </span>
      <button
        className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
        disabled={page >= pageCount - 1}
        onClick={() => {
          if (onPage(page + 1))
            track('resource_page', { resource_id: resourceId, page: page + 2, direction: 'next' });
        }}
        aria-label={t('resource.next')}
      >
        <ArrowRightIcon size={14} />
      </button>
      <form className="flex items-center gap-1.5" onSubmit={jump} noValidate>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={pageCount}
          step={1}
          className="input input-sm w-20 rounded-lg border-base-content/20 text-center font-mono tabular-nums"
          aria-label={t('resource.go_to_page')}
          placeholder={t('resource.go_to_page')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
          disabled={!draft}
        >
          {t('resource.go')}
        </button>
      </form>
    </div>
  );
}

function ResourceExplorer({ id, navigationKey }) {
  const { lang, t } = useLang();
  const location = useLocation();
  // A direct visit's HTML carries this page's metadata and first rows.
  const [initial] = useState(() => takeInitialData({ id, location }));
  useEffect(() => {
    consumeInitialData();
  }, []);
  const {
    resource,
    error: resourceError,
    notFound,
    reload: onPrepared
  } = useResourceMetadata(id, { initial: initial?.resource ?? null });
  // The homepage's "Recently viewed" rail (this browser only).
  const viewedId = resource?.id;
  useEffect(() => {
    if (!resource) return;
    rememberView({
      kind: 'resource',
      id: resource.id,
      title: {
        en:
          resource.presentation?.title?.en || resource.name?.en || resource.name?.fr || resource.id,
        fr: resource.presentation?.title?.fr || resource.name?.fr || ''
      },
      path: '/resources/' + encodeURIComponent(resource.id)
    });
  }, [viewedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const {
    q,
    setQ,
    columnFilters,
    setColumnFilters,
    renameColumns,
    sort,
    setSort,
    page,
    setPage,
    view,
    setView,
    debouncedQ,
    debouncedFilters
  } = useResourceUrl(navigationKey);
  // A CSV's first rows, read from the start of the publisher's file.
  const { preview, failed: previewFailed } = useResourcePreview({
    id,
    enabled:
      view === 'table' &&
      resource?.query_mode === 'ingestable' &&
      String(resource.format || '').toUpperCase() === 'CSV'
  });
  // The whole table in the browser when it fits, else its first rows.
  const local = useLocalTable({ id, resource, view, preview });
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
  // A small live table held in the browser answers the filters it can read
  // (not, for example, a range on a text column). While it can still come, a
  // filter the live portal cannot run waits for it rather than starting a
  // preparation of the whole file; one neither can read prepares, as before.
  const liveRefused =
    resource?.query_mode === 'datastore' &&
    local.coverage === 'yes' &&
    refusalOf(local.table.fields, {
      q: debouncedQ || '',
      filters: buildColumnFilters(debouncedFilters),
      sort: sort || null
    }) !== null;
  const liveCoverage =
    resource?.query_mode === 'datastore' ? (liveRefused ? 'no' : local.coverage) : 'no';
  const filtersNeedPreparation =
    resource?.query_mode === 'datastore' && hasNonEq && liveCoverage === 'no';
  const fields = resource?.ingestion?.fields;
  const fingerprint = schemaFingerprint(fields);
  const [observedSchema, setObservedSchema] = useState(null);
  // The columns the visitor worked with in a file's rows, before its prepared copy.
  const previousFields = local.table && local.table.origin !== 'copy' ? local.table.fields : null;
  const reconciled = reconcileResourceFields(columnFilters, sort, fields, previousFields);
  const appliedFields = reconcileResourceFields(debouncedFilters, sort, fields, previousFields);
  // The first recorded schema needs no extra pass: nothing but reconciliation
  // can change before it is observed, so rows start with the metadata's commit.
  const schemaReady =
    fingerprint === null ||
    ((observedSchema === null || observedSchema === fingerprint) &&
      !reconciled.changed &&
      !appliedFields.changed);
  useEffect(() => {
    if (fingerprint === null) return;
    // A file's columns renamed in its prepared copy carry the visitor's
    // filters, sort and page over silently; anything that lost its column
    // clears with the notice, as for a changed file.
    const silent = reconciled.changed && !reconciled.dropped && previousFields;
    if (reconciled.changed) {
      if (silent) renameColumns(reconciled.filters, reconciled.sort);
      else {
        setColumnFilters(reconciled.filters);
        setSort(reconciled.sort);
      }
    }
    if (
      (observedSchema !== null && observedSchema !== fingerprint) ||
      (reconciled.changed && !silent)
    ) {
      setSchemaChanged(true);
      setPage(0);
    }
    setObservedSchema(fingerprint);
  }, [
    fingerprint,
    observedSchema,
    reconciled.changed,
    reconciled.dropped,
    reconciled.filters,
    reconciled.sort,
    previousFields,
    renameColumns,
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
  // The embedded rows are only trusted for the page the URL asked for and the
  // snapshot the embedded metadata reports.
  const initialRows =
    initial?.rows &&
    initial.page === page &&
    initial.rows.meta?.snapshot?.id === initial.resource.data.ingestion?.snapshot_id
      ? {
          page: initial.page,
          snapshotId: initial.rows.meta.snapshot?.id ?? null,
          data: {
            fields: initial.rows.data.fields,
            records: initial.rows.data.records,
            total: initial.rows.data.total,
            mode: initial.rows.meta.query_mode
          }
        }
      : null;
  const preparation = useResourcePreparation({
    id,
    resource,
    active: view !== 'map',
    needsLocal: view === 'chart' || ((hasNonEq || filterUpgrade) && liveCoverage === 'no'),
    onReady: onPrepared
  });
  // The preparation can't bring the full table (failed, unavailable or
  // turned off): a file's rows held in the browser are all there will be.
  const preparationStuck =
    !preparation.supported ||
    !preparation.enabled ||
    preparation.phase === 'failed' ||
    preparation.phase === 'unavailable';
  const {
    data,
    error: dataError,
    loading: dataLoading,
    pageKey: shownPageKey,
    partial: dataPartial,
    available: localAvailable,
    local: localAnswered,
    unsupported: dataUnsupported,
    waitingForTable,
    invalidate
  } = useResourceRows({
    id,
    resource,
    view,
    debouncedQ,
    debouncedFilters,
    sort,
    page,
    preparationRequired,
    fileOnly,
    hasNonEq,
    schemaReady,
    setFilterUpgrade,
    onUnavailable: reloadAfterExpiry,
    initialRows,
    local,
    heldFinal: preparationStuck
  });
  const onUnavailable = useCallback(() => {
    if (reloadAfterExpiry()) invalidate();
  }, [reloadAfterExpiry, invalidate]);
  useResourceActivity({ id, resource, active: view !== 'map', onUnavailable });
  const loadElapsed = useElapsed(preparation.job?.age_seconds, preparation.working);
  // What the Chart tab's loading card waits on: the chart area reports into it.
  const [chartLoadStore] = useState(createChartLoadStore);
  const jobProgress = preparation.job?.progress || null;
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

  // The visitor's own table searches: the hosted service may answer false and
  // ask for a free account instead, leaving the table and its inputs as they
  // were. Links, Back/Forward and resets never come through here. Each change
  // names what it replaces and the view it was made in.
  const changeSearch = useCallback(
    (text) => {
      if (!allowQuery('search', { resource: id, value: text, current: q, view })) return;
      setQ(text);
    },
    [id, q, view, setQ]
  );
  const changeSort = useCallback(
    (next) => {
      if (!allowQuery('sort', { resource: id, value: next, current: sort, view })) return;
      track('resource_sort', { resource_id: id, sort: next || '' });
      setSort(next);
    },
    [id, sort, view, setSort]
  );
  const changeColumnFilter = useCallback(
    (field, text) => {
      const current = columnFilters[field] || '';
      if (!allowQuery('filter', { resource: id, field, value: text, current, view })) return;
      setColumnFilters((previous) => ({ ...previous, [field]: text }));
    },
    [id, columnFilters, view, setColumnFilters]
  );
  // The Chart tab offers the values of a column whose rows hold different
  // measures; choosing one filters the table to it, as typing "=value" would.
  const pinChartFilter = useCallback(
    (field, value) => changeColumnFilter(field, '=' + value),
    [changeColumnFilter]
  );
  const changePage = useCallback(
    (target) => {
      if (!allowQuery('page', { resource: id, page: target, current: page, view })) return false;
      setPage(target);
      return true;
    },
    [id, page, view, setPage]
  );

  // Another page, sort, search or filter shows its rows from the first one:
  // once they are drawn the table box scrolls back to its top and keeps its
  // sideways position. The window stays put (ScrollManager), so the pager
  // stays where the visitor clicked it.
  const tableBoxRef = useRef(null);
  const drawnPageKey = useRef(null);
  useLayoutEffect(() => {
    if (!shownPageKey || drawnPageKey.current === shownPageKey) return;
    drawnPageKey.current = shownPageKey;
    if (tableBoxRef.current) tableBoxRef.current.scrollTop = 0;
  }, [shownPageKey]);

  const exportFilters = buildColumnFilters(debouncedFilters);
  const exportHref = apiUrl('/web-api/v1/resources/' + id + '/query.csv', {
    q: debouncedQ || undefined,
    filters: Object.keys(exportFilters).length ? exportFilters : undefined,
    sort: sort || undefined
  });
  // A whole table held in the browser downloads exactly the rows on screen.
  const browserExport =
    view === 'table' && localAnswered && !dataUnsupported && Boolean(local.table?.complete);
  // The server exports only a table it holds or can read live; a file not
  // prepared yet has no server export.
  // A live table's export runs on the portal, which reads equality filters only.
  const serverExport =
    resource?.query_mode === 'ingested' || (resource?.query_mode === 'datastore' && !hasNonEq);
  const exportInBrowser = () => {
    const table = local.table;
    if (!table) return;
    const serverFallback = () => {
      if (resource?.query_mode === 'ingested' || resource?.query_mode === 'datastore')
        window.location.assign(exportHref);
    };
    table
      .exportRows(
        { q: debouncedQ || '', filters: exportFilters, sort: sort || null },
        EXPORT_MAX_ROWS
      )
      .then((result) => {
        if (!result || 'status' in result) serverFallback();
        else downloadCsv(csvFilename(id), buildCsv(result.fields, result.rows));
      })
      .catch(serverFallback);
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
    rowError: Boolean(dataError),
    // Rows held in the browser make the table, also while the view asked for
    // waits on the full table; a server error on the view shows instead.
    hasLocalRows: view === 'table' && Boolean(local.table) && !dataError,
    // A CSV's first rows are on their way.
    awaitingRows:
      view === 'table' &&
      resource.query_mode === 'ingestable' &&
      String(resource.format || '').toUpperCase() === 'CSV' &&
      !previewFailed &&
      !local.table
  });
  // On the Chart tab the loading card stands in for the preparation card while
  // a preparation runs or is about to; standby, busy and failures keep theirs.
  const chartCovers =
    view === 'chart' && display === 'preparation' && preparationCovered(preparation);

  // The recorded schema and row count draw the table frame, count and pager
  // before the first page arrives; a page response then owns the total.
  const frameFields = fields
    ? [{ id: '_id', type: 'int' }, ...fields]
    : (local.table?.fields ?? null);
  const unfiltered = !debouncedQ && Object.keys(exportFilters).length === 0;
  const knownTotal = data
    ? data.total
    : view === 'table' && unfiltered
      ? (resource.ingestion?.row_count ?? null)
      : null;

  // The table frame (recorded columns, placeholder rows) and the rows share one
  // DataTable at one position, so going from the frame to the rows, or from a
  // file's rows to its prepared copy, keeps focus, widths and the box's scroll.
  const framing = !data;
  // No rows to show while a file is prepared (an Excel file, or a CSV whose
  // first rows could not be read): the table's shape under a progress line,
  // from the moment the preparation is due. A button, a failure or a busy
  // queue keeps its card.
  const tablePreparing =
    view === 'table' &&
    preparation.supported &&
    preparation.enabled &&
    !preparation.awaitingVisitor &&
    ['idle', 'requesting', 'pending', 'running'].includes(preparation.phase);
  const heldRows = local.table?.rowCount ?? 0;
  // Part of a file is held and the rest will not come.
  const heldOnly =
    view === 'table' &&
    preparationStuck &&
    Boolean(local.table) &&
    !local.table.complete &&
    resource.query_mode === 'ingestable';
  const lastHeldPage =
    heldOnly && dataPartial && localAvailable != null
      ? Math.max(0, Math.ceil(localAvailable / PAGE_SIZE) - 1)
      : null;
  const pagerVisible = data
    ? typeof data.total === 'number'
      ? data.total > PAGE_SIZE
      : page > 0 || data.records.length >= PAGE_SIZE
    : knownTotal > PAGE_SIZE;
  const renderTable = () => (
    <div
      className="space-y-3"
      role={framing ? 'status' : undefined}
      aria-busy={framing ? 'true' : undefined}
      aria-label={framing ? t('resource.loading_data') : undefined}
    >
      <span
        className="sr-only"
        role={!framing && dataPartial && preparation.working ? 'status' : undefined}
      >
        {framing
          ? t('resource.loading_data')
          : dataPartial && preparation.working
            ? t('table.full_loading')
            : ''}
      </span>
      {waitingForTable && !preparationStuck ? (
        <PreparationStatus
          preparation={preparation}
          elapsed={formatDuration(loadElapsed)}
          progress={jobProgress}
          compact
        />
      ) : null}
      <div className={dataLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <DataTable
          boxRef={tableBoxRef}
          fields={data ? data.fields : frameFields}
          records={data ? data.records : null}
          placeholderRows={data ? 0 : 10}
          sort={sort}
          onSortChange={changeSort}
          columnFilters={columnFilters}
          onColumnFilterChange={changeColumnFilter}
        />
      </div>
      {dataUnsupported ? (
        <p className="text-sm text-base-content/70" role="note">
          {t('table.filter_unsupported')}
        </p>
      ) : null}
      {heldOnly ? (
        <p className="text-sm text-base-content/70" role="note">
          {t('table.partial_failed').replace(
            '{rows}',
            heldRows.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')
          )}{' '}
          {resource.url && (
            <a
              className="link"
              href={resource.url}
              data-analytics-event="resource_download"
              data-analytics-resource-id={id}
              data-analytics-source="partial_table"
            >
              {t('resource.download_here')}
            </a>
          )}
        </p>
      ) : null}
      {pagerVisible && (
        <Pager
          resourceId={id}
          page={page}
          total={data ? data.total : knownTotal}
          onPage={changePage}
          lastPage={lastHeldPage}
        />
      )}
    </div>
  );

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
          <DatasetHubLink datasetId={resource.dataset?.id} />
          {resource.dataset?.id && (
            <DatasetAlertSlot
              datasetId={resource.dataset.id}
              datasetTitle={
                resource.dataset.title?.[lang] ||
                resource.dataset.title?.en ||
                resource.dataset.name
              }
              variant="resource"
            />
          )}
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
            progress={jobProgress}
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
              progress={jobProgress}
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
              onChange={(e) => changeSearch(e.target.value)}
            />
          </div>
          {view === 'table' && knownTotal != null && (
            <span className="cq-chip cq-chip-mono ml-auto">
              {knownTotal.toLocaleString()} {t('resource.rows')}
            </span>
          )}
          {view === 'table' &&
            data &&
            !filtersNeedPreparation &&
            !dataPartial &&
            (browserExport || serverExport) &&
            (browserExport ? (
              <button
                type="button"
                className="btn btn-sm btn-outline border-base-content/20 rounded-lg gap-1.5 font-normal"
                title={t('resource.export_tip')}
                onClick={exportInBrowser}
                data-analytics-event="resource_export"
                data-analytics-resource-id={id}
                data-analytics-query={debouncedQ || ''}
                data-analytics-filters={JSON.stringify(exportFilters)}
                data-analytics-sort={sort || ''}
              >
                <DownloadIcon size={13} />
                {t('resource.download_filtered')}
              </button>
            ) : (
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
            ))}
          {/* Offered once the table shows something. The count is given only when the
              rows on screen answer the search as it is now, in full: while another
              search loads, or with only part of a file held, it is not known. */}
          {view === 'table' && resource && data && (
            <WatchTableSlot
              resourceId={id}
              q={debouncedQ}
              filters={exportFilters}
              total={shownPageKey && !dataPartial ? data.total : null}
            />
          )}
          <QueryGateSlot resourceId={id} datasetId={resource?.dataset?.id} />
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

      <div className="relative space-y-4">
        {view === 'chart' && (
          <ChartLoadCard
            store={chartLoadStore}
            preparing={chartCovers}
            charting={display === 'chart'}
            published={preparation.published}
            phase={preparation.phase}
            progress={jobProgress}
            elapsed={preparation.working ? formatDuration(loadElapsed) : null}
          />
        )}
        {display === 'map' || display === 'map-loading' ? (
          display === 'map' ? (
            <Suspense fallback={<div className="cq-skel h-[560px] rounded-xl" />}>
              <MapPanel resourceId={id} map={resource.map} />
            </Suspense>
          ) : (
            <LoadingSpinner label={t('map.loading')} />
          )
        ) : display === 'filter-preparation' ? null : (display === 'loading' && frameFields) ||
          display === 'table' ? (
          renderTable()
        ) : display === 'loading' ? (
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
          chartCovers ? null : tablePreparing ? (
            <div className="space-y-3" data-testid="table-preparing">
              <PreparationStatus
                preparation={preparation}
                elapsed={formatDuration(loadElapsed)}
                progress={jobProgress}
                compact
              />
              <div className="cq-skel h-[420px]" aria-hidden="true" />
            </div>
          ) : (
            <PreparationStatus
              preparation={preparation}
              elapsed={formatDuration(loadElapsed)}
              progress={jobProgress}
            />
          )
        ) : display === 'chart' ? (
          <ChartLoadContext.Provider value={chartLoadStore}>
            <Suspense fallback={<ChartFallback />}>
              {schemaReady ? (
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
                  onPin={pinChartFilter}
                />
              ) : (
                <ChartFallback />
              )}
            </Suspense>
          </ChartLoadContext.Provider>
        ) : display === 'error' ? (
          <div className="alert alert-error">{dataError.message}</div>
        ) : (
          <LoadingSpinner label={t('resource.querying')} />
        )}
      </div>
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
