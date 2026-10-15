import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchFeaturedPlaces, searchDatasets } from '../api/catalog.js';
import useCatalogPage from '../hooks/useCatalogPage.js';
import useFacetSnapshot from '../hooks/useFacetSnapshot.js';
import useSearchDraft from '../hooks/useSearchDraft.js';
import { PAGE_SIZE } from '../utils/catalogPagination.js';
import {
  EMPTY_CATALOG_SEARCH,
  activeFilterCount,
  catalogApiParams,
  hasCatalogCriteria,
  readCatalogSearch,
  toggleCatalogValue,
  writeCatalogSearch
} from '../utils/catalogSearchState.js';
import { catalogChips, removeChip } from '../components/catalogChips.js';
import CatalogFilterLayout from '../components/CatalogFilterLayout.jsx';
import CatalogFilters from '../components/CatalogFilters.jsx';
import CatalogPagination from '../components/CatalogPagination.jsx';
import CatalogResultsHeader from '../components/CatalogResultsHeader.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import SearchBar from '../components/SearchBar.jsx';
import { MapleLeaf } from '../components/Icons.jsx';
import { useLang } from '../i18n.jsx';
import { track } from '../utils/analytics.js';

// Unfiltered pages keep durable ?page=N links for crawlers. Any filter or a
// non-default order switches to button pagination, so filters never create
// crawl paths.
export default function DatasetsPage() {
  const { t, lang } = useLang();
  const [params, setParams] = useSearchParams();
  const search = readCatalogSearch(params);
  const apply = useCallback(
    (next) => setParams((current) => writeCatalogSearch(current, next), { replace: true }),
    [setParams]
  );
  const commitQuery = useCallback(
    (value) =>
      setParams((current) => writeCatalogSearch(current, { ...readCatalogSearch(current), q: value }), {
        replace: true
      }),
    [setParams]
  );
  const [query, setQuery] = useSearchDraft(search.q, commitQuery);
  const filtered = hasCatalogCriteria(search) || search.sort !== 'relevance';
  const request = catalogApiParams(search, { lang, facets: true });
  const requestKey = JSON.stringify(request);
  const collection = useCatalogPage(
    (cursor) => searchDatasets({ ...request, limit: PAGE_SIZE, cursor }),
    [requestKey],
    filtered
  );
  const counts = useFacetSnapshot(collection.meta, collection.loading);

  // A page number belongs to the unfiltered list.
  useEffect(() => {
    if (!filtered || !params.has('page')) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('page');
        return next;
      },
      { replace: true }
    );
  }, [filtered, params, setParams]);

  const [places, setPlaces] = useState({ status: 'idle', rows: [] });
  const placesRequested = useRef(false);
  const loadPlaces = useCallback(() => {
    if (placesRequested.current) return;
    placesRequested.current = true;
    setPlaces({ status: 'loading', rows: [] });
    fetchFeaturedPlaces()
      .then((env) => setPlaces({ status: 'ready', rows: env.data || [] }))
      .catch(() => {
        placesRequested.current = false;
        setPlaces({ status: 'error', rows: [] });
      });
  }, []);
  useEffect(() => {
    if (search.place) loadPlaces();
  }, [search.place, loadPlaces]);

  const searchedFor = search.q;
  useEffect(() => {
    if (searchedFor) track('catalog_search', { query: searchedFor, language: lang, surface: 'catalogue' });
  }, [searchedFor, lang]);

  // Filter controls apply the current draft too.
  const current = { ...search, q: query };
  const change = (next, event) => {
    track('catalog_filter', { ...event, surface: 'catalogue' });
    apply(next);
  };
  const toggle = (key, value) =>
    change(toggleCatalogValue(current, key, value), {
      filter: key,
      value,
      action: search[key].includes(value) ? 'remove' : 'add'
    });
  const flag = (key) => change({ ...current, [key]: !search[key] }, { filter: key, value: !search[key] });
  const choosePlace = (place) => change({ ...current, place, org: [], source: [] }, { filter: 'place', value: place });
  const reset = () => {
    setQuery('');
    change(EMPTY_CATALOG_SEARCH, { action: 'reset' });
  };
  const chips = catalogChips(search, counts.facets, { t, lang, places: places.rows });
  const empty = !collection.loading && !collection.error && !collection.notFound && collection.items.length === 0;
  const suggestions = collection.meta?.search?.suggestions || [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
      <h1 className="text-3xl font-bold font-display">
        {collection.notFound ? t('common.not_found') : t('catalogue.title')}
      </h1>
      <p className="text-base-content/65">{t('catalogue.description')}</p>
      <div className="flex flex-wrap gap-4">
        <Link to="/" className="link">{t('common.back_search')}</Link>
        <Link to="/organizations" className="link">{t('nav.organizations')}</Link>
        <Link to="/places" className="link">{t('nav.places')}</Link>
      </div>
      <SearchBar value={query} onChange={setQuery} />
      <CatalogFilterLayout
        activeCount={activeFilterCount(search)}
        sidebar={
          <CatalogFilters
            search={search}
            facets={counts.facets}
            status={counts.status}
            stale={counts.stale}
            onToggle={toggle}
            onFlag={flag}
            onReset={reset}
            onRetry={collection.reload}
            canReset={filtered || Boolean(query)}
            showPlace
            places={places.rows}
            placesLoading={places.status === 'loading'}
            onPlace={choosePlace}
            onPlaceOpen={loadPlaces}
          />
        }
      >
        <CatalogResultsHeader
          total={counts.total}
          stale={counts.stale}
          sort={search.sort}
          hasQuery={Boolean(search.q)}
          onSort={(sort) => change({ ...current, sort }, { filter: 'sort', value: sort })}
          chips={chips}
          onRemove={(chip) =>
            change(removeChip(current, chip), { filter: chip.key, value: chip.value, action: 'remove' })
          }
        />
        {collection.loading ? (
          <LoadingSpinner />
        ) : collection.error ? (
          <div className="alert alert-error flex flex-wrap items-center gap-3">
            <span>{collection.error.message}</span>
            <button type="button" className="btn btn-sm" onClick={collection.reload}>
              {t('common.retry')}
            </button>
          </div>
        ) : empty ? (
          <div className="text-center py-14 space-y-2 cq-fade">
            <MapleLeaf size={34} className="mx-auto text-base-content/15" />
            <p className="text-base-content/60">{t('home.no_results')}</p>
            <p className="text-sm text-base-content/50">{t('home.no_results_hint')}</p>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap justify-center items-center gap-2 pt-1">
                <span>{t('discovery.suggest')}</span>
                {suggestions.map((suggestion) => (
                  <button type="button" className="cq-pill" key={suggestion} onClick={() => setQuery(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {filtered && (
              <button type="button" className="btn btn-outline btn-sm mt-3" onClick={reset}>
                {t('filters.reset')}
              </button>
            )}
          </div>
        ) : (
          !collection.notFound && (
            <section className="space-y-3" aria-label={t('orgs.dataset_list')}>
              {collection.items.map((dataset) => (
                <DatasetRow key={dataset.id} dataset={dataset} />
              ))}
            </section>
          )
        )}
        {!collection.error && !collection.notFound && <CatalogPagination {...collection} />}
      </CatalogFilterLayout>
    </div>
  );
}
