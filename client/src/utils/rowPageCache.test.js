import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as cache from './rowPageCache.js';

const page = (total = 100, records = [{ _id: 1 }]) => ({ fields: [{ id: '_id', type: 'int' }], records, total, mode: 'ingested' });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const never = () => new Promise(() => {});

beforeEach(() => { cache.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('page keys', () => {
  test('ignore filter order and empty search, sort and filter values', () => {
    const a = cache.pageKey({ id: 'r', q: '', filters: { b: { op: 'eq', value: '1' }, a: { op: 'contains', value: 'x' } }, sort: null, page: 0 });
    const b = cache.pageKey({ id: 'r', q: null, filters: { a: { op: 'contains', value: 'x' }, b: { op: 'eq', value: '1' } }, sort: '', page: 0 });
    expect(a).toBe(b);
    expect(cache.pageKey({ id: 'r', page: 1 })).not.toBe(cache.pageKey({ id: 'r', page: 0 }));
    expect(cache.pageKey({ id: 'r', q: 'x', page: 0 })).not.toBe(cache.pageKey({ id: 'r', page: 0 }));
    expect(cache.pageKey({ id: 'r', sort: 'name desc', page: 0 })).not.toBe(cache.pageKey({ id: 'r', page: 0 }));
    expect(cache.pageKey({ id: 'other', page: 0 })).not.toBe(cache.pageKey({ id: 'r', page: 0 }));
  });
});

describe('stored pages', () => {
  test('are valid for their snapshot or an unknown pin, never for another snapshot', () => {
    cache.seed('k', { id: 'r', data: page(), snapshotId: 's1' });
    expect(cache.peek('k', 's1')).toEqual(page());
    expect(cache.peek('k', null)).toEqual(page());
    expect(cache.peek('k')).toEqual(page());
    expect(cache.peek('k', 's2')).toBeNull();
    expect(cache.peekSource('k', 's1')).toBe('inline');
    expect(cache.peek('missing', 's1')).toBeNull();
  });

  test('live pages without a snapshot expire after a minute', () => {
    vi.useFakeTimers();
    cache.seed('k', { id: 'r', data: page(), snapshotId: null, source: 'network' });
    expect(cache.peek('k')).toEqual(page());
    expect(cache.peek('k', 's1')).toBeNull();
    vi.advanceTimersByTime(cache.LIVE_TTL_MS + 1);
    expect(cache.peek('k')).toBeNull();
  });

  test('the least recently used pages leave first and requests in flight stay', () => {
    for (let i = 0; i < cache.MAX_ENTRIES; i++) cache.seed('k' + i, { id: 'r', data: page(), snapshotId: 's' });
    cache.touch('k0');
    cache.load('running', { id: 'r', fetch: never });
    cache.seed('extra', { id: 'r', data: page(), snapshotId: 's' });
    expect(cache.peek('k0', 's')).not.toBeNull();
    expect(cache.peek('k1', 's')).toBeNull();
    expect(cache.peek('k2', 's')).toBeNull();
    expect(cache.peek('k3', 's')).not.toBeNull();
    expect(cache.peek('extra', 's')).not.toBeNull();
    expect(cache.size()).toBe(cache.MAX_ENTRIES);
  });

  test('a large set of pages is trimmed by size', () => {
    const wide = () => page(1, [{ _id: 1, text: 'x'.repeat(1024 * 1024) }]);
    for (let i = 0; i < 7; i++) cache.seed('k' + i, { id: 'r', data: wide(), snapshotId: 's' });
    expect(cache.peek('k0', 's')).toBeNull();
    expect(cache.peek('k6', 's')).not.toBeNull();
    expect(cache.size()).toBeLessThan(7);
  });
});

describe('loading', () => {
  test('one request serves every reader of a key and the page is then stored', async () => {
    const fetch = vi.fn(() => Promise.resolve({ data: page(), snapshotId: 's1' }));
    const first = cache.load('k', { id: 'r', snapshotId: 's1', fetch });
    const second = cache.load('k', { id: 'r', snapshotId: 's1', fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.promise).toBe(second.promise);
    expect(first.pin).toBe('s1');
    expect(await first.promise).toEqual({ data: page(), snapshotId: 's1' });
    expect(cache.peek('k', 's1')).toEqual(page());
    expect(cache.peekSource('k', 's1')).toBe('network');
    const third = cache.load('k', { id: 'r', snapshotId: 's1', fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await third.promise).toEqual({ data: page(), snapshotId: 's1' });
  });

  test('a request is aborted only after every reader released it, one microtask later', async () => {
    const signals = [];
    const fetch = vi.fn(signal => { signals.push(signal); return never(); });
    const first = cache.load('k', { id: 'r', fetch });
    const second = cache.load('k', { id: 'r', fetch });
    first.release();
    await flush();
    expect(signals[0].aborted).toBe(false);
    second.release();
    const third = cache.load('k', { id: 'r', fetch });
    await flush();
    expect(signals[0].aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    third.release();
    await flush();
    expect(signals[0].aborted).toBe(true);
    expect(cache.size()).toBe(0);
  });

  test('a failed request is never stored and a page from another snapshot is replaced', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('boom')));
    await expect(cache.load('k', { id: 'r', fetch: failing }).promise).rejects.toThrow('boom');
    expect(cache.size()).toBe(0);
    cache.seed('k', { id: 'r', data: page(1), snapshotId: 's1' });
    const fetch = vi.fn(() => Promise.resolve({ data: page(2), snapshotId: 's2' }));
    const handle = cache.load('k', { id: 'r', snapshotId: 's2', fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    await handle.promise;
    expect(cache.peek('k', 's2').total).toBe(2);
    expect(cache.peek('k', 's1')).toBeNull();
  });

  test('invalidating a resource aborts its requests and drops only its pages', () => {
    const signals = [];
    const fetch = vi.fn(signal => { signals.push(signal); return never(); });
    cache.load('a', { id: 'r', fetch });
    cache.seed('b', { id: 'r', data: page(), snapshotId: 's' });
    cache.seed('c', { id: 'other', data: page(), snapshotId: 's' });
    cache.invalidate('r');
    expect(signals[0].aborted).toBe(true);
    expect(cache.peek('b', 's')).toBeNull();
    expect(cache.peek('c', 's')).not.toBeNull();
    expect(cache.size()).toBe(1);
  });
});

describe('prefetching', () => {
  test('never repeats a stored or running page and a failure pauses it', async () => {
    cache.seed('k', { id: 'r', data: page(), snapshotId: 's' });
    const fetch = vi.fn(() => Promise.resolve({ data: page(), snapshotId: 's' }));
    cache.prefetch('k', { id: 'r', snapshotId: 's', fetch });
    expect(fetch).not.toHaveBeenCalled();
    const slow = vi.fn(never);
    cache.prefetch('n', { id: 'r', fetch: slow });
    cache.prefetch('n', { id: 'r', fetch: slow });
    expect(slow).toHaveBeenCalledTimes(1);
    expect(cache.prefetchPaused()).toBe(false);
    const failing = vi.fn(() => Promise.reject(new Error('down')));
    cache.prefetch('f', { id: 'r', fetch: failing });
    await flush();
    expect(cache.prefetchPaused()).toBe(true);
    cache.prefetch('g', { id: 'r', fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a rate limit pauses prefetching for the announced delay', async () => {
    vi.useFakeTimers();
    const limited = vi.fn(() => Promise.reject(Object.assign(new Error('rate'), { retryAfter: 30 })));
    cache.prefetch('k', { id: 'r', fetch: limited });
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.prefetchPaused()).toBe(true);
    const fetch = vi.fn(() => Promise.resolve({ data: page(), snapshotId: 's' }));
    cache.prefetch('other', { id: 'r', fetch });
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30 * 1000 + 1);
    expect(cache.prefetchPaused()).toBe(false);
    cache.prefetch('other', { id: 'r', fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('an abandoned prefetch is aborted unless a reader joined it', async () => {
    const signals = [];
    const fetch = vi.fn(signal => { signals.push(signal); return never(); });
    const release = cache.prefetch('k', { id: 'r', fetch });
    const reader = cache.load('k', { id: 'r', fetch });
    release();
    await flush();
    expect(signals[0].aborted).toBe(false);
    reader.release();
    await flush();
    expect(signals[0].aborted).toBe(true);
    const abandoned = cache.prefetch('n', { id: 'r', fetch });
    abandoned();
    await flush();
    expect(signals[1].aborted).toBe(true);
    expect(cache.prefetchPaused()).toBe(false);
  });
});
