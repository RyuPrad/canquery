export default function ResourceBadge({ mode }) {
  switch (mode) {
    case 'datastore':
      return <span className='badge badge-success badge-outline'>Queryable</span>;
    case 'ingested':
      return <span className='badge bg-[#d52b1e] text-white border-none'>Unlocked</span>;
    case 'ingestable':
      return <span className='badge badge-warning badge-outline'>Ingestable</span>;
    default:
      return <span className='badge badge-ghost'>File only</span>;
  }
}
