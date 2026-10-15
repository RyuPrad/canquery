import { describe, expect, test } from 'vitest';
import {
  EMPTY_CATALOG_SEARCH,
  activeFilterCount,
  catalogApiParams,
  hasCatalogCriteria,
  readCatalogSearch,
  toggleCatalogValue,
  writeCatalogSearch
} from './catalogSearchState.js';

describe('catalogue search URL state', () => {
  test('reads repeated values, normalizes them and ignores invalid ones', () => {
    const params = new URLSearchParams(
      'q=parks&format=csv&format=CSV&format=pdf&level=Federal&level=national&org=a&org=' + 'x'.repeat(201) +
        '&mappable=1&queryable=yes&sort=newest&place=toronto-on'
    );
    expect(readCatalogSearch(params)).toEqual({
      ...EMPTY_CATALOG_SEARCH,
      q: 'parks',
      format: ['CSV', 'PDF'],
      level: ['federal'],
      org: ['a'],
      place: 'toronto-on',
      mappable: true
    });
  });

  test('caps each list at twenty values', () => {
    const params = new URLSearchParams(Array.from({ length: 25 }, (_, i) => ['keyword', 'k' + i]));
    expect(readCatalogSearch(params).keyword).toHaveLength(20);
  });

  test('writes non-default values, drops the page and keeps unrelated parameters', () => {
    const params = new URLSearchParams('utm_source=guide&page=4&q=old&sort=relevance');
    const state = { ...EMPTY_CATALOG_SEARCH, q: 'roads', format: ['CSV', 'XLSX'], level: ['municipal'], queryable: true, sort: 'title' };
    const written = writeCatalogSearch(params, state);
    expect(written.toString()).toBe('utm_source=guide&q=roads&format=CSV&format=XLSX&level=municipal&queryable=true&sort=title');
    expect(readCatalogSearch(written)).toEqual(state);
    expect(writeCatalogSearch(written, EMPTY_CATALOG_SEARCH).toString()).toBe('utm_source=guide');
  });

  test('summarizes criteria and toggles values', () => {
    expect(hasCatalogCriteria(EMPTY_CATALOG_SEARCH)).toBe(false);
    expect(hasCatalogCriteria({ ...EMPTY_CATALOG_SEARCH, sort: 'title' })).toBe(false);
    const state = toggleCatalogValue({ ...EMPTY_CATALOG_SEARCH, place: 'oshawa-on', mappable: true }, 'source', 'portal');
    expect(state.source).toEqual(['portal']);
    expect(hasCatalogCriteria(state)).toBe(true);
    expect(activeFilterCount(state)).toBe(3);
    expect(activeFilterCount(state, { includePlace: false })).toBe(2);
    expect(toggleCatalogValue(state, 'source', 'portal').source).toEqual([]);
  });

  test('sends the language only when it changes the answer', () => {
    expect(catalogApiParams(EMPTY_CATALOG_SEARCH, { lang: 'fr' })).toEqual(expect.objectContaining({ lang: undefined, sort: undefined, facets: undefined }));
    expect(catalogApiParams({ ...EMPTY_CATALOG_SEARCH, sort: 'title_desc' }, { lang: 'fr' }).lang).toBe('fr');
    expect(catalogApiParams({ ...EMPTY_CATALOG_SEARCH, format: ['CSV'] }, { lang: 'de', facets: true })).toEqual(
      expect.objectContaining({ format: ['CSV'], org: undefined, lang: 'en', facets: true })
    );
  });
});
