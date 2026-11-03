import { hostedPart } from '../extensions.js';

// Where the hosted service offers to watch an employer on the positive LMIA list
// (search results and employer pages). The community edition shows nothing.
const { LmiaWatch } = hostedPart(import.meta.glob('../enterprise/lmia.jsx', { eager: true }), {});

/** @param {{ employer?: string, employerKey?: string, province?: string | null, placement?: string }} props */
export default function LmiaWatchSlot(props) {
  return LmiaWatch && props.employer && props.employerKey ? <LmiaWatch {...props} /> : null;
}
