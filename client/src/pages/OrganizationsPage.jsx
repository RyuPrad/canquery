import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useCatalogPage from '../hooks/useCatalogPage';
import CatalogPagination from '../components/CatalogPagination.jsx';
import { PAGE_SIZE } from '../utils/catalogPagination.js';
import { fetchOrganizations } from '../api/catalog';
import { useLang } from '../i18n.jsx';
import { SearchIcon } from '../components/Icons.jsx';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import { track } from '../utils/analytics.js';

function OrgCard({ org, t, lang }) {
  const title = org.title?.[lang] || org.title?.en || org.title?.fr || org.name;
  return (
    <Link
      key={org.id}
      to={'/organizations/' + encodeURIComponent(org.name)}
      title={'See every dataset from ' + title}
      className="cq-card p-4 grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 lg:flex lg:gap-3.5 group"
      data-analytics-event="organization_open"
      data-analytics-organization={org.name}
      data-analytics-dataset-count={org.dataset_count}
      data-analytics-source="organization_card"
    >
      <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center font-display font-bold text-base shrink-0">
        {title.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[0.92rem] leading-snug line-clamp-2 group-hover:text-base-content transition-colors">
          {title}
        </div>
        <div className="text-xs text-base-content/35 font-mono truncate mt-0.5">{org.name}</div>
      </div>
      <span className="cq-chip cq-chip-mono shrink-0 col-start-2 justify-self-start">
        {org.dataset_count} {t('orgs.datasets')}
      </span>
    </Link>
  );
}

export default function OrganizationsPage() {
  const { t, lang } = useLang();
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebouncedValue(filter, 250);
  const collection = useCatalogPage(
    cursor => fetchOrganizations({ q: debouncedFilter || undefined, limit: PAGE_SIZE, cursor }),
    [debouncedFilter], Boolean(debouncedFilter)
  );
  const { items, loading, error } = collection;

  useEffect(() => {
    if (debouncedFilter) track('catalog_filter', { filter: 'organization_search', value: debouncedFilter });
  }, [debouncedFilter]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <h1 className="text-3xl font-bold font-display tracking-tight pb-6">
        {collection.notFound ? t('common.not_found') : t('nav.organizations')}
      </h1>
      <div className="cq-search cq-search-sm w-full max-w-md">
        <SearchIcon size={14} className="opacity-40 shrink-0" />
        <input
          placeholder={t('orgs.filter_placeholder')}
          aria-label={t('orgs.filter_placeholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 mt-5 sm:grid-cols-2" aria-label={t('orgs.loading')}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="cq-skel h-[74px]" />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert-error mt-5">{error.message}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 mt-5 sm:grid-cols-2">
            {items.map(o => (
              <OrgCard key={o.id} org={o} t={t} lang={lang} />
            ))}
          </div>
          {!collection.notFound && <CatalogPagination {...collection} />}
        </>
      )}
    </div>
  );
}
