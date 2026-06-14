import { useLang } from '../i18n.jsx';

const MODES = {
  datastore: { labelKey: 'badge.datastore', tipKey: 'badge.datastore_tip', classes: 'cq-badge cq-badge-datastore' },
  ingested: { labelKey: 'badge.ingested', tipKey: 'badge.ingested_tip', classes: 'cq-badge cq-badge-ingested' },
  ingestable: { labelKey: 'badge.ingestable', tipKey: 'badge.ingestable_tip', classes: 'cq-badge cq-badge-ingestable' },
};
const FALLBACK = { labelKey: 'badge.fileonly', tipKey: 'badge.fileonly_tip', classes: 'cq-badge cq-badge-fileonly' };

export default function ResourceBadge({ mode }) {
  const { t } = useLang();
  const m = MODES[mode] || FALLBACK;
  return (
    <span className="tooltip tooltip-bottom" data-tip={t(m.tipKey)}>
      <span className={m.classes}>{t(m.labelKey)}</span>
    </span>
  );
}
