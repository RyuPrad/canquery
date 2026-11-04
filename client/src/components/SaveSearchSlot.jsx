import { hostedPart } from '../extensions.js';
import { hasCatalogCriteria } from '../utils/catalogSearchState.js';

// Where the hosted service offers to follow a catalogue search (its new datasets
// arrive in a weekly digest). Only a search with criteria besides a place can be
// followed: a place alone is followed from its page, which also covers the places
// inside it. total is null while the count is unknown or out of date. The
// community edition shows nothing.
const { SaveSearch } = hostedPart(import.meta.glob('../enterprise/follow.jsx', { eager: true }), {});

/** @param {{ search?: import('../api/contracts').CatalogSearchState, total?: number | null }} props */
export default function SaveSearchSlot(props) {
  return SaveSearch && props.search && hasCatalogCriteria({ ...props.search, place: '' }) ? <SaveSearch {...props} /> : null;
}
