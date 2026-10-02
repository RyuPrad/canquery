import { afterEach, describe, expect, test, vi } from 'vitest';
import { PERFORMANCE_METHOD, startPerformanceCollection } from './performance.js';

const WEBSITE = '123e4567-e89b-42d3-a456-426614174000';
const INITIAL = '133e4567-e89b-42d3-a456-426614174000';
const RESTORED = '143e4567-e89b-42d3-a456-426614174000';

function fixture() {
  const reports = {};
  const listeners = {};
  const doc = { title: 'Original dataset', visibilityState: 'visible' };
  const nav = { language: 'en-CA' };
  const win = {
    location: new URL('https://canquery.com/datasets/original?q=private#secret'),
    crypto: { randomUUID: vi.fn().mockReturnValueOnce(INITIAL).mockReturnValue(RESTORED) },
    fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cache: 'test-cache' }) }),
    performance: {
      timeOrigin: 1801458000000,
      getEntriesByType: () => [{ name: 'https://canquery.com/datasets/original?q=private' }],
    },
    screen: { width: 1280, height: 720 },
    localStorage: { getItem: () => null },
    setTimeout,
    addEventListener: vi.fn((type, listener) => { listeners[type] = listener; }),
  };
  const vitals = Object.fromEntries(['CLS', 'FCP', 'INP', 'LCP', 'TTFB'].map(name => [
    `on${name}`, vi.fn(fn => { reports[name] = fn; }),
  ]));
  const loadVitals = vi.fn().mockResolvedValue(vitals);
  const start = () => startPerformanceCollection({ websiteId: WEBSITE, doc, nav, win, loadVitals });
  const report = (name, value, extra = {}) => reports[name]({ name, value, navigationType: 'navigate', ...extra });
  const payloads = () => win.fetch.mock.calls.map(([, options]) => JSON.parse(options.body).payload);
  return { doc, nav, win, vitals, loadVitals, listeners, start, report, payloads };
}

afterEach(() => vi.useRealTimers());

