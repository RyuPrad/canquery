import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import useOptimisticSearch from './useOptimisticSearch.js';
import { EMPTY_CATALOG_SEARCH, toggleCatalogValue } from '../utils/catalogSearchState.js';

test('controls show changes at once and quick changes build on each other until the URL catches up', () => {
  const apply = vi.fn();
  const { result, rerender } = renderHook(({ search }) => useOptimisticSearch(search, apply), {
    initialProps: { search: EMPTY_CATALOG_SEARCH }
  });
  act(() => result.current[1](toggleCatalogValue(result.current[0], 'format', 'CSV')));
  expect(result.current[0].format).toEqual(['CSV']);
  act(() => result.current[1](toggleCatalogValue(result.current[0], 'format', 'PDF')));
  expect(result.current[0].format).toEqual(['CSV', 'PDF']);
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ format: ['CSV', 'PDF'] }));
  // The URL catches up; afterwards it is the source of truth again.
  rerender({ search: { ...EMPTY_CATALOG_SEARCH, format: ['CSV', 'PDF'] } });
  expect(result.current[0].format).toEqual(['CSV', 'PDF']);
  // Another navigation, such as Back, replaces any pending change.
  act(() => result.current[1]({ ...result.current[0], level: ['federal'] }));
  rerender({ search: { ...EMPTY_CATALOG_SEARCH, keyword: ['roads'] } });
  expect(result.current[0]).toEqual({ ...EMPTY_CATALOG_SEARCH, keyword: ['roads'] });
});
