import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { BuildingIcon, CalendarIcon, ArrowRightIcon, MapPinIcon, MapIcon } from './Icons.jsx';

export default function DatasetRow({ dataset }) {
  const { t, lang } = useLang();
  const title = dataset.title?.[lang] || dataset.title?.en || dataset.title?.fr || dataset.name;
  const orgTitle = dataset.organization?.title?.[lang] || dataset.organization?.title?.en || dataset.organization?.title?.fr;
  const place = dataset.place_match?.place || dataset.places?.[0];
  const source = dataset.provenance?.sources?.[0];
  const modifiedDate = dataset.metadata_modified
    ? new Date(dataset.metadata_modified).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA')
    : null;

  return (
    <article
      className="cq-card block p-4 sm:px-5 group"
    >
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="min-w-0 sm:flex-1">
          <div className="font-semibold text-[0.95rem] leading-snug line-clamp-2 group-hover:text-base-content transition-colors">
            <Link to={'/datasets/' + (dataset.name || dataset.id)} className="hover:underline"
              data-analytics-event="dataset_open" data-analytics-dataset-id={dataset.id} data-analytics-source="catalog_result">{title}</Link>
          </div>
          {(dataset.description?.[lang] || dataset.description?.en || dataset.description?.fr) && (
            <p className="text-sm text-base-content/65 mt-2 line-clamp-2">{dataset.description?.[lang] || dataset.description?.en || dataset.description?.fr}</p>
          )}
          <div className="text-[0.8rem] text-base-content/45 mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
            {orgTitle && (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <BuildingIcon size={12} className="shrink-0" />
                <span className="truncate">{orgTitle}</span>
              </span>
            )}
            {modifiedDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon size={12} />
                <span title={t('discovery.metadata')}>{t('discovery.metadata')}: {modifiedDate}</span>
              </span>
            )}
            {place && (
              <span className="inline-flex items-center gap-1.5">
                <MapPinIcon size={12} />
                {place.name?.[lang] || place.name?.en}
                {dataset.place_match?.tier === 'parent' && <span className="opacity-60">{t('places.parent_match')}</span>}
              </span>
            )}
            {source && <span className="truncate">{source.name?.[lang] || source.name?.en || source.id}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="cq-chip">
            {dataset.resource_count.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')} {t('row.resources')}
          </span>
          {dataset.queryable_count > 0 && (
            <span className="cq-chip cq-chip-red">
              {dataset.queryable_count.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')} {t('row.queryable')}
            </span>
          )}
          {dataset.mappable_count > 0 && (
            <span className="cq-chip cq-chip-teal">
              <MapIcon size={11} />
              {t('places.map')}
            </span>
          )}
          {dataset.preview_resources?.map && <Link className="btn btn-sm btn-outline" to={'/resources/' + encodeURIComponent(dataset.preview_resources.map) + '?view=map'}
            data-analytics-event="resource_view" data-analytics-view="map" data-analytics-source="catalog_result" data-analytics-resource-id={dataset.preview_resources.map}>
            {t('discovery.map')}
          </Link>}
          {dataset.preview_resources?.table && <Link className="btn btn-sm btn-outline" to={'/resources/' + encodeURIComponent(dataset.preview_resources.table)}
            data-analytics-event="resource_open" data-analytics-source="catalog_result" data-analytics-resource-id={dataset.preview_resources.table}>
            {t('discovery.table')}
          </Link>}
          <ArrowRightIcon
            size={15}
            className="opacity-0 group-hover:opacity-50 transition-opacity hidden sm:block"
          />
        </div>
      </div>
    </article>
  );
}
