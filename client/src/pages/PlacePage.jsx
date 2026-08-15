import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPlace, fetchSources, searchDatasets } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import { writePlace } from '../utils/placeStore.js';
import { useLang } from '../i18n.jsx';
import SearchBar from '../components/SearchBar.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { ArrowRightIcon, MapIcon, MapPinIcon } from '../components/Icons.jsx';

export default function PlacePage() {
  const { slug } = useParams();
  const { lang, t } = useLang();
  const [place, setPlace] = useState(null);
  const [sources, setSources] = useState([]);
  const [query, setQuery] = useState('');
  const [mappable, setMappable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const debouncedQuery = useDebouncedValue(query, 250);

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

  const { items, loading, loadingMore, error: searchError, hasMore, loadMore } = usePaginatedCollection(
    cursor => searchDatasets({
      q: debouncedQuery || undefined,
      place: slug,
      mappable: mappable || undefined,
      limit: 20,
      cursor
    }),
    [slug, debouncedQuery, mappable]
  );

  if (notFound) return <div className="text-center py-28"><h1 className="text-2xl font-bold font-display">{t('places.not_found')}</h1></div>;
  if (error) return <div className="max-w-5xl mx-auto px-4 py-8"><div className="alert alert-error">{error.message}</div></div>;
  if (!place) return <LoadingSpinner label={t('places.loading')} />;

  const name = place.name?.[lang] || place.name?.en || place.slug;
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-base-content/45 mb-5" aria-label={t('places.breadcrumb')}>
        <Link to="/places" className="hover:text-base-content">{t('nav.places')}</Link>
        {(place.ancestors || []).map(ancestor => (
          <span key={ancestor.id} className="inline-flex items-center gap-1.5">
            <ArrowRightIcon size={10} />
            {ancestor.id === place.id ? (
              <span className="text-base-content/70">{ancestor.name?.[lang] || ancestor.name?.en}</span>
            ) : (
              <Link to={'/places/' + ancestor.slug} className="hover:text-base-content">{ancestor.name?.[lang] || ancestor.name?.en}</Link>
            )}
          </span>
        ))}
      </nav>
      <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-5">
          <div>
            <span className="cq-chip"><MapPinIcon size={11} />{place.type?.[lang] || place.type?.en || place.kind}</span>
            <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3">{name}</h1>
            <p className="text-base-content/55 mt-2">{place.dataset_count.toLocaleString()} {t('places.datasets')} · {place.mappable_dataset_count.toLocaleString()} {t('places.mappable_datasets')}</p>
          </div>
          <Link
            to={'/?place=' + encodeURIComponent(place.slug)}
            className="btn btn-sm btn-outline border-base-content/20 rounded-lg"
            onClick={() => writePlace(place.slug)}
          >
            <MapPinIcon size={13} />{t('places.search_here')}
          </Link>
        </div>
      </div>

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-5 text-xs text-base-content/45">
          <span>{t('source.from')}</span>
          {sources.map(source => (
            <a key={source.id} className="cq-chip" href={source.homepage_url} target="_blank" rel="noreferrer">
              {source.name?.[lang] || source.name?.en}
            </a>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-3 mt-8">
        <SearchBar value={query} onChange={setQuery} />
        <button
          className={'cq-pill justify-center inline-flex items-center gap-1.5' + (mappable ? ' cq-pill-active' : '')}
          onClick={() => setMappable(value => !value)}
          aria-pressed={mappable}
        >
          <MapIcon size={13} />{t('places.has_map')}
        </button>
      </div>
      <section className="space-y-3 mt-6">
        {loading ? [...Array(5)].map((_, index) => <div className="cq-skel h-[82px]" key={index} />) :
          searchError ? <div className="alert alert-error">{searchError.message}</div> :
            items.length === 0 ? <div className="text-center py-14 text-base-content/50">{t('places.no_datasets')}</div> :
              items.map(dataset => <DatasetRow key={dataset.id} dataset={dataset} />)}
      </section>
      {hasMore && <div className="text-center mt-6"><button className="btn btn-outline btn-sm rounded-full px-7" onClick={loadMore} disabled={loadingMore}>{loadingMore ? t('home.loading') : t('home.load_more')}</button></div>}
    </div>
  );
}
