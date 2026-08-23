import { afterEach, describe, expect, test, vi } from 'vitest';
import { sanitizeAnalyticsProperties, track } from './analytics.js';

afterEach(() => {
  delete window.umami;
});

describe('analytics event wrapper', () => {
  test('is a harmless no-op before or without the tracker', () => {
    expect(track('catalog_search', { query: 'water' })).toBe(false);
    expect(track('not_allowed', { query: 'water' })).toBe(false);
  });

  test('sends allowlisted, bounded scalar properties', () => {
    window.umami = { track: vi.fn() };
    expect(track('catalog_search', {
      query: 'x'.repeat(700),
      count: 12,
      active: true,
      'bad key': 'drop',
      nested: { private: true },
    })).toBe(true);
    expect(window.umami.track).toHaveBeenCalledWith('catalog_search', {
      query: 'x'.repeat(500),
      count: 12,
      active: true,
    });
  });

  test('swallows tracker failures', () => {
    window.umami = { track: vi.fn(() => { throw new Error('offline'); }) };
    expect(track('resource_open', { resource_id: 'r1' })).toBe(false);
  });

  test('drops non-finite numbers', () => {
    expect(sanitizeAnalyticsProperties({ ok: 2, nope: Infinity })).toEqual({ ok: 2 });
  });
});
