import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { fetchDataset } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import { track } from '../utils/analytics.js';
import { rememberResource } from '../utils/resourceHints.js';
import { takeDatasetInitialData, consumeInitialData } from '../utils/initialData.js';
import CatalogPagination from '../components/CatalogPagination.jsx';
import DatasetFileFilter from '../components/DatasetFileFilter.jsx';
import { PAGE_SIZE, pageNumber } from '../utils/catalogPagination.js';
import {
  EMPTY_FILE_FILTER,
  fileFacets,
  fileFilterKey,
  filterFiles,
  hasFileFilter,
  indexFiles,
  readFileFilter,
  writeFileFilter,
} from '../utils/datasetFileFilter.js';
import useSearchDraft from '../hooks/useSearchDraft.js';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js';
import ResourceBadge from '../components/ResourceBadge.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import Provenance from '../components/Provenance.jsx';
import CatalogOverview from '../components/CatalogOverview.jsx';
import LocalGuides from '../components/LocalGuides.jsx';
import DatasetAlertSlot from '../components/DatasetAlertSlot.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import { useLang } from '../i18n.jsx';
import {
  ArrowRightIcon,
  BuildingIcon,
  CalendarIcon,
  DownloadIcon,
  MapIcon,
  MapPinIcon,
} from '../components/Icons.jsx';

const FMT_STYLES = {
  CSV: { color: 'var(--cq-format-csv, #5eead4)', background: 'rgba(45,212,191,0.12)' },
  XLSX: { color: 'var(--cq-format-excel, #86efac)', background: 'rgba(74,222,128,0.12)' },
  XLS: { color: 'var(--cq-format-excel, #86efac)', background: 'rgba(74,222,128,0.12)' },
  JSON: { color: 'var(--cq-format-json, #fcd34d)', background: 'rgba(251,191,36,0.12)' },
  GEOJSON: { color: 'var(--cq-format-geojson, #93c5fd)', background: 'rgba(106,166,255,0.14)' },
  PDF: { color: 'var(--cq-format-pdf, #ff958c)', background: 'rgba(213,43,30,0.14)' },
  XML: { color: 'var(--cq-format-xml, #c4b5fd)', background: 'rgba(167,139,250,0.13)' },
};
const FMT_FALLBACK = { color: 'var(--cq-format-file, #9aa7bd)', background: 'rgba(154,167,189,0.12)' };

function FormatTile({ format }) {
  const style = FMT_STYLES[format] || FMT_FALLBACK;
  const label = (format || 'FILE').slice(0, 7);
  return (
    <span className="cq-fmt" style={style}>
      {label}
    </span>
  );
}

