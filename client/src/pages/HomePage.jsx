import LocalGuides from '../components/LocalGuides.jsx';
import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { searchDatasets, fetchOrganizations, fetchStats, fetchFeatured, fetchFeaturedPlaces, fetchSources } from '../api/catalog.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import useCountUp from '../hooks/useCountUp.js';
import { useLang } from '../i18n.jsx';
import SearchBar from '../components/SearchBar.jsx';
import MochiPromotion from '../components/MochiPromotion.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import RecentRail from '../components/RecentRail.jsx';
import PopularRail from '../components/PopularRail.jsx';
import HeroChartWidget from '../components/HeroChartWidget.jsx';
import { formatRelativeTime } from '../utils/time.js';
import { readPlace, writePlace } from '../utils/placeStore.js';
import { track } from '../utils/analytics.js';
import { selectFeaturedCharts } from '../utils/featuredCharts.js';
import PlaceSelect from '../components/PlaceSelect.jsx';
import {
  MapleLeaf,
  UnlockIcon,
  DatabaseIcon,
  ZapIcon,
  XIcon,
  MapIcon,
} from '../components/Icons.jsx';

const FORMATS = ['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML'];
const EXAMPLES = { en: ['parks', 'playgrounds', 'building permits', 'water quality', 'census'], fr: ['parcs', 'aires de jeux', 'permis de construction', 'qualité de l’eau', 'recensement'] };

