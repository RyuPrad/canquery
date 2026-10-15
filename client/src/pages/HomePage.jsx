import LocalGuides from '../components/LocalGuides.jsx';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { searchDatasets, fetchStats, fetchFeaturedPlaces } from '../api/catalog.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import useFacetSnapshot from '../hooks/useFacetSnapshot.js';
import useOptimisticSearch from '../hooks/useOptimisticSearch.js';
import useHomeFilterOptions from '../hooks/useHomeFilterOptions.js';
import useSearchDraft from '../hooks/useSearchDraft.js';
import useCountUp from '../hooks/useCountUp.js';
import { useLang } from '../i18n.jsx';
import SearchBar from '../components/SearchBar.jsx';
import MochiPromotion from '../components/MochiPromotion.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import RecentRail from '../components/RecentRail.jsx';
import PopularRail from '../components/PopularRail.jsx';
import HomeFeaturedCharts from '../components/HomeFeaturedCharts.jsx';
import { formatRelativeTime } from '../utils/time.js';
import { readPlace, writePlace } from '../utils/placeStore.js';
import { track } from '../utils/analytics.js';
import PlaceSelect from '../components/PlaceSelect.jsx';
import CatalogFilters from '../components/CatalogFilters.jsx';
import CatalogFilterLayout from '../components/CatalogFilterLayout.jsx';
import CatalogResultsHeader from '../components/CatalogResultsHeader.jsx';
import { catalogChips, removeChip } from '../components/catalogChips.js';
import {
  EMPTY_CATALOG_SEARCH,
  activeFilterCount,
  catalogApiParams,
  hasCatalogCriteria,
  readCatalogSearch,
  toggleCatalogValue,
  writeCatalogSearch
} from '../utils/catalogSearchState.js';
import { MapleLeaf, UnlockIcon, DatabaseIcon, ZapIcon, MapIcon } from '../components/Icons.jsx';

const FORMATS = ['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML'];
const EXAMPLES = {
  en: ['parks', 'playgrounds', 'building permits', 'water quality', 'census'],
  fr: ['parcs', 'aires de jeux', 'permis de construction', 'qualité de l’eau', 'recensement']
};

