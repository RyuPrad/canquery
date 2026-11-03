import { hostedPart } from '../extensions.js';

// Where the hosted service offers to follow a place or a publisher (their new
// datasets arrive in a weekly digest). The community edition shows nothing.
const { Follow } = hostedPart(import.meta.glob('../enterprise/follow.jsx', { eager: true }), {});

/** @param {{ kind: 'place' | 'organization', target?: string, title?: string }} props */
export default function FollowSlot(props) {
  return Follow && props.target && props.title ? <Follow {...props} /> : null;
}
