import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { BuildingIcon, CalendarIcon, ArrowRightIcon } from './Icons.jsx';

export default function DatasetRow({ dataset }) {
  const { t } = useLang();
  const title = dataset.title?.en || dataset.title?.fr || dataset.name;
  const orgTitle = dataset.organization?.title?.en || dataset.organization?.title?.fr;
  const modifiedDate = dataset.metadata_modified
    ? new Date(dataset.metadata_modified).toLocaleDateString()
    : null;

  return (
    <Link
      to={'/datasets/' + (dataset.name || dataset.id)}
      className="oc-card block p-4 sm:px-5 group"
    >
      <div className="flex justify-between items-center gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-[0.95rem] leading-snug line-clamp-2 group-hover:text-white transition-colors">
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
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="oc-chip">
            {dataset.resource_count} {t('row.resources')}
          </span>
          {dataset.queryable_count > 0 && (
            <span className="oc-chip oc-chip-red">
              {dataset.queryable_count} {t('row.queryable')}
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
