import { hostedPart } from '../extensions.js';

// Where the hosted service offers to watch a table's search: the new rows that
// match it arrive in the owner's digest. q and filters are the table's search
// as it is sent to the API; total is how many rows match it, or null while
// that is unknown. The community edition shows nothing.
const { WatchTable } = hostedPart(import.meta.glob('../enterprise/follow.jsx', { eager: true }), {});

/** @param {{ resourceId?: string, q?: string, filters?: Record<string, { op: string, value: string }>, total?: number | null }} props */
export default function WatchTableSlot(props) {
  return WatchTable && props.resourceId ? <WatchTable {...props} /> : null;
}
