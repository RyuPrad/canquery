export const PAGE_SIZE = 50;
export const MAX_QUERY_OFFSET = 10000;
export const MAX_PAGE_INDEX = Math.floor(MAX_QUERY_OFFSET / PAGE_SIZE);

/** @param {URLSearchParams} params @returns {import('../api/contracts').ResourceUrlState} */
export function readResourceUrl(params) {
  /** @type {Record<string, string>} */
  let columnFilters = {};
  try {
    const value = JSON.parse(params.get('cf') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      columnFilters = Object.fromEntries(
        Object.entries(value).filter(([, text]) => typeof text === 'string')
      );
    }
  } catch {
    /* A malformed link starts with no column filters. */
  }
  const requested = params.get('view');
  const page = Number(params.get('page'));
  return {
    q: params.get('q') || '',
    columnFilters,
    sort: params.get('sort') || null,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, MAX_PAGE_INDEX) : 0,
    view: requested === 'chart' || requested === 'map' ? requested : 'table'
  };
}

/** @param {URLSearchParams} params @param {import('../api/contracts').ResourceUrlState} state */
export function writeResourceUrl(params, { q, columnFilters, sort, page, view }) {
  const next = new URLSearchParams(params);
  for (const key of ['q', 'cf', 'sort', 'page', 'view']) next.delete(key);
  if (q) next.set('q', q);
  const active = Object.fromEntries(Object.entries(columnFilters).filter(([, value]) => value));
  if (Object.keys(active).length) next.set('cf', JSON.stringify(active));
  if (sort) next.set('sort', sort);
  if (page > 0) next.set('page', String(page));
  if (view !== 'table') next.set('view', view);
  return next;
}

// This is a presentation projection, not the preparation state machine. A
// stale serving snapshot and a running refresh can coexist independently.
/** @param {{view: import('../api/contracts').ResourceView, hasMap: boolean, filtersNeedPreparation: boolean, hasData: boolean, dataLoading: boolean, preparationRequired: boolean, downloadOnly: boolean, rowUnavailable: boolean, rowError: boolean}} state */
export function resourceViewState({
  view,
  hasMap,
  filtersNeedPreparation,
  hasData,
  dataLoading,
  preparationRequired,
  downloadOnly,
  rowUnavailable,
  rowError
}) {
  if (view === 'map') return hasMap ? 'map' : 'map-loading';
  if (view === 'table' && filtersNeedPreparation && !hasData) return 'filter-preparation';
  if (view === 'table' && dataLoading && !hasData && !preparationRequired) return 'loading';
  if (downloadOnly) return 'download';
  if (preparationRequired || (view === 'table' && rowUnavailable)) return 'preparation';
  if (view === 'chart') return 'chart';
  if (rowError) return 'error';
  return hasData ? 'table' : 'loading';
}
