import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DIRECTORY, envelope } from '../test/portalDirectory.js';

vi.mock('../api/portals.js', async (original) => ({ ...(await original()), fetchPortalDirectory: vi.fn() }));
import { fetchPortalDirectory, portalDirectoryResponse } from '../api/portals.js';
import { loadPortalDirectory, peekPortalDirectory, resetPortalData, takePortalInitialData } from './portalData.js';

const location = { pathname: '/portals', search: '' };
function embed(payload) {
  const element = document.createElement('script');
  element.type = 'application/json';
  element.id = 'cq-initial';
  element.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload);
  document.body.append(element);
}
const block = (changes = {}) => ({ version: 1, kind: 'portals', path: '/portals', directory: envelope(), ...changes });

beforeEach(() => {
  vi.clearAllMocks();
  resetPortalData();
  fetchPortalDirectory.mockResolvedValue(envelope());
});
afterEach(() => {
  document.getElementById('cq-initial')?.remove();
  vi.useRealTimers();
});

describe('the directory a direct visit carries', () => {
  test('is kept when it answers exactly this address, and then nothing is fetched', async () => {
    embed(block());
    expect(takePortalInitialData({ location })).toBe(true);
    expect(peekPortalDirectory()).toEqual(DIRECTORY);
    expect(await loadPortalDirectory()).toEqual(DIRECTORY);
    expect(fetchPortalDirectory).not.toHaveBeenCalled();
  });

  test('answers the address with its query string, as the server wrote it', () => {
    embed(block({ path: '/portals?province=ontario' }));
    expect(takePortalInitialData({ location })).toBe(false);
    expect(takePortalInitialData({ location: { pathname: '/portals', search: '?province=ontario' } })).toBe(true);
  });

  test.each([
    ['there is none', null],
    ['it is not JSON', '{not json'],
    ['it is another page’s', block({ kind: 'oas' })],
    ['it is another version', block({ version: 2 })],
    ['it answers another address', block({ path: '/places' })],
    ['it has no directory', block({ directory: null })],
    ['its directory has no portal', block({ directory: envelope({ ...DIRECTORY, portals: [] }) })],
    ['a portal in it is not one', block({ directory: envelope({ ...DIRECTORY, portals: [{ ...DIRECTORY.portals[0], datasets: '48310' }] }) })],
    ['a group in it is not one', block({ directory: envelope({ ...DIRECTORY, levels: [{ id: 'federal' }] }) })],
    ['it is a list', [block()]]
  ])('is refused when %s', (_name, payload) => {
    if (payload !== null) embed(payload);
    expect(takePortalInitialData({ location })).toBe(false);
    expect(peekPortalDirectory(Date.now(), { stale: true })).toBeNull();
  });
});

describe('the directory kept for the visit', () => {
  test('is fetched once, however many ask while the request is out', async () => {
    let release;
    fetchPortalDirectory.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = loadPortalDirectory();
    const second = loadPortalDirectory();
    release(envelope());
    expect(await first).toEqual(DIRECTORY);
    expect(await second).toEqual(DIRECTORY);
    expect(fetchPortalDirectory).toHaveBeenCalledTimes(1);
    await loadPortalDirectory();
    expect(fetchPortalDirectory).toHaveBeenCalledTimes(1);
  });

  test('is shown for the whole visit and read again after five minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    await loadPortalDirectory();
    vi.setSystemTime(new Date('2026-11-15T12:04:59Z'));
    expect(peekPortalDirectory()).toEqual(DIRECTORY);
    vi.setSystemTime(new Date('2026-11-15T12:05:01Z'));
    expect(peekPortalDirectory()).toBeNull();
    expect(peekPortalDirectory(Date.now(), { stale: true })).toEqual(DIRECTORY);
    const newer = { ...DIRECTORY, updated_at: '2026-11-15T12:05:00.000Z' };
    fetchPortalDirectory.mockResolvedValue(envelope(newer));
    expect(await loadPortalDirectory()).toEqual(newer);
    expect(fetchPortalDirectory).toHaveBeenCalledTimes(2);
  });

  test('a failed read leaves what was here and can be tried again', async () => {
    await loadPortalDirectory();
    resetPortalData();
    fetchPortalDirectory.mockRejectedValueOnce(new Error('offline'));
    await expect(loadPortalDirectory()).rejects.toThrow('offline');
    expect(peekPortalDirectory(Date.now(), { stale: true })).toBeNull();
    fetchPortalDirectory.mockResolvedValue(envelope());
    expect(await loadPortalDirectory()).toEqual(DIRECTORY);
  });
});

describe('what counts as a directory', () => {
  test('every portal, count and group the page draws must be there', () => {
    expect(portalDirectoryResponse(envelope())).toBe(true);
    const without = (key) => { const copy = { ...DIRECTORY }; delete copy[key]; return envelope(copy); };
    for (const key of ['portals', 'totals', 'platforms', 'levels', 'provinces']) expect([key, portalDirectoryResponse(without(key))]).toEqual([key, false]);
    const withPortal = (changes) => envelope({ ...DIRECTORY, portals: [{ ...DIRECTORY.portals[1], ...changes }] });
    expect(portalDirectoryResponse(withPortal({}))).toBe(true);
    for (const changes of [{ id: 7 }, { name: 'Toronto' }, { name: { en: 'Toronto' } }, { datasets: -1 }, { tables: 1.5 }, { maps: null },
      { homepage_url: 7 }, { place: 'toronto-on' }, { place: { slug: 'toronto-on' } }, { province: { name: { en: 'Ontario', fr: 'Ontario' } } },
      { licence: 'OGL' }, { licence: { title: 'OGL', url: null } }, { licence: { title: { en: 'a', fr: 'a' }, url: 7 } }, { last_synced_at: 7 },
      { level: 7 }, { platform: null }]) {
      expect([JSON.stringify(changes), portalDirectoryResponse(withPortal(changes))]).toEqual([JSON.stringify(changes), false]);
    }
    // What the server sends for a portal with nothing optional.
    expect(portalDirectoryResponse(withPortal({ homepage_url: null, level: null, place: null, province: null, licence: null, last_synced_at: null }))).toBe(true);
    expect(portalDirectoryResponse(envelope({ ...DIRECTORY, updated_at: null }))).toBe(true);
    expect(portalDirectoryResponse(envelope({ ...DIRECTORY, updated_at: 7 }))).toBe(false);
    expect(portalDirectoryResponse(envelope({ ...DIRECTORY, provinces: [{ id: 'ontario', portals: 2, datasets: 964 }] }))).toBe(false);
    expect(portalDirectoryResponse({ data: null })).toBe(false);
    expect(portalDirectoryResponse({ data: [] })).toBe(false);
  });
});
