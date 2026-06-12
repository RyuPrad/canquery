import { useLang } from '../i18n.jsx';

const MODES = {
  datastore: { labelKey: 'badge.datastore', tipKey: 'badge.datastore_tip', classes: 'badge badge-success badge-outline' },
  ingested: { labelKey: 'badge.ingested', tipKey: 'badge.ingested_tip', classes: 'badge bg-[#d52b1e] text-white border-none' },
  ingestable: { labelKey: 'badge.ingestable', tipKey: 'badge.ingestable_tip', classes: 'badge badge-warning badge-outline' },
};
const FALLBACK = { labelKey: 'badge.fileonly', tipKey: 'badge.fileonly_tip', classes: 'badge badge-ghost' };

export default function ResourceBadge({ mode }) {
  const { t } = useLang();
  const m = MODES[mode] || FALLBACK;
  return (
    <span className="tooltip tooltip-bottom" data-tip={t(m.tipKey)}>
      <span className={m.classes}>{t(m.labelKey)}</span>
    </span>
  );
}
