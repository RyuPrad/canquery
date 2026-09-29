import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import usePaginatedCollection from './usePaginatedCollection.js';

const page = (items, nextCursor = null) => ({ data: items, pagination: { nextCursor } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
let fetchPage;

beforeEach(() => { fetchPage = vi.fn(); });

test.each(['resolve', 'reject'])('discards an old load-more %s after the filters change', async outcome => {
  const oldMore = deferred();
  fetchPage.mockImplementation((filter, cursor) => cursor ? oldMore.promise : Promise.resolve(page([filter], '20')));
  const { result, rerender } = renderHook(({ filter }) => usePaginatedCollection(cursor => fetchPage(filter, cursor), [filter]), {
    initialProps: { filter: 'old' }
  });
  await waitFor(() => expect(result.current.items).toEqual(['old']));
  act(() => { void result.current.loadMore(); });
  rerender({ filter: 'new' });
  await waitFor(() => expect(result.current.items).toEqual(['new']));
  await act(async () => {
    if (outcome === 'resolve') oldMore.resolve(page(['old second page']));
    else oldMore.reject(new Error('Old request failed'));
  });
  expect(result.current.items).toEqual(['new']);
  expect(result.current.error).toBeNull();
  expect(result.current.hasMore).toBe(true);
});

test('clears the previous collection while a new search is loading', async () => {
  const newPage = deferred();
  fetchPage.mockImplementation(filter => filter === 'new' ? newPage.promise : Promise.resolve(page(['old'], '20')));
  const { result, rerender } = renderHook(({ filter }) => usePaginatedCollection(cursor => fetchPage(filter, cursor), [filter]), {
    initialProps: { filter: 'old' }
  });
  await waitFor(() => expect(result.current.items).toEqual(['old']));
  rerender({ filter: 'new' });
  expect(result.current.loading).toBe(true);
  expect(result.current.items).toEqual([]);
  expect(result.current.hasMore).toBe(false);
  await act(async () => newPage.resolve(page(['new'])));
});

test('does not clear a current load-more indicator when an old request finishes', async () => {
  const oldMore = deferred();
  const newMore = deferred();
  fetchPage.mockImplementation((filter, cursor) => cursor
    ? (filter === 'old' ? oldMore.promise : newMore.promise)
    : Promise.resolve(page([filter], '20')));
  const { result, rerender } = renderHook(({ filter }) => usePaginatedCollection(cursor => fetchPage(filter, cursor), [filter]), {
    initialProps: { filter: 'old' }
  });
  await waitFor(() => expect(result.current.items).toEqual(['old']));
  act(() => { void result.current.loadMore(); });
  rerender({ filter: 'new' });
  await waitFor(() => expect(result.current.items).toEqual(['new']));
  act(() => { void result.current.loadMore(); });
  await act(async () => oldMore.resolve(page(['old more'])));
  expect(result.current.loadingMore).toBe(true);
  await act(async () => newMore.resolve(page(['new more'])));
  expect(result.current.items).toEqual(['new', 'new more']);
  expect(result.current.loadingMore).toBe(false);
});

test('joins repeated load-more clicks and clears a failed attempt on retry', async () => {
  const firstMore = deferred();
  fetchPage.mockResolvedValueOnce(page(['first'], '20')).mockReturnValueOnce(firstMore.promise).mockResolvedValueOnce(page(['second']));
  const { result } = renderHook(() => usePaginatedCollection(fetchPage, []));
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  act(() => {
    void result.current.loadMore();
    void result.current.loadMore();
  });
  expect(fetchPage).toHaveBeenCalledTimes(2);
  await act(async () => firstMore.reject(new Error('Please retry')));
  expect(result.current.error.message).toBe('Please retry');
  await act(async () => result.current.loadMore());
  expect(result.current.items).toEqual(['first', 'second']);
  expect(result.current.error).toBeNull();
});
