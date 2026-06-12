const MODES = {
  datastore: { label: 'Queryable', classes: 'badge badge-success badge-outline', tip: 'Already hosted in a live database by open.canada.ca - query it instantly' },
  ingested: { label: 'Unlocked', classes: 'badge bg-[#d52b1e] text-white border-none', tip: 'Loaded into opencanada - filter, sort and export it live' },
  ingestable: { label: 'Unlockable', classes: 'badge badge-warning badge-outline', tip: 'A CSV we can load for you - click Unlock and it is queryable in seconds' },
};
const FALLBACK = { label: 'Download only', classes: 'badge badge-ghost', tip: 'Not a CSV we can load - use the download link to get the file' };

export default function ResourceBadge({ mode }) {
  const m = MODES[mode] || FALLBACK;
  return (
    <span className="tooltip tooltip-bottom" data-tip={m.tip}>
      <span className={m.classes}>{m.label}</span>
    </span>
  );
}
