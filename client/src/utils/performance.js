import { analyticsOptedOut } from './analytics.js';

export const PERFORMANCE_METHOD = 'web-vitals-v1';
const started = new WeakSet();
const METRICS = new Set(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

function optedOut(nav, win) {
  if (analyticsOptedOut(nav, win)) return true;
  try {
    return Boolean(win.localStorage?.getItem('umami.disabled'));
  } catch {
    // Storage access is optional, including in private browsing.
    return false;
  }
}

function documentUrl(value, win) {
  const url = new URL(value || win.location.href, win.location.href);
  if (url.origin !== win.location.origin) return `${win.location.origin}/`;
  // Performance collection never needs searches, fragments or element text.
  return `${url.origin}${url.pathname}`;
}

/** One immutable document identity, with idempotent updates as metrics finalize. */
export async function startPerformanceCollection({
  websiteId,
  doc = globalThis.document,
  nav = globalThis.navigator,
  win = globalThis.window,
  loadVitals = () => import('web-vitals'),
} = {}) {
  if (!doc || !win || started.has(win) || optedOut(nav, win)
    || !win.addEventListener || !win.crypto?.randomUUID || !win.fetch) return false;
  started.add(win);

  const entry = win.performance?.getEntriesByType?.('navigation')?.[0];
  const timeOrigin = win.performance?.timeOrigin || Date.now();
  const makeNavigation = (url, startTime = 0, restored = false) => ({
    id: win.crypto.randomUUID(),
    revision: 0,
    url: documentUrl(url, win),
    title: String(doc.title || '').slice(0, 500),
    timestamp: Math.floor((timeOrigin + startTime) / 1000),
    startTime,
    restored,
    metrics: {},
  });
  let current = makeNavigation(entry?.name, entry?.activationStart || 0);
  let cache;
  let disabled = false;

  // Register before the library so a restore's callbacks use its new identity.
  win.addEventListener('pageshow', event => {
    if (event.persisted) current = makeNavigation(win.location.href, event.timeStamp, true);
  }, true);

  const send = async (navigation, body, revision, retry = false) => {
    if (disabled || optedOut(nav, win)) return;
    try {
      let trackerCache;
      try { trackerCache = win.umami?.getSession?.()?.cache; } catch { /* optional */ }
      const response = await win.fetch('/api/send', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'x-umami-website-id': websiteId,
          'x-umami-hostname': win.location.hostname,
          ...((cache || trackerCache) && { 'x-umami-cache': cache || trackerCache }),
        },
        body,
      });
      if (!response.ok) return; // Never retry validation or server/rate-limit responses.
      const result = await response.json();
      if (result?.cache) cache = result.cache;
      if (result?.disabled) disabled = true;
    } catch {
      // One bounded network retry, with exactly the same id/revision/snapshot.
      // A newer complete snapshot supersedes an older failed request.
      if (!retry && doc.visibilityState === 'visible') {
        win.setTimeout(() => {
          if (doc.visibilityState === 'visible' && navigation.revision === revision) {
            void send(navigation, body, revision, true);
          }
        }, 1000);
      }
    }
  };

  const report = metric => {
    if (disabled || optedOut(nav, win) || !METRICS.has(metric.name)
      || !Number.isFinite(metric.value) || metric.value < 0
      || metric.navigationType === 'soft-navigation') return;
    if (current.restored && (metric.navigationType !== 'back-forward-cache'
      || metric.navigationStartTime !== current.startTime)) return;
    const key = metric.name.toLowerCase();
    if (current.metrics[key] === metric.value) return;
    current.metrics[key] = metric.value;
    current.revision += 1;
    const payload = {
      website: websiteId,
      hostname: win.location.hostname,
      url: current.url,
      title: current.title,
      timestamp: current.timestamp,
      language: String(nav?.language || '').slice(0, 35),
      screen: `${win.screen?.width || 0}x${win.screen?.height || 0}`,
      ...current.metrics,
      performance: {
        id: current.id,
        revision: current.revision,
        method: PERFORMANCE_METHOD,
        navigationType: metric.navigationType || 'navigate',
      },
    };
    void send(current, JSON.stringify({ type: 'performance-v2', payload }), current.revision);
  };

  try {
    const vitals = await loadVitals();
    if (optedOut(nav, win)) return false;
    // Defaults deliberately retain document-level metrics and final callbacks.
    // The library handles zero CLS, short interactions, hidden/resume and BFCache.
    for (const name of METRICS) vitals[`on${name}`](report);
    return true;
  } catch {
    return false; // Collection and blocked chunks must never affect navigation.
  }
}
