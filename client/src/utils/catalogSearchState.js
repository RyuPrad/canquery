// Catalogue search state lives in the URL so results survive Back and can be
// shared. Filters are checkboxes and buttons, never links, so these URLs are
// not crawl paths; the server renders every variant as the unfiltered page.

/** @typedef {import('../api/contracts').CatalogSearchState} CatalogSearchState */
/** @typedef {import('../api/contracts').CatalogListKey} CatalogListKey */

/** @type {readonly CatalogListKey[]} */
export const CATALOG_LIST_KEYS = ['org', 'format', 'keyword', 'source', 'level'];
/** @type {readonly import('../api/contracts').CatalogLevel[]} */
export const CATALOG_LEVELS = ['federal', 'provincial', 'municipal'];
/** @type {readonly import('../api/contracts').CatalogSort[]} */
export const CATALOG_SORTS = ['relevance', 'updated', 'title', 'title_desc'];
const MANAGED_KEYS = ['q', 'place', 'mappable', 'queryable', 'sort', 'page', ...CATALOG_LIST_KEYS];
const MAX_VALUES = 20;
const MAX_LENGTH = 200;

/** @type {Readonly<CatalogSearchState>} */
export const EMPTY_CATALOG_SEARCH = Object.freeze({
  q: '',
  org: [],
  format: [],
  keyword: [],
  source: [],
  level: [],
  place: '',
  mappable: false,
  queryable: false,
  sort: 'relevance'
});

/** @param {URLSearchParams} params @param {string} key @param {(value: string) => string} [transform] */
function readList(params, key, transform = (value) => value) {
  const values = params
    .getAll(key)
    .map((value) => value.trim())
    .filter((value) => value && value.length <= MAX_LENGTH)
    .map(transform);
  return Array.from(new Set(values)).slice(0, MAX_VALUES);
}

/** @param {string | null} value */
const isOn = (value) => value === 'true' || value === '1';

/** @param {URLSearchParams} params @returns {CatalogSearchState} */
export function readCatalogSearch(params) {
  const levels = readList(params, 'level', (value) => value.toLowerCase());
  const sort = params.get('sort');
  return {
    q: params.get('q') || '',
    org: readList(params, 'org'),
    format: readList(params, 'format', (value) => value.toUpperCase()),
    keyword: readList(params, 'keyword'),
    source: readList(params, 'source'),
    level: CATALOG_LEVELS.filter((level) => levels.includes(level)),
    place: params.get('place') || '',
    mappable: isOn(params.get('mappable')),
    queryable: isOn(params.get('queryable')),
    sort: CATALOG_SORTS.find((value) => value === sort) || 'relevance'
  };
}

// Writes only non-default values and drops the page number, which belongs to
// the previous result set. Unrelated parameters such as utm_* are kept.
/** @param {URLSearchParams} params @param {CatalogSearchState} state */
export function writeCatalogSearch(params, state) {
  const next = new URLSearchParams(params);
  for (const key of MANAGED_KEYS) next.delete(key);
  if (state.q) next.set('q', state.q);
  for (const key of CATALOG_LIST_KEYS) for (const value of state[key]) next.append(key, value);
  if (state.place) next.set('place', state.place);
  if (state.mappable) next.set('mappable', 'true');
  if (state.queryable) next.set('queryable', 'true');
  if (state.sort !== 'relevance') next.set('sort', state.sort);
  return next;
}

/** @param {CatalogSearchState} state */
export function hasCatalogCriteria(state) {
  return Boolean(
    state.q ||
      state.place ||
      state.mappable ||
      state.queryable ||
      CATALOG_LIST_KEYS.some((key) => state[key].length > 0)
  );
}

/** @param {CatalogSearchState} state @param {{ includePlace?: boolean }} [options] */
export function activeFilterCount(state, { includePlace = true } = {}) {
  return (
    CATALOG_LIST_KEYS.reduce((count, key) => count + state[key].length, 0) +
    Number(includePlace && Boolean(state.place)) +
    Number(state.mappable) +
    Number(state.queryable)
  );
}

/** @param {CatalogSearchState} state @param {CatalogListKey} key @param {string} value @returns {CatalogSearchState} */
export function toggleCatalogValue(state, key, value) {
  const values = state[key];
  const next = values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value].slice(0, MAX_VALUES);
  return { ...state, [key]: next };
}

// Parameters for searchDatasets. The language only matters to title order
// and keyword counts, so it is sent only when it changes the answer.
/** @param {CatalogSearchState} state @param {{ lang?: string, facets?: boolean }} [options] */
export function catalogApiParams(state, { lang = 'en', facets = false } = {}) {
  /** @param {string[]} values */
  const list = (values) => (values.length ? values : undefined);
  const titleOrder = state.sort === 'title' || state.sort === 'title_desc';
  return {
    q: state.q || undefined,
    org: list(state.org),
    format: list(state.format),
    keyword: list(state.keyword),
    place: state.place || undefined,
    source: list(state.source),
    level: list(state.level),
    mappable: state.mappable || undefined,
    queryable: state.queryable || undefined,
    sort: state.sort === 'relevance' ? undefined : state.sort,
    lang: facets || titleOrder ? (lang === 'fr' ? 'fr' : 'en') : undefined,
    facets: facets || undefined
  };
}
