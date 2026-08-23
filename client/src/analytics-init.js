const WEBSITE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function analyticsOptedOut(nav = globalThis.navigator, win = globalThis.window) {
  const signals = [
    nav?.doNotTrack,
    win?.doNotTrack,
    nav?.globalPrivacyControl,
  ];
  return signals.some((value) => value === true || value === 1 || value === '1' || value === 'yes');
}

export function startAnalytics(doc = globalThis.document, nav = globalThis.navigator, win = globalThis.window) {
  if (!doc || !win || analyticsOptedOut(nav, win)) return false;
  const websiteId = doc.querySelector('meta[name="canquery-analytics-site"]')?.content;
  if (!WEBSITE_ID_RE.test(websiteId || '')) return false;

  const tracker = doc.createElement('script');
  tracker.async = true;
  tracker.src = '/metrics.js';
  tracker.setAttribute('data-website-id', websiteId);
  tracker.setAttribute('data-performance', 'true');
  tracker.setAttribute('data-do-not-track', 'true');
  tracker.addEventListener('load', () => {
    const recorder = doc.createElement('script');
    recorder.async = true;
    recorder.src = '/heatmaps.js';
    recorder.setAttribute('data-website-id', websiteId);
    doc.head.append(recorder);
  }, { once: true });
  doc.head.append(tracker);
  return true;
}

startAnalytics();
