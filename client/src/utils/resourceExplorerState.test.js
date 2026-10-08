import { readResourceUrl, writeResourceUrl, resourceViewState } from './resourceExplorerState.js';

test('resource links round-trip filters while preserving unrelated query parameters', () => {
  const url = new URLSearchParams('q=water&cf=' + encodeURIComponent(JSON.stringify({ 'Year/Année': '=2024' })) + '&sort=_id%20desc&page=2&view=chart&from=guide');
  const state = readResourceUrl(url);
  expect(readResourceUrl(writeResourceUrl(url, state))).toEqual(state);
  expect(writeResourceUrl(url, { ...state, q: '', columnFilters: {}, sort: null, page: 0, view: 'table' }).toString()).toBe('from=guide');
});

test.each(['[]', 'null', 'bad json'])('malformed filter link %s remains recoverable', value => {
  expect(readResourceUrl(new URLSearchParams({ cf: value, page: '9999', view: 'other' })))
    .toMatchObject({ columnFilters: {}, page: 200, view: 'table' });
});

test('non-string filter values cannot escape a malformed URL into text controls', () => {
  expect(readResourceUrl(new URLSearchParams({ cf: JSON.stringify({ code: '=0012', invalid: { nested: true }, zero: 0 }) })).columnFilters)
    .toEqual({ code: '=0012' });
});

test('ready charts and maps do not inherit unrelated table failure state', () => {
  const state = { hasMap: true, filtersNeedPreparation: false, hasData: false, dataLoading: false,
    preparationRequired: false, downloadOnly: false, rowUnavailable: true, rowError: true };
  expect(resourceViewState({ ...state, view: 'chart' })).toBe('chart');
  expect(resourceViewState({ ...state, view: 'map' })).toBe('map');
  expect(resourceViewState({ ...state, view: 'table' })).toBe('preparation');
});