function DatasetExplorer({ idOrName }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang: uiLang, t } = useLang();
  const location = useLocation();
  // A direct visit's HTML carries this dataset and its guide lists.
  const [initial] = useState(() => takeDatasetInitialData({ idOrName, location }));
  useEffect(() => {
    consumeInitialData();
  }, []);
  const [dataset, setDataset] = useState(() => initial?.dataset.data ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [contentLang, setContentLang] = useState(uiLang);
  const [highlightId, setHighlightId] = useState(null);
  const navigate = useNavigate();
  const page = pageNumber(searchParams);
  const handledHighlightRef = useRef(null);
  const openedRef = useRef(false);
  const filesHeadingRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();

  // The file filter lives in the address (q, year, format, language) so a
  // filtered list can be shared and survives a reload; the search box filters
  // at once and writes the address after typing pauses.
  const fileFilter = readFileFilter(searchParams);
  const commitFileQuery = useCallback((value) => {
    setSearchParams(current => writeFileFilter(current, { ...readFileFilter(current), q: value }), { replace: true });
  }, [setSearchParams]);
  const [fileQuery, setFileQuery] = useSearchDraft(fileFilter.q, commitFileQuery);
  const effectiveFilter = useMemo(
    () => ({ q: fileQuery, year: fileFilter.year, format: fileFilter.format, language: fileFilter.language }),
    [fileQuery, fileFilter.year, fileFilter.format, fileFilter.language]
  );
  const filteringFiles = hasFileFilter(effectiveFilter);
  const indexedFiles = useMemo(
    () => (dataset ? indexFiles(dataset.resources || [], [dataset.title, dataset.presentation?.title]) : []),
    [dataset]
  );
  const matchingFiles = useMemo(() => filterFiles(indexedFiles, effectiveFilter), [indexedFiles, effectiveFilter]);
  const fileFacetGroups = useMemo(() => fileFacets(indexedFiles, effectiveFilter), [indexedFiles, effectiveFilter]);
  // A filtered list pages with buttons. Its page is kept in this history entry,
  // never in ?page, which belongs to the unfiltered list (and scrolls the window).
  const filesKey = fileFilterKey(effectiveFilter);
  const storedFilesPage = location.state?.filesPage;
  const lastFilesPage = Math.max(1, Math.ceil(matchingFiles.length / PAGE_SIZE));
  const filesPage = storedFilesPage?.key === filesKey && Number.isSafeInteger(storedFilesPage.page)
    ? Math.min(Math.max(1, storedFilesPage.page), lastFilesPage)
    : 1;
  // A page turn scrolls once the new page is drawn: scrolling during the click
  // lets Chromium's scroll anchoring pull the window back to the pager.
  const scrollFilesRef = useRef(false);
  useEffect(() => {
    if (!scrollFilesRef.current) return;
    scrollFilesRef.current = false;
    const heading = filesHeadingRef.current;
    heading?.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    heading?.focus({ preventScroll: true });
  }, [filesPage, reducedMotion]);
  const trackedFileQueryRef = useRef(fileFilter.q);
  useEffect(() => {
    if (!dataset || trackedFileQueryRef.current === fileFilter.q) return;
    trackedFileQueryRef.current = fileFilter.q;
    if (fileFilter.q.trim()) {
      track('catalog_filter', {
        filter: 'dataset_file_search',
        value: fileFilter.q.trim(),
        dataset_id: dataset.id,
        results: matchingFiles.length,
      });
    }
  }, [dataset, fileFilter.q, matchingFiles.length]);

  const pick = (obj) => obj ? (contentLang === 'fr' && obj.fr ? obj.fr : obj.en || obj.fr) : null;

  useEffect(() => {
    if (initial) {
      if (openedRef.current) return undefined;
      openedRef.current = true;
      for (const resource of initial.dataset.data.resources || []) rememberResource(resource);
      track('dataset_open', {
        dataset_id: initial.dataset.data.id,
        dataset_slug: initial.dataset.data.name || '',
        resource_count: (initial.dataset.data.resources || []).length,
        source: 'inline',
      });
      return undefined;
    }
    let cancelled = false;
    if (dataset === null) setLoading(true);
    fetchDataset(idOrName)
      .then(env => {
        if (!cancelled) {
          // Prepared resources opened from this list start their rows at once.
          for (const resource of env.data.resources || []) rememberResource(resource);
          setDataset(env.data);
          if (!openedRef.current) {
            openedRef.current = true;
            track('dataset_open', {
              dataset_id: env.data.id,
              dataset_slug: env.data.name || '',
              resource_count: (env.data.resources || []).length,
              source: 'page',
            });
          }
          setNotFound(false);

        }
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof NotFoundError) setNotFound(true);
        else setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // dataset is intentionally omitted: it only gates the first-load spinner;
    // initial never changes for one explorer (it is keyed by idOrName).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrName]);

  // Deep-link from an insight card (/datasets/:id?highlight=:resourceId): scroll
  // the representative resource into view and pulse it so the visitor sees which
  // one to open, then drop the param so a refresh doesn't re-trigger it.
  useEffect(() => {
    const focusId = searchParams.get('highlight');
    if (!focusId || !dataset || page === null) return;
    if (handledHighlightRef.current === focusId) return;
    // The highlighted file may be filtered out: show the whole list first.
    if (hasFileFilter(readFileFilter(searchParams))) {
      setSearchParams(writeFileFilter(searchParams, EMPTY_FILE_FILTER), { replace: true });
      return;
    }
    const resourceIndex = (dataset.resources || []).findIndex(resource => resource.id === focusId);
    const targetPage = Math.floor(resourceIndex / PAGE_SIZE) + 1;
    if (resourceIndex >= 0 && targetPage !== page) {
      const next = new URLSearchParams(searchParams);
      if (targetPage > 1) next.set('page', String(targetPage));
      else next.delete('page');
      setSearchParams(next, { replace: true });
      return;
    }
    const el = document.getElementById('res-' + focusId);
    if (el) {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setHighlightId(focusId);
      handledHighlightRef.current = focusId;
    }
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
  }, [dataset, searchParams, setSearchParams, page]);

  // The un-highlight timer lives on highlightId, not in the effect above:
  // dropping the param re-runs that effect, and a cleanup there would cancel
  // the timer and leave the ring stuck on the card.
  useEffect(() => {
    if (!highlightId) return undefined;
    const timer = setTimeout(() => setHighlightId(null), 3400);
    return () => clearTimeout(timer);
  }, [highlightId]);

  useEffect(() => {
    if (searchParams.getAll('page').length === 1 && searchParams.get('page') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (notFound || page === null || (dataset && page > 1 && (page - 1) * PAGE_SIZE >= dataset.resources.length)) {
    return (
      <div className="text-center py-28 space-y-3 cq-fade">
        <h1 className="text-2xl font-bold font-display">{t('common.dataset_not_found')}</h1>
        <Link to="/" className="link link-hover text-base-content/60">{t('common.back_search')}</Link>
      </div>
    );
  }

  if (loading && !dataset) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="alert alert-error">{error.message}</div>
      </div>
    );
  }

  const queryable = (mode) => ['datastore', 'ingested', 'ingestable'].includes(mode);
  const listedResources = filteringFiles ? matchingFiles : dataset.resources;
  const currentPage = filteringFiles ? filesPage : page;
  const visibleResources = listedResources.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectFileFilter = (key, value) => {
    const next = { ...effectiveFilter, [key]: value };
    setSearchParams(current => writeFileFilter(current, next), { replace: true });
    track('catalog_filter', {
      filter: 'dataset_file_' + key,
      value: value || 'all',
      dataset_id: dataset.id,
      results: filterFiles(indexedFiles, next).length,
    });
  };
  const clearFileFilter = () => {
    setSearchParams(current => writeFileFilter(current, EMPTY_FILE_FILTER), { replace: true });
    track('catalog_filter', { action: 'clear', surface: 'dataset_files', dataset_id: dataset.id });
  };
  const goToFilesPage = (number) => {
    // The pending search text is written too, so the new entry keeps it.
    setSearchParams(writeFileFilter(searchParams, effectiveFilter), {
      replace: true,
      state: { filesPage: { key: filesKey, page: number } },
    });
    scrollFilesRef.current = true;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4 cq-fade">
      <Breadcrumbs
        label={t('breadcrumbs.label')}
        items={[
          { label: t('nav.datasets'), to: '/datasets' },
          { label: pick(dataset.title) || dataset.name || dataset.id }
        ]}
      />

      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <h1 className="min-w-0 break-words text-3xl sm:text-4xl font-bold font-display tracking-tight leading-tight">
          {dataset.presentation?.title?.[contentLang] || pick(dataset.title)}
        </h1>
        <div className="cq-seg shrink-0 mt-1.5">
          <button
            className={'cq-seg-btn' + (contentLang === 'en' ? ' cq-seg-active' : '')}
            aria-pressed={contentLang === 'en'}
            onClick={() => { track('catalog_filter', { filter: 'dataset_language', value: 'en', dataset_id: dataset.id }); setContentLang('en'); }}
          >
            EN
          </button>
          <button
            className={'cq-seg-btn' + (contentLang === 'fr' ? ' cq-seg-active' : '')}
            aria-pressed={contentLang === 'fr'}
            onClick={() => { track('catalog_filter', { filter: 'dataset_language', value: 'fr', dataset_id: dataset.id }); setContentLang('fr'); }}
          >
            FR
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-base-content/55">
        {dataset.organization && (
          <Link
            to={'/organizations/' + encodeURIComponent(dataset.organization.name)}
            className="inline-flex items-center gap-1.5 hover:text-base-content"
          >
            <BuildingIcon size={14} />
            {pick(dataset.organization.title)}
          </Link>
        )}
        {dataset.metadata_modified && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon size={14} />
            {t('preview.metadata_updated')} {new Date(dataset.metadata_modified).toLocaleDateString()}
          </span>
        )}
        {(dataset.places || []).map(place => (
          <Link
            key={place.id}
            to={'/places/' + place.slug}
            className="inline-flex items-center gap-1.5 hover:text-base-content"
            data-analytics-event="place_open"
            data-analytics-place-id={place.id}
            data-analytics-place-slug={place.slug}
            data-analytics-source="dataset_page"
          >
            <MapPinIcon size={14} />
            {place.name?.[contentLang] || place.name?.en}
          </Link>
        ))}
      </div>

      <p className="max-w-3xl whitespace-pre-wrap text-[0.95rem] leading-relaxed text-base-content/75">
        {dataset.presentation?.summary?.[contentLang] || pick(dataset.notes)}
      </p>

      {dataset.presentation?.description?.[contentLang] && dataset.presentation.description[contentLang] !== dataset.presentation.summary[contentLang] &&
        <details className="text-sm"><summary className="cursor-pointer link">{t('preview.full_description')}</summary>
          <p className="whitespace-pre-wrap mt-3 break-words">{dataset.presentation.description[contentLang]}</p>
        </details>}
      <CatalogOverview presentation={dataset.presentation} language={contentLang} dataset />

      <div className="flex flex-wrap gap-1.5">
        {(contentLang === 'fr' ? dataset.keywords?.fr : dataset.keywords?.en)?.map(kw => (
          <button
            type="button"
            key={kw}
            onClick={() => navigate('/?keyword=' + encodeURIComponent(kw))}
            className="cq-pill !text-xs !font-medium"
            title={t('dataset.keyword_search') + ' ' + kw}
            data-analytics-event="catalog_search"
            data-analytics-query={kw}
            data-analytics-source="dataset_keyword"
          >
            {kw}
          </button>
        ))}
      </div>

      <Provenance provenance={dataset.provenance} />

      <DatasetAlertSlot
        datasetId={dataset.id}
        datasetTitle={dataset.presentation?.title?.[contentLang] || pick(dataset.title)}
        variant="dataset"
      />

      <h2
        ref={filesHeadingRef}
        tabIndex={-1}
        className="text-lg font-semibold font-display pt-6 flex items-center gap-2.5 scroll-mt-20 focus:outline-none"
      >
        {t('dataset.resources')}
        <span className="cq-chip cq-chip-mono">{dataset.resources.length}</span>
      </h2>
      {dataset.resources.length > 0 && (
        <DatasetFileFilter
          query={fileQuery}
          onQuery={setFileQuery}
          filter={effectiveFilter}
          facets={fileFacetGroups}
          total={dataset.resources.length}
          shown={matchingFiles.length}
          active={filteringFiles}
          onSelect={selectFileFilter}
          onClear={clearFileFilter}
        />
      )}
      {filteringFiles && matchingFiles.length === 0 && (
        <p className="cq-card p-6 text-center text-sm text-base-content/60">{t('dataset.filter.none')}</p>
      )}
      <div className="space-y-2.5">
        {visibleResources.map(resource => (
          <div
            key={resource.id}
            id={'res-' + resource.id}
            className={'cq-card cq-card-hover p-3.5 sm:p-4 flex flex-row flex-wrap items-center gap-3.5' + (highlightId === resource.id ? ' cq-focus-ring' : '')}
          >
            <FormatTile format={resource.format} />
            <div className="flex-1 min-w-48">
              <Link to={'/resources/' + resource.id} className="font-medium text-[0.92rem] leading-snug hover:underline">
                {resource.presentation?.title?.[contentLang] || pick(resource.name) || resource.format || resource.id}
              </Link>
              <div className="text-xs text-base-content/40 mt-0.5 font-mono">
                {resource.format}
                {resource.size_bytes ? ' · ' + Math.round(resource.size_bytes / 1024) + ' KB' : ''}
              </div>
            </div>
            <ResourceBadge mode={resource.query_mode} />
            <div className="flex items-center gap-1.5">
              {queryable(resource.query_mode) && (
                <Link
                  to={'/resources/' + resource.id}
                  className="btn btn-xs btn-primary rounded-lg gap-1"
                  data-analytics-event="resource_open"
                  data-analytics-resource-id={resource.id}
                  data-analytics-dataset-id={dataset.id}
                  data-analytics-source="dataset_resource"
                >
                  {t('common.explore')}
                  <ArrowRightIcon size={11} />
                </Link>
              )}
              {resource.map && (
                <Link
                  to={'/resources/' + resource.id + '?view=map'}
                  className="btn btn-xs btn-outline rounded-lg gap-1 border-base-content/20"
                  data-analytics-event="resource_view"
                  data-analytics-resource-id={resource.id}
                  data-analytics-view="map"
                  data-analytics-source="dataset_resource"
                >
                  <MapIcon size={11} />
                  {t('places.map')}
                </Link>
              )}
              <a
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-xs btn-ghost rounded-lg gap-1 text-base-content/60"
                data-analytics-event="resource_download"
                data-analytics-resource-id={resource.id}
                data-analytics-dataset-id={dataset.id}
                data-analytics-format={resource.format || ''}
                data-analytics-source="dataset_page"
              >
                <DownloadIcon size={11} />
                {t('dataset.download')}
              </a>
            </div>
          </div>
        ))}
      </div>
      {filteringFiles ? (
        <CatalogPagination page={filesPage} hasMore={filesPage * PAGE_SIZE < matchingFiles.length} onPage={goToFilesPage} />
      ) : (
        <CatalogPagination page={page} hasMore={page * PAGE_SIZE < dataset.resources.length} path={'/datasets/' + encodeURIComponent(dataset.name || dataset.id)} />
      )}
      <LocalGuides dataset={dataset.id} initial={initial?.guides} />
    </div>
  );
}

// React Router preserves the route element when only :idOrName changes. Key
// the stateful page so dataset content, errors, in-flight loads and language
// selection from the previous dataset cannot leak into the next one.
export default function DatasetPage() {
  const { idOrName } = useParams();
  return <DatasetExplorer key={idOrName} idOrName={idOrName} />;
}
