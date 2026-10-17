import LocalGuides from '../components/LocalGuides.jsx';
import PopularRail from '../components/PopularRail.jsx';
import RecentRail from '../components/RecentRail.jsx';
import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchOrganizations, fetchPlace, fetchPlaces, fetchSources, searchDatasets } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import useCatalogPage from '../hooks/useCatalogPage.js';
import CatalogPagination from '../components/CatalogPagination.jsx';
import { PAGE_SIZE } from '../utils/catalogPagination.js';
import { writePlace } from '../utils/placeStore.js';
import { track } from '../utils/analytics.js';
import { fill } from '../utils/text.js';
import { useLang } from '../i18n.jsx';
import SearchBar from '../components/SearchBar.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import { ArrowRightIcon, BuildingIcon, MapIcon, MapPinIcon } from '../components/Icons.jsx';

const PROVINCE_KINDS = ['province', 'territory'];
const localized = (value, lang) => value?.[lang] || value?.en || value?.fr || '';
const provinceOf = place => (place.ancestors || []).find(ancestor => ancestor.id !== place.id && PROVINCE_KINDS.includes(ancestor.kind)) || null;

// One paragraph of facts about the place, from the counts the API returns.
function PlaceIntro({ place, facets, lang, t }) {
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const count = value => Number(value || 0).toLocaleString(locale);
  const province = provinceOf(place);
  const name = localized(place.name, lang) + (province ? ', ' + localized(province.name, lang) : '');
  const liveTables = facets?.access?.find(item => item.value === 'queryable')?.count || 0;
  const parts = [
    fill(t('places.intro_count'), { count: count(place.dataset_count), name }),
    place.mappable_dataset_count ? fill(t('places.intro_maps'), { count: count(place.mappable_dataset_count) }) : '',
    liveTables ? fill(t('places.intro_tables'), { count: count(liveTables) }) : ''
  ].filter(Boolean);
  return (
    <p className="text-base-content/65 mt-3 leading-relaxed max-w-3xl">
      {parts.join(lang === 'fr' ? ' ; ' : '; ')}. {t('places.intro_more')}
    </p>
  );
}

// Counts by government level, access and format, from the same facet summary
// the filter sidebar uses; hidden while the counts are unavailable.
function PlaceBreakdown({ facets, lang, t }) {
  if (!facets) return null;
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const chips = [];
  for (const level of facets.level || []) {
    if (level.count) chips.push({ key: 'level-' + level.value, label: t('filters.level_' + level.value), count: level.count });
  }
  for (const access of facets.access || []) {
    if (access.count) chips.push({ key: 'access-' + access.value, label: t('filters.access_' + access.value), count: access.count });
  }
  for (const format of (facets.format || []).slice(0, 4)) {
    if (format.count) chips.push({ key: 'format-' + format.value, label: format.value, count: format.count });
  }
  if (!chips.length) return null;
  return (
    <section className="mt-6">
      <h2 className="font-display font-semibold text-xl">{t('places.breakdown')}</h2>
      <div className="flex flex-wrap gap-2 mt-3">
        {chips.map(chip => (
          <span key={chip.key} className="cq-chip cq-chip-mono">{chip.label} · {Number(chip.count).toLocaleString(locale)}</span>
        ))}
      </div>
    </section>
  );
}

