import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { datasetHub } from '../utils/datasetHubs.js';

// On a dataset with a page of its own built from its files, and on each of those
// files: a callout leading there (the employer search across every positive LMIA
// list, the lookup of OAS benefit amounts). Nothing on any other dataset.
/** @param {{ datasetId?: string, className?: string }} props */
export default function DatasetHubLink({ datasetId, className = '' }) {
  const { t, lang } = useLang();
  const hub = datasetHub(datasetId);
  if (!hub) return null;
  return (
    <div className={'rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center ' +
      'justify-between gap-3 ' + className}>
      <p className="text-base-content/75">{t(hub.text)}</p>
      <Link to={hub.path(lang)} className="btn btn-sm btn-primary shrink-0">{t(hub.link)}</Link>
    </div>
  );
}
