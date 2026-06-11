
import { Link } from 'react-router-dom';

export default function DatasetRow({ dataset }) {
  const title = dataset.title?.en || dataset.title?.fr || dataset.name;
  const orgTitle = dataset.organization?.title?.en || dataset.organization?.title?.fr;
  const displayOrg = dataset.organization && orgTitle;
  const modifiedDate = dataset.metadata_modified
    ? new Date(dataset.metadata_modified).toLocaleDateString()
    : null;

  return (
    <Link
      to={'/datasets/' + (dataset.name || dataset.id)}
      className="block card bg-base-200 hover:bg-base-300 transition-colors p-4"
    >
      <div className="flex justify-between gap-3">
        <div>
          <div className="font-semibold text-base-content">{title}</div>
          <div className="text-sm opacity-60">
            {displayOrg && <>{displayOrg}</>}
            {displayOrg && modifiedDate && ' '}
            {modifiedDate}
          </div>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          <span className="badge badge-ghost">{dataset.resource_count} resources</span>
          {dataset.queryable_count > 0 && (
            <span className="badge bg-[#d52b1e] text-white border-none">
              {dataset.queryable_count} queryable
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
