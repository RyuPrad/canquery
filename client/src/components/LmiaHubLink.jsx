import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { LMIA_DATASET_ID } from '../utils/lmia.js';

// On the positive LMIA employers dataset and its files: the employer search across
// every list (/lmia). Nothing on any other dataset.
/** @param {{ datasetId?: string, className?: string }} props */
export default function LmiaHubLink({ datasetId, className = '' }) {
  const { t } = useLang();
  if (datasetId !== LMIA_DATASET_ID) return null;
  return (
    <div className={'rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center ' +
      'justify-between gap-3 ' + className}>
      <p className="text-base-content/75">{t('lmia.dataset_callout')}</p>
      <Link to="/lmia" className="btn btn-sm btn-primary shrink-0">{t('lmia.dataset_callout_link')}</Link>
    </div>
  );
}
