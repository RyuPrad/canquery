import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchOrganization, searchDatasets } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import usePaginatedCollection from '../hooks/usePaginatedCollection.js';
import { track } from '../utils/analytics.js';
import { useLang } from '../i18n.jsx';
import SearchBar from '../components/SearchBar.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import { BuildingIcon, MapIcon, MapPinIcon, TableIcon } from '../components/Icons.jsx';

export default function OrganizationPage() {
  const { name } = useParams();
  const { lang, t } = useLang();
  const [organization, setOrganization] = useState(null);
  const [query, setQuery] = useState('');
  const [mappable, setMappable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    let cancelled = false;
    setOrganization(null);
    setNotFound(false);
    setError(null);
    fetchOrganization(name)
      .then(env => {
        if (cancelled) return;
        setOrganization(env.data);
        track('organization_open', {
          organization: env.data.name,
          dataset_count: env.data.dataset_count,
          source: 'page',
        });
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof NotFoundError) setNotFound(true);
        else setError(err);
      });
    return () => { cancelled = true; };
  }, [name]);

  useEffect(() => {
    if (debouncedQuery) {
      track('catalog_filter', {
        filter: 'organization_search',
        value: debouncedQuery,
        organization: name,
      });
    }
  }, [debouncedQuery, name]);

  const { items, loading, loadingMore, error: searchError, hasMore, loadMore } = usePaginatedCollection(
    cursor => searchDatasets({
      q: debouncedQuery || undefined,
      org: name,
      mappable: mappable || undefined,
      limit: 20,
      cursor,
    }),
    [name, debouncedQuery, mappable]
  );

  if (notFound) {
    return <div className="text-center py-28"><h1 className="text-2xl font-bold font-display">{t('common.organization_not_found')}</h1></div>;
  }
  if (error) return <div className="max-w-5xl mx-auto px-4 py-8"><div className="alert alert-error">{error.message}</div></div>;
  if (!organization) return <LoadingSpinner label={t('orgs.loading_one')} />;

  const title = organization.title?.[lang] || organization.title?.en || organization.title?.fr || organization.name;
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <Breadcrumbs
        className="mb-5"
        label={t('breadcrumbs.label')}
        items={[
          { label: t('nav.organizations'), to: '/organizations' },
          { label: title },
        ]}
      />

      <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
        <div className="relative">
          <span className="cq-chip"><BuildingIcon size={12} />{t('orgs.publisher')}</span>
          <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3">{title}</h1>
          <div className="flex flex-wrap gap-2 mt-4">
            <span className="cq-chip cq-chip-mono">{organization.dataset_count.toLocaleString(locale)} {t('orgs.datasets')}</span>
            <span className="cq-chip cq-chip-red"><TableIcon size={11} />{organization.queryable_dataset_count.toLocaleString(locale)} {t('orgs.queryable')}</span>
            <span className="cq-chip cq-chip-teal"><MapIcon size={11} />{organization.mappable_dataset_count.toLocaleString(locale)} {t('orgs.mappable')}</span>
          </div>
          {organization.place && (
            <Link
              to={'/places/' + organization.place.slug}
              className="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content mt-4"
            >
              <MapPinIcon size={13} />
              {organization.place.name?.[lang] || organization.place.name?.en || organization.place.slug}
            </Link>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-3 mt-8">
        <SearchBar value={query} onChange={setQuery} />
        <button
          className={'cq-pill justify-center inline-flex items-center gap-1.5' + (mappable ? ' cq-pill-active' : '')}
          onClick={() => setMappable(value => {
            track('catalog_filter', { filter: 'mappable', value: !value, organization: name });
            return !value;
          })}
          aria-pressed={mappable}
        >
          <MapIcon size={13} />{t('orgs.has_map')}
        </button>
      </div>

      <section className="space-y-3 mt-6" aria-label={t('orgs.dataset_list')}>
        {loading ? [...Array(5)].map((_, index) => <div className="cq-skel h-[82px]" key={index} />) :
          searchError ? <div className="alert alert-error">{searchError.message}</div> :
            items.length === 0 ? <div className="text-center py-14 text-base-content/50">{t('orgs.no_datasets')}</div> :
              items.map(dataset => <DatasetRow key={dataset.id} dataset={dataset} />)}
      </section>
      {hasMore && (
        <div className="text-center mt-6">
          <button
            className="btn btn-outline btn-sm rounded-full px-7"
            onClick={() => {
              track('catalog_filter', { action: 'load_more', organization: name });
              loadMore();
            }}
            disabled={loadingMore}
          >
            {loadingMore ? t('home.loading') : t('home.load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
