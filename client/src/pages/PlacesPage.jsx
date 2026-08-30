import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchFeaturedPlaces, fetchPlaces } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { MapPinIcon, ArrowRightIcon, MapIcon, SearchIcon } from '../components/Icons.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import { track } from '../utils/analytics.js';

export default function PlacesPage() {
  const { lang, t } = useLang();
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    if (debouncedQuery) track('place_search', { query: debouncedQuery, language: lang });
  }, [debouncedQuery, lang]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const request = debouncedQuery
      ? fetchPlaces({ q: debouncedQuery, limit: 100 })
      : fetchFeaturedPlaces();
    request
      .then(env => {
        if (!cancelled) {
          setPlaces(env.data || []);
          setError(null);
        }
      })
      .catch(err => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const placeCard = (place) => (
    <Link
      key={place.id}
      to={'/places/' + place.slug}
      className="cq-card cq-card-hover p-5 group"
      data-analytics-event="place_open"
      data-analytics-place-id={place.id}
      data-analytics-place-slug={place.slug}
      data-analytics-source={debouncedQuery ? 'search_result' : 'featured'}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center"><MapPinIcon size={18} /></span>
        <ArrowRightIcon size={15} className="opacity-35 group-hover:opacity-70" />
      </div>
      <h2 className="font-display font-semibold text-lg mt-4">{place.name?.[lang] || place.name?.en}</h2>
      <p className="text-xs uppercase tracking-wider text-base-content/40 mt-1">{place.type?.[lang] || place.type?.en || place.kind}</p>
      <div className="flex flex-wrap gap-2 mt-4">
        <span className="cq-chip cq-chip-mono">{place.dataset_count} {t('places.datasets')}</span>
        {place.direct_dataset_count === 0 && place.dataset_count > 0 && (
          <span className="cq-chip" title={t('places.regional_only_desc')}>{t('places.regional_only')}</span>
        )}
        {place.mappable_resource_count > 0 && <span className="cq-chip"><MapIcon size={10} />{place.mappable_resource_count} {t('places.maps')}</span>}
      </div>
    </Link>
  );
  const regions = places.filter(place => place.kind === 'region');
  const municipalities = places.filter(place => place.kind === 'municipality');
  const regionIds = new Set(regions.map(place => place.id));
  const standaloneCities = municipalities.filter(place => !regionIds.has(place.parent?.id));
  const otherPlaces = places.filter(place => !['region', 'municipality'].includes(place.kind));

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <div className="max-w-3xl">
        <span className="cq-chip cq-chip-mono"><MapPinIcon size={11} />{t('places.local_data')}</span>
        <h1 className="text-3xl sm:text-4xl font-bold font-display tracking-tight mt-4">{t('places.title')}</h1>
        <p className="text-base-content/60 mt-3 leading-relaxed">{t('places.subtitle')}</p>
      </div>
      <div className="cq-search cq-search-sm max-w-lg mt-7">
        <SearchIcon size={14} className="opacity-40 shrink-0" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('places.search_placeholder')}
          aria-label={t('places.search_placeholder')}
        />
      </div>
      {loading ? <LoadingSpinner label={t('places.loading')} /> : error ? (
        <div className="alert alert-error mt-6">{error.message}</div>
      ) : (
        <div className="mt-8 space-y-9">
          {!debouncedQuery && <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"><Link to="/" className="cq-card cq-card-hover p-5 group">
            <div className="flex items-start justify-between gap-3">
              <span className="w-10 h-10 rounded-xl bg-primary/15 cq-fg-red flex items-center justify-center"><MapPinIcon size={18} /></span>
              <ArrowRightIcon size={15} className="opacity-35 group-hover:opacity-70" />
            </div>
            <h2 className="font-display font-semibold text-lg mt-4">{t('places.all_canada')}</h2>
            <p className="text-sm text-base-content/45 mt-1">{t('places.all_canada_desc')}</p>
          </Link></div>}
          {!debouncedQuery && regions.length > 0 && <section>
            <h2 className="font-display font-semibold text-xl mb-3">{t('places.featured_region')}</h2>
            <div className="space-y-6">
              {regions.map(region => {
                const children = municipalities.filter(place => place.parent?.id === region.id);
                return <div key={region.id}>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{placeCard(region)}</div>
                  {children.length > 0 && <div className="mt-4">
                    <h3 className="font-display font-medium text-sm text-base-content/55 mb-2">
                      {t('places.municipalities_in')} {region.name?.[lang] || region.name?.en}
                    </h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{children.map(placeCard)}</div>
                  </div>}
                </div>;
              })}
            </div>
          </section>}
          {!debouncedQuery && standaloneCities.length > 0 && <section>
            <h2 className="font-display font-semibold text-xl mb-3">{t('places.featured_cities')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{standaloneCities.map(placeCard)}</div>
          </section>}
          {debouncedQuery && places.length > 0 && <section>
            <h2 className="font-display font-semibold text-xl mb-3">{t('places.search_results')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{places.map(placeCard)}</div>
          </section>}
          {!debouncedQuery && otherPlaces.length > 0 && <section>
            <h2 className="font-display font-semibold text-xl mb-3">{t('places.other_places')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{otherPlaces.map(placeCard)}</div>
          </section>}
          {places.length === 0 && debouncedQuery && (
            <p className="text-center py-12 text-base-content/50">{t('places.not_found')}</p>
          )}
        </div>
      )}
    </div>
  );
}