describe('document performance collector', () => {
  test('registers standard callbacks once, accepts zero CLS and leaves missing INP absent', async () => {
    const f = fixture();
    expect(await f.start()).toBe(true);
    expect(await f.start()).toBe(false);
    for (const register of Object.values(f.vitals)) expect(register).toHaveBeenCalledWith(expect.any(Function));
    f.report('CLS', 0);
    expect(f.payloads()[0]).toMatchObject({
      cls: 0, url: 'https://canquery.com/datasets/original', title: 'Original dataset',
      performance: { id: INITIAL, method: PERFORMANCE_METHOD, revision: 1 },
    });
    expect(f.payloads()[0]).not.toHaveProperty('inp');
    expect(f.win.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });
  });

  test('sends complete snapshots with increasing revisions, including a decreasing valid INP', async () => {
    const f = fixture();
    await f.start();
    f.report('FCP', 450);
    f.report('LCP', 1200);
    f.report('INP', 320);
    f.report('INP', 180);
    expect(f.payloads().map(p => p.performance.revision)).toEqual([1, 2, 3, 4]);
    expect(f.payloads()[3]).toMatchObject({ fcp: 450, lcp: 1200, inp: 180 });
    f.report('INP', 180);
    expect(f.win.fetch).toHaveBeenCalledTimes(4);
  });

  test('preserves original URL and title across SPA navigation and reports late interactions', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.start();
    f.report('LCP', 900);
    f.win.location = new URL('https://canquery.com/resources/new?query=secret');
    f.doc.title = 'New route title';
    await vi.advanceTimersByTimeAsync(60000);
    f.report('INP', 220);
    expect(f.payloads()[1]).toMatchObject({
      url: 'https://canquery.com/datasets/original', title: 'Original dataset',
      performance: { id: INITIAL, revision: 2 }, inp: 220,
    });
    f.doc.visibilityState = 'hidden';
    f.report('CLS', 0.12);
    f.doc.visibilityState = 'visible';
    f.report('CLS', 0.18);
    expect(f.payloads().at(-1).cls).toBe(0.18);
  });

  test('BFCache restore creates a fresh row identity and excludes delayed prior metrics', async () => {
    const f = fixture();
    await f.start();
    f.report('LCP', 900);
    f.win.location = new URL('https://canquery.com/resources/restored?secret=1');
    f.listeners.pageshow({ persisted: true, timeStamp: 50000 });
    f.report('CLS', 0.4); // Obsolete original-document callback.
    f.report('CLS', 0, { navigationType: 'back-forward-cache', navigationStartTime: 50000 });
    expect(f.payloads()).toHaveLength(2);
    expect(f.payloads()[1]).toMatchObject({
      cls: 0, url: 'https://canquery.com/resources/restored',
      performance: { id: RESTORED, revision: 1, navigationType: 'back-forward-cache' },
    });
    expect(f.payloads()[1]).not.toHaveProperty('lcp');
    expect(f.payloads()[1].timestamp - f.payloads()[0].timestamp).toBe(50);
  });

  test.each(['doNotTrack', 'globalPrivacyControl'])('honors %s before import and every send', async key => {
    const f = fixture();
    f.nav[key] = true;
    expect(await f.start()).toBe(false);
    expect(f.loadVitals).not.toHaveBeenCalled();
    f.nav[key] = false;
    await f.start();
    f.nav[key] = true;
    f.report('CLS', 0);
    expect(f.win.fetch).not.toHaveBeenCalled();
  });

  test('honors Umami local opt-out but survives inaccessible storage', async () => {
    const f = fixture();
    f.win.localStorage.getItem = () => '1';
    expect(await f.start()).toBe(false);
    f.win.localStorage.getItem = () => { throw new Error('Unavailable'); };
    expect(await f.start()).toBe(true);
    f.report('CLS', 0);
    expect(f.win.fetch).toHaveBeenCalledOnce();
  });

  test('retries a network error once with the same snapshot and obeys later opt-out', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.win.fetch.mockRejectedValue(new Error('offline'));
    await f.start();
    f.report('LCP', 900);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.win.fetch).toHaveBeenCalledTimes(2);
    expect(f.win.fetch.mock.calls[0][1].body).toBe(f.win.fetch.mock.calls[1][1].body);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.win.fetch).toHaveBeenCalledTimes(2);
    f.report('INP', 40);
    f.nav.globalPrivacyControl = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.win.fetch).toHaveBeenCalledTimes(3);
  });

  test('a newer snapshot supersedes a failed older request without retrying it', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.win.fetch.mockRejectedValueOnce(new Error('offline'));
    await f.start();
    f.report('FCP', 400);
    f.report('LCP', 900);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.win.fetch).toHaveBeenCalledTimes(2);
  });

  test('ignores invalid measurements and soft navigation metrics; chunk errors stay isolated', async () => {
    const f = fixture();
    await f.start();
    for (const value of [-1, Infinity, NaN]) f.report('LCP', value);
    f.report('LCP', 800, { navigationType: 'soft-navigation' });
    expect(f.win.fetch).not.toHaveBeenCalled();
    const unavailable = fixture();
    unavailable.loadVitals.mockRejectedValue(new Error('blocked chunk'));
    expect(await unavailable.start()).toBe(false);
  });

  test('does not censor slow measurements at the legacy tracker limits', async () => {
    const f = fixture();
    await f.start();
    f.report('LCP', 90000);
    f.report('CLS', 101);
    expect(f.payloads().at(-1)).toMatchObject({ lcp: 90000, cls: 101 });
  });

  test('stops corrected collection when the server disables it', async () => {
    const f = fixture();
    f.win.fetch.mockResolvedValue({ ok: true, json: async () => ({ disabled: true }) });
    await f.start();
    f.report('FCP', 400);
    await Promise.resolve();
    await Promise.resolve();
    f.report('LCP', 900);
    expect(f.win.fetch).toHaveBeenCalledOnce();
  });
});
