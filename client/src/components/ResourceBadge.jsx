import { useLang } from '../i18n.jsx';

const MODES = {
  datastore: { labelKey: 'badge.datastore', tipKey: 'badge.datastore_tip', classes: 'oc-badge oc-badge-datastore' },
  ingested: { labelKey: 'badge.ingested', tipKey: 'badge.ingested_tip', classes: 'oc-badge oc-badge-ingested' },
  ingestable: { labelKey: 'badge.ingestable', tipKey: 'badge.ingestable_tip', classes: 'oc-badge oc-badge-ingestable' },
};
const FALLBACK = { labelKey: 'badge.fileonly', tipKey: 'badge.fileonly_tip', classes: 'oc-badge oc-badge-fileonly' };

export default function ResourceBadge({ mode }) {
  const { t } = useLang();
  const m = MODES[mode] || FALLBACK;
  return (
    <span className="tooltip tooltip-bottom" data-tip={t(m.tipKey)}>
      <span className={m.classes}>{t(m.labelKey)}</span>
    </span>
  );
}