function StatItem({ icon, value, label, tone }) {
  const n = useCountUp(value);
  const { lang } = useLang();
  return (
    <div className="cq-home-stat">
      <span
        className={`hidden sm:flex w-9 h-9 rounded-lg items-center justify-center shrink-0 ${tone}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-display font-bold text-xl sm:text-2xl leading-none tabular-nums">
          {n.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}
        </div>
        <div className="text-xs text-base-content/70 mt-2 leading-snug">{label}</div>
      </div>
    </div>
  );
}

function StepItem({ number, title, desc }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="w-8 h-8 rounded-full border border-base-content/15 flex items-center justify-center shrink-0 font-mono text-sm cq-fg-red"
        aria-hidden="true"
      >
        {number}
      </span>
      <div>
        <h3 className="font-semibold text-base">{title}</h3>
        <p className="text-sm text-base-content/70 mt-1 leading-relaxed">{desc}</p>
      </div>
    </li>
  );
}

export default function HomePage() {
  const { t, lang } = useLang();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [arrival] = useState(() => ({
    key: location.key,
    place: searchParams.has('place') ? '' : readPlace()
  }));
  const search = readCatalogSearch(searchParams);
  const searchQuery = search.q;
  const commitQuery = useCallback(
    (value) =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set('q', value);
          else next.delete('q');
          return next;
        },
        { replace: true }
      ),
    [setSearchParams]
  );
  const [query, setQuery] = useSearchDraft(searchQuery, commitQuery);
  const { org, format, source, keyword, mappable } = search;
  const place = search.place || (location.key === arrival.key ? arrival.place : '');
  const searchState = { ...search, place };
  const [stats, setStats] = useState(null);
  const [places, setPlaces] = useState([]);
  const [retry, setRetry] = useState(0);

  // Filter controls apply the current draft and the remembered place too.
  const update = (changes) => {
    setSearchParams(writeCatalogSearch(searchParams, { ...searchState, q: query, ...changes }), {
      replace: true
    });
  };

  useEffect(() => {
    if (location.key !== arrival.key || searchParams.has('place') || !arrival.place) return;
    const next = new URLSearchParams(searchParams);
    next.set('place', arrival.place);
    setSearchParams(next, { replace: true });
  }, [arrival, location.key, searchParams, setSearchParams]);

  const orgKey = org.join('|');
  const formatKey = format.join('|');
  const sourceKey = source.join('|');
  const keywordKey = keyword.join('|');
  useEffect(() => {
    if (!searchQuery) return;
    track('catalog_search', {
      query: searchQuery,
      organization: orgKey,
      format: formatKey,
      place,
      source: sourceKey,
      keyword: keywordKey,
      mappable,
      language: lang
    });
  }, [searchQuery, orgKey, formatKey, place, sourceKey, keywordKey, mappable, lang]);

  const changePlace = (next) => {
    track('catalog_filter', { filter: 'place', value: next });
    update({ place: next, org: [], source: [] });
    writePlace(next);
  };

  useEffect(() => {
    let cancelled = false;
    fetchStats().then((env) => {
      if (!cancelled && env) setStats(env.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtering = hasCatalogCriteria(searchState);
  const { organizations: organizationOptions, sources: sourceOptions } = useHomeFilterOptions(
    place,
    sourceKey,
    !filtering
  );
  const orgs = organizationOptions.data;

  useEffect(() => {
    let cancelled = false;
    fetchFeaturedPlaces()
      .then((env) => {
        if (!cancelled) setPlaces(env.data || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = sourceOptions.data;

  // Counts come with the first page of filtered results only.
  const request = catalogApiParams(searchState, { lang, facets: filtering });
  const requestKey = JSON.stringify(request);
  const { items, meta, loading, loadingMore, error, hasMore, loadMore } = usePaginatedCollection(
    (cursor) =>
      searchDatasets({
        ...request,
        facets: cursor ? undefined : request.facets,
        limit: filtering ? 20 : 6,
        cursor
      }),
    [requestKey, filtering, retry]
  );
  const counts = useFacetSnapshot(filtering ? meta : null, loading);
  const [shown, applyShown] = useOptimisticSearch(searchState, (next) =>
    setSearchParams(writeCatalogSearch(searchParams, next), { replace: true })
  );
  const current = { ...shown, q: query };
  const change = (next, event) => {
    track('catalog_filter', { ...event, surface: 'home' });
    applyShown(next);
  };
  const toggle = (key, value) =>
    change(toggleCatalogValue(current, key, value), {
      filter: key,
      value,
      action: shown[key].includes(value) ? 'remove' : 'add'
    });
  const flag = (key) =>
    change({ ...current, [key]: !shown[key] }, { filter: key, value: !shown[key] });
  // The hero owns the place, so Reset keeps it.
  const reset = () => {
    setQuery('');
    change({ ...EMPTY_CATALOG_SEARCH, place }, { action: 'reset' });
  };
  const chips = catalogChips(shown, counts.facets, { t, lang, includePlace: false });

  const reportedSearch = useRef(null);
  useEffect(() => {
    if (
      loading ||
      error ||
      !searchQuery ||
      meta?.search?.query !== searchQuery.trim() ||
      reportedSearch.current === meta
    )
      return;
    reportedSearch.current = meta;
    track('catalog_search_result', {
      place,
      language: lang,
      returned: items.length,
      empty: items.length === 0
    });
  }, [loading, error, searchQuery, place, lang, items.length, meta]);

  const synced = stats?.last_synced_at ? formatRelativeTime(stats.last_synced_at, lang) : null;

  const resultsList = (
    <div className="cq-home-datasets mt-5" aria-busy={loading}>
      {loading && (
        <div className="space-y-3" aria-label={t('home.searching')}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="cq-skel h-[74px]" />
          ))}
        </div>
      )}
      {error && <div className="alert alert-error">{error.message}</div>}
      {items.length === 0 && !loading && !error && (
        <div className="text-center py-16 space-y-2 cq-fade">
          <MapleLeaf size={34} className="mx-auto text-base-content/15" />
          <p className="text-base-content/60">{t('home.no_results')}</p>
          <p className="text-sm text-base-content/35">{t('home.no_results_hint')}</p>
          {meta?.search?.suggestions?.length > 0 && (
            <div className="flex flex-wrap justify-center items-center gap-2 mt-3">
              <span>{t('discovery.suggest')}</span>
              {meta.search.suggestions.map((suggestion) => (
                <button className="cq-pill" key={suggestion} onClick={() => setQuery(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {items.map((d) => (
        <DatasetRow key={d.id} dataset={d} variant="flat" />
      ))}
    </div>
  );

  return (
    <div className="relative">
      <div
        className="absolute inset-x-0 top-0 h-[440px] cq-grid-bg pointer-events-none"
        aria-hidden="true"
      />
      <div className="relative max-w-6xl mx-auto px-4 pb-12 sm:pb-16">
        <section className="pt-10 sm:pt-12 pb-2 text-center cq-fade">
          <div className="cq-chip cq-chip-mono mb-5 max-w-full !whitespace-normal !px-3 !py-1.5">
            <MapleLeaf size={11} className="text-primary shrink-0" />
            {t('home.hero_chip')}
            {synced && (
              <span className="text-base-content/40 hidden sm:inline">
                · {t('home.synced')} {synced}
              </span>
            )}
          </div>
          <h1 className="font-display font-bold tracking-tight text-4xl sm:text-5xl md:text-[3.6rem] leading-[1.05] cq-title-grad pb-1">
            {t('home.title')}
          </h1>
          <p className="text-base sm:text-lg text-base-content/55 max-w-2xl mx-auto mt-4 leading-relaxed">
            {t('home.subtitle')}
          </p>

          <div className="w-full mx-auto mt-7 grid sm:grid-cols-[minmax(0,1fr)_17rem] gap-2.5">
            <SearchBar value={query} onChange={setQuery} />
            <PlaceSelect value={place} onChange={changePlace} places={places} />
          </div>

          <Link
            to="/places"
            className="inline-flex mt-3 text-xs link link-hover text-base-content/45"
          >
            {t('places.browse')}
          </Link>

          <div className="flex flex-wrap gap-2 items-center justify-center mt-4">
            <span className="text-xs text-base-content/35">{t('home.try')}</span>
            {EXAMPLES[lang].map((ex) => (
              <button
                key={ex}
                className="cq-pill !text-xs"
                onClick={() => {
                  track('catalog_search', { query: ex, source: 'example' });
                  setQuery(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </section>

        <section className="cq-home-section" aria-labelledby="home-catalogue-title">
          <div className="cq-home-section-heading">
            <h2
              id="home-catalogue-title"
              className="font-display font-semibold text-2xl sm:text-3xl"
            >
              {t(filtering ? 'home.results_title' : 'home.explore_title')}
            </h2>
            {!filtering && (
              <p className="text-sm text-base-content/70 mt-2">{t('home.explore_description')}</p>
            )}
          </div>
          {filtering ? (
            <div className="mt-5">
              <CatalogFilterLayout
                activeCount={activeFilterCount(shown, { includePlace: false })}
                sidebar={
                  <CatalogFilters
                    search={shown}
                    facets={counts.facets}
                    status={counts.status}
                    stale={counts.stale}
                    onToggle={toggle}
                    onFlag={flag}
                    onReset={reset}
                    onRetry={() => setRetry((value) => value + 1)}
                  />
                }
              >
                <CatalogResultsHeader
                  total={counts.total}
                  stale={counts.stale}
                  sort={shown.sort}
                  hasQuery={Boolean(searchQuery)}
                  onSort={(sort) => change({ ...current, sort }, { filter: 'sort', value: sort })}
                  chips={chips}
                  onRemove={(chip) =>
                    change(removeChip(current, chip), {
                      filter: chip.key,
                      value: chip.value,
                      action: 'remove'
                    })
                  }
                />
                {resultsList}
                {hasMore && (
                  <div className="text-center mt-6">
                    <button
                      className="btn btn-outline btn-sm rounded-full px-7 border-base-content/20"
                      onClick={() => {
                        track('catalog_filter', { action: 'load_more' });
                        loadMore();
                      }}
                      disabled={loadingMore}
                    >
                      {loadingMore ? t('home.loading') : t('home.load_more')}
                    </button>
                  </div>
                )}
              </CatalogFilterLayout>
            </div>
          ) : (
            <>
              <div className="cq-home-filters flex flex-wrap gap-2 items-center mt-5">
                <button
                  className={'cq-pill' + (format.length === 0 ? ' cq-pill-active' : '')}
                  aria-pressed={format.length === 0}
                  onClick={() => {
                    track('catalog_filter', { filter: 'format', value: '' });
                    update({ format: [] });
                  }}
                >
                  {t('home.all_formats')}
                </button>
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    className={'cq-pill' + (format.includes(f) ? ' cq-pill-active' : '')}
                    aria-pressed={format.includes(f)}
                    onClick={() => {
                      track('catalog_filter', { filter: 'format', value: f });
                      update({ format: [f] });
                    }}
                  >
                    {f}
                  </button>
                ))}
                <button
                  className={
                    'cq-pill inline-flex items-center gap-1.5' + (mappable ? ' cq-pill-active' : '')
                  }
                  onClick={() => {
                    track('catalog_filter', { filter: 'mappable', value: !mappable });
                    update({ mappable: !mappable });
                  }}
                  aria-pressed={mappable}
                >
                  <MapIcon size={12} />
                  {t('places.has_map')}
                </button>
                <select
                  className="select select-sm w-full sm:w-56 bg-base-200 border-base-content/10 rounded-lg text-[0.82rem]"
                  value={sourceKey}
                  onChange={(event) => {
                    track('catalog_filter', { filter: 'source', value: event.target.value });
                    update({ source: event.target.value ? [event.target.value] : [], org: [] });
                  }}
                  aria-label={t('source.choose')}
                  aria-busy={sourceOptions.status === 'loading'}
                  aria-describedby={
                    sourceOptions.status === 'error' ? 'source-options-error' : undefined
                  }
                >
                  <option value="">{t('source.all')}</option>
                  {sourceKey && !sources.some((item) => item.id === sourceKey) && (
                    <option value={sourceKey} disabled>
                      {sourceKey}
                    </option>
                  )}
                  {sources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name?.[lang] || item.name?.en || item.id}
                    </option>
                  ))}
                </select>
                {sourceOptions.status === 'error' && (
                  <span id="source-options-error" role="status" className="text-sm">
                    {t('source.load_error')}{' '}
                    <button className="link" type="button" onClick={sourceOptions.retry}>
                      {t('common.retry')}
                    </button>
                  </span>
                )}
                <select
                  className="select select-sm w-full sm:w-64 bg-base-200 border-base-content/10 rounded-lg text-[0.82rem]"
                  value={orgKey}
                  onChange={(e) => {
                    track('catalog_filter', { filter: 'organization', value: e.target.value });
                    update({ org: e.target.value ? [e.target.value] : [] });
                  }}
                  aria-label={t('home.all_organizations')}
                  aria-busy={organizationOptions.status === 'loading'}
                  aria-describedby={
                    organizationOptions.status === 'error'
                      ? 'organization-options-error'
                      : undefined
                  }
                >
                  <option value="">{t('home.all_organizations')}</option>
                  {orgKey && !orgs.some((item) => item.name === orgKey) && (
                    <option value={orgKey} disabled>
                      {orgKey}
                    </option>
                  )}
                  {orgs.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.title?.[lang] || o.title?.en || o.title?.fr || o.name} ({o.dataset_count})
                    </option>
                  ))}
                </select>
                {organizationOptions.status === 'error' && (
                  <span id="organization-options-error" role="status" className="text-sm">
                    {t('home.organizations_error')}{' '}
                    <button className="link" type="button" onClick={organizationOptions.retry}>
                      {t('common.retry')}
                    </button>
                  </span>
                )}
              </div>

              {resultsList}
              {!filtering && !loading && !error && items.length > 0 && (
                <div className="mt-5">
                  <Link
                    to="/datasets"
                    className="btn btn-outline rounded-xl border-base-content/20"
                  >
                    {t('home.browse_all')} →
                  </Link>
                </div>
              )}
            </>
          )}
        </section>

        {!filtering && stats && (
          <section className="cq-home-stats" aria-label={t('home.stats_label')}>
            <StatItem
              icon={<DatabaseIcon size={18} />}
              tone="bg-accent/10 text-accent"
              value={stats.datasets}
              label={t('home.datasets_mirrored')}
            />
            <StatItem
              icon={<ZapIcon size={18} />}
              tone="bg-success/10 text-success"
              value={stats.datastore_active_resources}
              label={t('home.queryable_upstream')}
            />
            <StatItem
              icon={<UnlockIcon size={18} />}
              tone="bg-primary/15 cq-fg-red"
              value={stats.ingested_resources}
              label={t('home.unlocked_here')}
            />
          </section>
        )}

        <HomeFeaturedCharts enabled={!filtering} />

        {!filtering && (
          <div className="cq-home-discovery">
            <PopularRail place={place || undefined} />
            <RecentRail place={place || undefined} />
          </div>
        )}

        {!filtering && (
          <section className="cq-home-section" aria-labelledby="home-steps-title">
            <h2
              id="home-steps-title"
              className="font-display font-semibold text-2xl sm:text-3xl mb-6"
            >
              {t('home.how_it_works')}
            </h2>
            <ol className="grid sm:grid-cols-3 gap-6 sm:gap-8">
              <StepItem number="1" title={t('home.step1_title')} desc={t('home.step1_desc')} />
              <StepItem number="2" title={t('home.step2_title')} desc={t('home.step2_desc')} />
              <StepItem number="3" title={t('home.step3_title')} desc={t('home.step3_desc')} />
            </ol>
          </section>
        )}

        {!searchQuery && !org.length && !format.length && !source.length && !keyword.length && (
          <LocalGuides place={place} limit={3} variant="compact" />
        )}
        {!filtering && <MochiPromotion variant="slim" />}
      </div>
    </div>
  );
}
