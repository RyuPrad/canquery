import { afterEach, expect, test, vi } from 'vitest';
import { clearRecentlyViewed, readRecentlyViewed, rememberView, subscribeRecentlyViewed } from './recentlyViewed.js';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const dataset = (n, extra = {}) => ({ kind: 'dataset', id: 'd' + n, title: { en: 'Dataset ' + n, fr: 'Jeu ' + n }, path: '/datasets/d' + n, ...extra });

test('keeps the twelve latest views, newest first, once each', () => {
  for (let n = 1; n <= 14; n += 1) rememberView(dataset(n), 1000 + n);
  rememberView(dataset(5), 5000);
  const list = readRecentlyViewed();
  expect(list).toHaveLength(12);
  expect(list.map(item => item.id).slice(0, 3)).toEqual(['d5', 'd14', 'd13']);
  expect(list[0]).toEqual({ ...dataset(5), at: 5000 });
  expect(list.filter(item => item.id === 'd5')).toHaveLength(1);
});

test('a dataset and a file with one id are two views', () => {
  rememberView(dataset(1), 1);
  rememberView({ kind: 'resource', id: 'd1', title: { en: 'File', fr: '' }, path: '/resources/d1' }, 2);
  expect(readRecentlyViewed().map(item => item.kind)).toEqual(['resource', 'dataset']);
});

test('only dataset and file pages are remembered, with a title', () => {
  for (const bad of [dataset(1, { kind: 'place' }), dataset(1, { path: 'https://example.test/x' }), dataset(1, { path: '/datasets/a/b' }),
    dataset(1, { path: 'javascript:alert(1)' }), dataset(1, { path: '/resources/d1' }), dataset(1, { title: { en: ' ', fr: '' } }),
    dataset(1, { id: '' }), dataset(1, { id: 'x'.repeat(201) })]) {
    rememberView(bad);
  }
  expect(readRecentlyViewed()).toEqual([]);
  rememberView(dataset(1, { title: { en: '  Spaced\n  title ', fr: 7 } }), 3);
  expect(readRecentlyViewed()[0].title).toEqual({ en: 'Spaced title', fr: '' });
});

test('a damaged or hostile stored list reads as what is valid in it', () => {
  localStorage.setItem('cq-recent', '{not json');
  expect(readRecentlyViewed()).toEqual([]);
  localStorage.setItem('cq-recent', JSON.stringify({ kind: 'dataset' }));
  expect(readRecentlyViewed()).toEqual([]);
  localStorage.setItem('cq-recent', JSON.stringify([dataset(1, { at: 'soon' }), dataset(2, { path: 'https://evil.test' }), null, 7]));
  expect(readRecentlyViewed()).toEqual([{ ...dataset(1), at: 0 }]);
});

test('clearing empties the list and tells the rail', () => {
  const onChange = vi.fn();
  const stop = subscribeRecentlyViewed(onChange);
  rememberView(dataset(1));
  clearRecentlyViewed();
  expect(localStorage.getItem('cq-recent')).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new StorageEvent('storage', { key: 'cq-recent' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'cq-lang' }));
  expect(onChange).toHaveBeenCalledTimes(3);
  stop();
  rememberView(dataset(2));
  expect(onChange).toHaveBeenCalledTimes(3);
});

test('without storage nothing is remembered and nothing breaks', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => rememberView(dataset(1))).not.toThrow();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  expect(readRecentlyViewed()).toEqual([]);
});
