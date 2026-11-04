import { hostedPart } from '../extensions.js';

// Where the hosted service may ask a visitor for a free account before another
// table search: the search box, a column filter, a sort or a page change on a
// resource page. The community edition, and any error in the hosted part, lets
// every change through. Web only: the iPhone app never imports this module.
const gate = hostedPart(import.meta.glob('../enterprise/queryGate.js', { eager: true }), null);

/**
 * @param {'search' | 'filter' | 'sort' | 'page'} kind
 * @param {{ resource: string, value?: string | null, field?: string, page?: number }} detail
 * @returns {boolean} false when the change must not be applied
 */
export function allowQuery(kind, detail) {
  if (!gate) return true;
  try {
    return gate.allowQuery(kind, detail) !== false;
  } catch {
    return true;
  }
}