function PlacePublishers({ slug, lang, t }) {
  const [organizations, setOrganizations] = useState([]);
  useEffect(() => {
    let cancelled = false;
    setOrganizations([]);
    Promise.resolve().then(() => fetchOrganizations({ place: slug, limit: 12 }))
      .then(env => { if (!cancelled) setOrganizations(env?.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);
  if (!organizations.length) return null;
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-xl">{t('places.publishers')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
        {organizations.map(organization => (
          <Link
            key={organization.id || organization.name}
            to={'/organizations/' + organization.name}
            className="cq-card cq-card-hover p-4 group"
            data-analytics-event="organization_open"
            data-analytics-source="place_hub"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display font-semibold">{localized(organization.title, lang) || organization.name}</h3>
                <p className="text-xs text-base-content/40 mt-1">{Number(organization.dataset_count || 0).toLocaleString(locale)} {t('places.datasets')}</p>
              </div>
              <BuildingIcon size={13} className="opacity-35 group-hover:opacity-70" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function PlacePortals({ place, sources, lang, t }) {
  if (!sources.length) return null;
  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-xl">{t('places.portals')}</h2>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-base-content/45">
        <span>{t('source.from')}</span>
        {sources.map(source => (
          <a
            key={source.id}
            className="cq-chip !whitespace-normal max-w-full break-words"
            href={source.homepage_url}
            target="_blank"
            rel="noreferrer"
            data-analytics-event="place_source_open"
            data-analytics-place-id={place.id}
            data-analytics-source-id={source.id}
          >
            {localized(source.name, lang)}
          </a>
        ))}
      </div>
    </section>
  );
}

function PlaceCard({ place, lang, t, source }) {
  return (
    <Link
      key={place.id}
      to={'/places/' + place.slug}
      className="cq-card cq-card-hover p-4 group"
      data-analytics-event="place_open"
      data-analytics-place-id={place.id}
      data-analytics-place-slug={place.slug}
      data-analytics-source={source}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-display font-semibold">{localized(place.name, lang)}</h4>
          <p className="text-xs text-base-content/40 mt-1">{place.dataset_count} {t('places.datasets')}</p>
        </div>
        <ArrowRightIcon size={13} className="opacity-35 group-hover:opacity-70" />
      </div>
      {place.direct_dataset_count === 0 && place.dataset_count > 0 && (
        <span className="cq-chip mt-3">{t('places.regional_only')}</span>
      )}
    </Link>
  );
}

// The province, the places inside this one, and the featured places beside it.
function PlaceNearby({ place, siblings, lang, t }) {
  const province = provinceOf(place);
  const children = place.children || [];
  const others = siblings.filter(sibling => sibling.id !== place.id);
  if (!province && !children.length && !others.length) return null;
  const childrenHeading = place.kind === 'region'
    ? t('places.region_municipalities')
    : fill(t('places.in_province'), { name: localized(place.name, lang) });
  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-xl">{t('places.nearby')}</h2>
      {province && (
        <p className="mt-3 text-sm">
          <Link to={'/places/' + province.slug} className="link" data-analytics-event="place_open" data-analytics-place-id={province.id} data-analytics-place-slug={province.slug} data-analytics-source="province_link">
            {fill(t('places.open_data_title'), { name: localized(province.name, lang) })}
          </Link>
        </p>
      )}
      {children.length > 0 && (
        <>
          <h3 className="font-display font-medium text-sm text-base-content/55 mt-4">{childrenHeading}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
            {children.map(child => <PlaceCard key={child.id} place={child} lang={lang} t={t} source="child_place" />)}
          </div>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className="font-display font-medium text-sm text-base-content/55 mt-4">{t('places.siblings')}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
            {others.map(sibling => <PlaceCard key={sibling.id} place={sibling} lang={lang} t={t} source="sibling_place" />)}
          </div>
        </>
      )}
    </section>
  );
}

function PlaceExplorer({ slug }) {
  const { lang, t } = useLang();
  const [place, setPlace] = useState(null);
  const [sources, setSources] = useState([]);
  const [siblings, setSiblings] = useState([]);
  const [query, setQuery] = useState('');
  const [mappable, setMappable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const debouncedQuery = useDebouncedValue(query, 250);
  const filtered = Boolean(debouncedQuery || mappable);

  useEffect(() => {
    if (debouncedQuery) track('place_search', { query: debouncedQuery, place: slug, language: lang });
  }, [debouncedQuery, slug, lang]);

  useEffect(() => {
    let cancelled = false;
    setPlace(null);
    Promise.all([fetchPlace(slug), fetchSources({ place: slug })])
      .then(([placeEnv, sourceEnv]) => {
        if (cancelled) return;
        setPlace(placeEnv.data);
        setSources(sourceEnv.data || []);
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof NotFoundError) setNotFound(true);
        else setError(err);
      });
    return () => { cancelled = true; };
  }, [slug]);

  // Featured places under the same parent, for the nearby section.
  const parentId = place?.parent_id;
  useEffect(() => {
    let cancelled = false;
    setSiblings([]);
    if (!parentId) return undefined;
    Promise.resolve().then(() => fetchPlaces({ parent: parentId, featured: true, limit: 12 }))
      .then(env => { if (!cancelled) setSiblings(env?.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [parentId]);

  const collection = useCatalogPage(
    cursor => searchDatasets({
      q: debouncedQuery || undefined,
      place: slug,
      mappable: mappable || undefined,
      facets: filtered ? undefined : 1,
      limit: PAGE_SIZE,
      cursor
    }),
    [slug, debouncedQuery, mappable],
    filtered
  );
  const { items, meta, loading, error: searchError } = collection;

  const reportedSearch = useRef(null);
  useEffect(() => {
    if (loading || searchError || !debouncedQuery || meta?.search?.query !== debouncedQuery.trim() || reportedSearch.current === meta) return;
    reportedSearch.current = meta;
    track('catalog_search_result', {
      place: slug, language: lang, returned: items.length, empty: items.length === 0,
    });
  }, [loading, searchError, debouncedQuery, slug, lang, items.length, meta]);

  if (notFound || collection.notFound) return <div className="text-center py-28"><h1 className="text-2xl font-bold font-display">{t('places.not_found')}</h1></div>;
  if (error) return <div className="max-w-5xl mx-auto px-4 py-8"><div className="alert alert-error">{error.message}</div></div>;
  if (!place) return <LoadingSpinner label={t('places.loading')} />;

  const name = localized(place.name, lang) || place.slug;
  const facets = !filtered && meta?.facets ? meta.facets : null;
  const hubVisible = !filtered && collection.page === 1;
  const mapped = hubVisible ? items.filter(dataset => dataset.mappable_count > 0).slice(0, 6) : [];
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <Breadcrumbs
        className="mb-5"
        label={t('breadcrumbs.label')}
        items={[
          { label: t('nav.places'), to: '/places' },
          ...(place.ancestors || []).map(ancestor => ({
            label: ancestor.name?.[lang] || ancestor.name?.en,
            to: ancestor.id === place.id ? null : '/places/' + ancestor.slug
          }))
        ]}
      />
      <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-5">
          <div>
            <span className="cq-chip"><MapPinIcon size={11} />{place.type?.[lang] || place.type?.en || place.kind}</span>
            <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3">{fill(t('places.open_data_title'), { name })}</h1>
            <PlaceIntro place={place} facets={facets} lang={lang} t={t} />
          </div>
          <Link
            to={'/?place=' + encodeURIComponent(place.slug)}
            className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
            onClick={() => writePlace(place.slug)}
            data-analytics-event="place_open"
            data-analytics-place-id={place.id}
            data-analytics-place-slug={place.slug}
            data-analytics-source="search_here"
          >
            <MapPinIcon size={13} />{t('places.search_here')}
          </Link>
        </div>
      </div>

      {place.direct_dataset_count === 0 && place.dataset_count > 0 && (
        <div className="mt-5 rounded-xl border border-secondary/20 bg-secondary/5 px-4 py-3 text-sm text-base-content/65">
          <strong className="text-base-content">{t('places.regional_only')}:</strong> {t('places.regional_only_desc')}
        </div>
      )}

      {hubVisible && <PlaceBreakdown facets={facets} lang={lang} t={t} />}
      <PlacePublishers slug={slug} lang={lang} t={t} />
      <PlacePortals place={place} sources={sources} lang={lang} t={t} />
      <PopularRail place={slug} />
      <RecentRail place={slug} />

      {mapped.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold text-xl">{t('places.maps_heading')}</h2>
          <div className="space-y-3 mt-3">
            {mapped.map(dataset => <DatasetRow key={'map-' + dataset.id} dataset={dataset} />)}
          </div>
        </section>
      )}

      <LocalGuides place={slug} />

      <section className="mt-8">
        <h2 className="font-display font-semibold text-xl">{t('places.datasets_heading')}</h2>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-3 mt-3">
          <SearchBar value={query} onChange={setQuery} />
          <button
            className={'cq-pill justify-center inline-flex items-center gap-1.5' + (mappable ? ' cq-pill-active' : '')}
            onClick={() => setMappable(value => {
              track('catalog_filter', { filter: 'mappable', value: !value, place: slug });
              return !value;
            })}
            aria-pressed={mappable}
          >
            <MapIcon size={13} />{t('places.has_map')}
          </button>
        </div>
        <div className="space-y-3 mt-6">
          {loading ? [...Array(5)].map((_, index) => <div className="cq-skel h-[82px]" key={index} />) :
            searchError ? <div className="alert alert-error">{searchError.message}</div> :
              items.length === 0 ? <div className="text-center py-14 text-base-content/50">
                  <p>{t('places.no_datasets')}</p>
                  {meta?.search?.suggestions?.length > 0 && <div className="flex flex-wrap justify-center items-center gap-2 mt-3">
                    <span>{t('discovery.suggest')}</span>
                    {meta.search.suggestions.map(suggestion => <button className="cq-pill" key={suggestion} onClick={() => setQuery(suggestion)}>{suggestion}</button>)}
                  </div>}
                </div> :
                items.map(dataset => <DatasetRow key={dataset.id} dataset={dataset} />)}
        </div>
        {!searchError && !collection.notFound && <CatalogPagination {...collection} />}
      </section>

      <PlaceNearby place={place} siblings={siblings} lang={lang} t={t} />
    </div>
  );
}

export default function PlacePage() {
  const { slug } = useParams();
  return <PlaceExplorer key={slug} slug={slug} />;
}