function StatItem({ icon, value, label, tone }) {
  const n = useCountUp(value);
  const { lang } = useLang();
  return (
    <div className="cq-home-stat">
      <span className={`hidden sm:flex w-9 h-9 rounded-lg items-center justify-center shrink-0 ${tone}`}>
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
      <span className="w-8 h-8 rounded-full border border-base-content/15 flex items-center justify-center shrink-0 font-mono text-sm cq-fg-red" aria-hidden="true">
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
  const [arrival] = useState(() => ({ key: location.key, place: searchParams.has('place') ? '' : readPlace() }));
  const searchQuery = searchParams.get('q') || '';
  const [draft, setDraft] = useState({ key: location.key, value: searchQuery });
  const query = draft.key === location.key ? draft.value : searchQuery;
  const setQuery = value => setDraft({ key: location.key, value });
  const org = searchParams.get('org') || '';
  const format = searchParams.get('format') || '';
  const place = searchParams.get('place') || (location.key === arrival.key ? arrival.place : '');
  const source = searchParams.get('source') || '';
  const mappable = ['true', '1'].includes(searchParams.get('mappable'));
  const keyword = searchParams.get('keyword') || '';
  const [stats, setStats] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [places, setPlaces] = useState([]);
  const [sources, setSources] = useState([]);

  const debouncedDraft = useDebouncedValue(query, 250);

  const updateSearch = changes => {
    const next = new URLSearchParams(searchParams);
    if (query) next.set('q', query);
    else next.delete('q');
    if (place) next.set('place', place);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  // The URL owns the applied filters. A draft belongs to one navigation, so
  // its pending debounce cannot overwrite a different search opened via Back,
  // Forward or an in-app link. Filter controls apply the current draft too.
  useEffect(() => {
    if (draft.key !== location.key || debouncedDraft !== draft.value || debouncedDraft === searchQuery) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedDraft) next.set('q', debouncedDraft);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [debouncedDraft, draft, location.key, searchQuery, searchParams, setSearchParams]);

  useEffect(() => {
    if (location.key !== arrival.key || searchParams.has('place') || !arrival.place) return;
    const next = new URLSearchParams(searchParams);
    next.set('place', arrival.place);
    setSearchParams(next, { replace: true });
  }, [arrival, location.key, searchParams, setSearchParams]);

  useEffect(() => {
    if (!searchQuery) return;
    track('catalog_search', {
      query: searchQuery,
      organization: org,
      format,
      place,
      source,
      keyword,
      mappable,
      language: lang,
    });
  }, [searchQuery, org, format, place, source, keyword, mappable, lang]);

  const changePlace = (next) => {
    track('catalog_filter', { filter: 'place', value: next });
    updateSearch({ place: next, org: '', source: '' });
    writePlace(next);
  };

  const clearKeyword = () => {
    track('catalog_filter', { filter: 'keyword', value: '', action: 'clear' });
    updateSearch({ keyword: '' });
  };

  useEffect(() => {
    let cancelled = false;
    fetchStats().then((env) => {
      if (!cancelled && env) setStats(env.data);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadOrganizations = async () => {
      const rows = [];
      const seenCursors = new Set();
      let cursor;
      do {
        const env = await fetchOrganizations({ place: place || undefined, source: source || undefined, limit: 100, cursor });
        if (cancelled) return;
        rows.push(...(env.data || []));
        cursor = env.pagination?.nextCursor || null;
        if (cursor && seenCursors.has(cursor)) throw new Error('Organization pagination returned a repeated cursor');
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      setOrgs(rows);
    };
    loadOrganizations().catch(() => {});
    return () => { cancelled = true; };
  }, [place, source]);

  useEffect(() => {
    let cancelled = false;
    fetchFeaturedPlaces()
      .then(env => { if (!cancelled) setPlaces(env.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSources({ place: place || undefined })
      .then(env => { if (!cancelled) setSources(env.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [place]);

  useEffect(() => {
    let cancelled = false;
    fetchFeatured(lang).then((env) => {
      if (!cancelled && env) setFeatured(selectFeaturedCharts(env.data));
    });
    return () => { cancelled = true; };
  }, [lang]);

  const filtering = Boolean(searchQuery || org || format || keyword || place || source || mappable);

  const { items, meta, loading, loadingMore, error, hasMore, loadMore } = usePaginatedCollection(
    (cursor) =>
      searchDatasets({
        q: searchQuery || undefined,
        org: org || undefined,
        format: format || undefined,
        keyword: keyword || undefined,
        place: place || undefined,
        source: source || undefined,
        mappable: mappable || undefined,
        limit: filtering ? 20 : 6,
        cursor,
      }),
    [searchQuery, org, format, keyword, place, source, mappable]
  );

  const reportedSearch = useRef(null);
  useEffect(() => {
    if (loading || error || !searchQuery || meta?.search?.query !== searchQuery.trim() || reportedSearch.current === meta) return;
    reportedSearch.current = meta;
    track('catalog_search_result', {
      place, language: lang, returned: items.length, empty: items.length === 0,
    });
  }, [loading, error, searchQuery, place, lang, items.length, meta]);

  const synced = stats?.last_synced_at ? formatRelativeTime(stats.last_synced_at, lang) : null;

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

          <Link to="/places" className="inline-flex mt-3 text-xs link link-hover text-base-content/45">
            {t('places.browse')}
          </Link>

          <div className="flex flex-wrap gap-2 items-center justify-center mt-4">
            <span className="text-xs text-base-content/35">{t('home.try')}</span>
            {EXAMPLES[lang].map((ex) => (
              <button key={ex} className="cq-pill !text-xs" onClick={() => {
                track('catalog_search', { query: ex, source: 'example' });
                setQuery(ex);
              }}>
                {ex}
              </button>
            ))}
            {keyword && (
              <button
                className="cq-pill cq-pill-active !text-xs inline-flex items-center gap-1.5"
                onClick={clearKeyword}
                title={t('home.keyword_clear')}
              >
                {t('home.keyword_label')} {keyword}
                <XIcon size={11} />
              </button>
            )}
          </div>
        </section>

        <section className="cq-home-section" aria-labelledby="home-catalogue-title">
          <div className="cq-home-section-heading">
            <h2 id="home-catalogue-title" className="font-display font-semibold text-2xl sm:text-3xl">
              {t(filtering ? 'home.results_title' : 'home.explore_title')}
            </h2>
            {!filtering && <p className="text-sm text-base-content/70 mt-2">{t('home.explore_description')}</p>}
          </div>
          <div className="cq-home-filters flex flex-wrap gap-2 items-center mt-5">
            <button
              className={'cq-pill' + (format === '' ? ' cq-pill-active' : '')}
              aria-pressed={format === ''}
              onClick={() => { track('catalog_filter', { filter: 'format', value: '' }); updateSearch({ format: '' }); }}
            >
              {t('home.all_formats')}
            </button>
            {FORMATS.map((f) => (
              <button
                key={f}
                className={'cq-pill' + (format === f ? ' cq-pill-active' : '')}
                aria-pressed={format === f}
                onClick={() => { track('catalog_filter', { filter: 'format', value: f }); updateSearch({ format: f }); }}
              >
                {f}
              </button>
            ))}
            <button
              className={'cq-pill inline-flex items-center gap-1.5' + (mappable ? ' cq-pill-active' : '')}
              onClick={() => {
                track('catalog_filter', { filter: 'mappable', value: !mappable });
                updateSearch({ mappable: mappable ? '' : 'true' });
              }}
              aria-pressed={mappable}
            >
              <MapIcon size={12} />
              {t('places.has_map')}
            </button>
            <select
              className="select select-sm w-full sm:w-56 bg-base-200 border-base-content/10 rounded-lg text-[0.82rem]"
              value={source}
              onChange={(event) => {
                track('catalog_filter', { filter: 'source', value: event.target.value });
                updateSearch({ source: event.target.value, org: '' });
              }}
              aria-label={t('source.choose')}
            >
              <option value="">{t('source.all')}</option>
              {sources.map(item => (
                <option key={item.id} value={item.id}>{item.name?.[lang] || item.name?.en || item.id}</option>
              ))}
            </select>
            <select
              className="select select-sm w-full sm:w-64 bg-base-200 border-base-content/10 rounded-lg text-[0.82rem]"
              value={org}
              onChange={(e) => {
                track('catalog_filter', { filter: 'organization', value: e.target.value });
                updateSearch({ org: e.target.value });
              }}
              aria-label={t('home.all_organizations')}
            >
              <option value="">{t('home.all_organizations')}</option>
              {orgs.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.title?.[lang] || o.title?.en || o.title?.fr || o.name} ({o.dataset_count})
                </option>
              ))}
            </select>
          </div>

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
                {meta?.search?.suggestions?.length > 0 && <div className="flex flex-wrap justify-center items-center gap-2 mt-3">
                  <span>{t('discovery.suggest')}</span>
                  {meta.search.suggestions.map(suggestion => <button className="cq-pill" key={suggestion} onClick={() => setQuery(suggestion)}>{suggestion}</button>)}
                </div>}
              </div>
            )}
            {items.map((d) => (
              <DatasetRow key={d.id} dataset={d} variant="flat" />
            ))}
          </div>

          {filtering && hasMore && (
            <div className="text-center mt-6">
              <button
                className="btn btn-outline btn-sm rounded-full px-7 border-base-content/20"
                onClick={() => { track('catalog_filter', { action: 'load_more' }); loadMore(); }}
                disabled={loadingMore}
              >
                {loadingMore ? t('home.loading') : t('home.load_more')}
              </button>
            </div>
          )}
          {!filtering && !loading && !error && items.length > 0 && (
            <div className="mt-5">
              <Link to="/datasets" className="btn btn-outline rounded-xl border-base-content/20">
                {t('home.browse_all')} →
              </Link>
            </div>
          )}
        </section>

        {!filtering && stats && (
          <section className="cq-home-stats" aria-label={t('home.stats_label')}>
            <StatItem icon={<DatabaseIcon size={18} />} tone="bg-accent/10 text-accent"
              value={stats.datasets} label={t('home.datasets_mirrored')} />
            <StatItem icon={<ZapIcon size={18} />} tone="bg-success/10 text-success"
              value={stats.datastore_active_resources} label={t('home.queryable_upstream')} />
            <StatItem icon={<UnlockIcon size={18} />} tone="bg-primary/15 cq-fg-red"
              value={stats.ingested_resources} label={t('home.unlocked_here')} />
          </section>
        )}

        {!filtering && featured.length > 0 && (
          <section className="cq-home-section" aria-labelledby="home-insight-title">
            <h2 id="home-insight-title" className="font-display font-semibold text-2xl sm:text-3xl mb-5">{t('home.insight_title')}</h2>
            <HeroChartWidget items={featured} />
          </section>
        )}

        {!filtering && (
          <div className="cq-home-discovery">
            <PopularRail place={place || undefined} />
            <RecentRail place={place || undefined} />
          </div>
        )}

        {!filtering && (
          <section className="cq-home-section" aria-labelledby="home-steps-title">
            <h2 id="home-steps-title" className="font-display font-semibold text-2xl sm:text-3xl mb-6">{t('home.how_it_works')}</h2>
            <ol className="grid sm:grid-cols-3 gap-6 sm:gap-8">
              <StepItem number="1" title={t('home.step1_title')} desc={t('home.step1_desc')} />
              <StepItem number="2" title={t('home.step2_title')} desc={t('home.step2_desc')} />
              <StepItem number="3" title={t('home.step3_title')} desc={t('home.step3_desc')} />
            </ol>
          </section>
        )}

        {!searchQuery && !org && !format && !source && !keyword && <LocalGuides place={place} limit={3} variant="compact" />}
        {!filtering && <MochiPromotion variant="slim" />}
      </div>
    </div>
  );
}
