import { afterEach, expect, test, vi } from 'vitest';
import { hasAccountSession } from './account.js';

afterEach(() => vi.unstubAllGlobals());

test.each([null, { session: { id: 'session', token: 'fixture-only' }, user: { id: 'user', email: 'fixture@example.test' } }])('session lookup returns only presence from the uncached auth endpoint', async data => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await hasAccountSession({ signal: controller.signal })).toBe(data !== null);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/get-session', {
    credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' },
  });
});

test.each([{}, { session: {}, user: {} }, { data: null }, { session: { id: 's' } }, { session: { id: '' }, user: { id: 'u' } }])('malformed responses do not declare a visitor signed out', async data => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  await expect(hasAccountSession()).rejects.toThrow('Invalid session response');
});

test.each([401, 429, 503])('HTTP %s remains a lookup error rather than anonymous state', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
  await expect(hasAccountSession()).rejects.toThrow('Session lookup failed');
});
