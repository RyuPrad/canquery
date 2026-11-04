import { hostedPart } from '../extensions.js';

// Where the hosted service tells a visitor how many free table searches are
// left and, after the last one, asks for a free account. The community edition
// shows nothing.
const { QueryWall } = hostedPart(import.meta.glob('../enterprise/queryWall.jsx', { eager: true }), {});

/** @param {{ resourceId?: string, datasetId?: string }} props */
export default function QueryGateSlot(props) {
  return QueryWall && props.resourceId ? <QueryWall {...props} /> : null;
}
