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
    ? new Date(dataset.metadata_modified).toLocaleDateString()
    : null;

  return (
    <Link
      to={'/datasets/' + (dataset.name || dataset.id)}
      className="cq-card block p-4 sm:px-5 group"
    >
      <div className="flex justify-between items-center gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-[0.95rem] leading-snug line-clamp-2 group-hover:text-base-content transition-colors">
            {title}
          </div>
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
                {modifiedDate}
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
        <div className="flex items-center gap-2 shrink-0">
          <span className="cq-chip">
            {dataset.resource_count} {t('row.resources')}
          </span>
          {dataset.queryable_count > 0 && (
            <span className="cq-chip cq-chip-red">
              {dataset.queryable_count} {t('row.queryable')}
            </span>
          )}
          {dataset.mappable_count > 0 && (
            <span className="cq-chip cq-chip-teal">
              <MapIcon size={11} />
              {t('places.map')}
            </span>
          )}
          <ArrowRightIcon
            size={15}
            className="opacity-0 group-hover:opacity-50 transition-opacity hidden sm:block"
          />
        </div>
      </div>
    </Link>
  );
}
