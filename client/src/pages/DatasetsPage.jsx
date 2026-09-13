import { Link } from 'react-router-dom';
import { searchDatasets } from '../api/catalog.js';
import useCatalogPage from '../hooks/useCatalogPage.js';
import { PAGE_SIZE } from '../utils/catalogPagination.js';
import CatalogPagination from '../components/CatalogPagination.jsx';
import DatasetRow from '../components/DatasetRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useLang } from '../i18n.jsx';

export default function DatasetsPage() {
  const { t } = useLang();
  const collection = useCatalogPage(cursor => searchDatasets({ limit: PAGE_SIZE, cursor }), []);
  return <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
    <h1 className="text-3xl font-bold font-display">{collection.notFound ? t('common.not_found') : t('catalogue.title')}</h1>
    <p className="text-base-content/65">{t('catalogue.description')}</p>
    <div className="flex flex-wrap gap-4">
      <Link to="/" className="link">{t('common.back_search')}</Link>
      <Link to="/organizations" className="link">{t('nav.organizations')}</Link>
      <Link to="/places" className="link">{t('nav.places')}</Link>
    </div>
    {collection.loading ? <LoadingSpinner /> : collection.error ? <div className="alert alert-error">{collection.error.message}</div> :
      !collection.notFound && <section className="space-y-3" aria-label={t('orgs.dataset_list')}>
        {collection.items.map(dataset => <DatasetRow key={dataset.id} dataset={dataset} />)}
      </section>}
    {!collection.error && !collection.notFound && <CatalogPagination {...collection} />}
  </div>;
}
