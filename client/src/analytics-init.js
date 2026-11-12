import { analyticsOptedOut } from './utils/analytics.js';
import { startPerformanceCollection } from './utils/performance.js';
import { hostedPart } from './extensions.js';
import { isQuietPath, markRecorderLoaded } from './utils/quietPages.js';
export { analyticsOptedOut } from './utils/analytics.js';

// Pages that never load analytics, such as the hosted service's account pages.
const PRIVATE_PATHS = hostedPart(import.meta.glob('./enterprise/privatePaths.js', { eager: true }), null);

const WEBSITE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function startAnalytics(doc = globalThis.document, nav = globalThis.navigator, win = globalThis.window) {
  if (!doc || !win || analyticsOptedOut(nav, win)) return false;
  if (PRIVATE_PATHS?.test(win.location?.pathname || '')) return false;
  const websiteId = doc.querySelector('meta[name="canquery-analytics-site"]')?.content;
  if (!WEBSITE_ID_RE.test(websiteId || '')) return false;

  const tracker = doc.createElement('script');
  tracker.async = true;
  tracker.src = '/metrics.js';
  tracker.setAttribute('data-website-id', websiteId);
  tracker.setAttribute('data-performance', 'false');
  tracker.setAttribute('data-do-not-track', 'true');
  // The heatmap recorder stays out of a document that opens on a page where a click or the
  // scroll position would say something about the visitor (utils/quietPages.js).
  if (!isQuietPath(win.location?.pathname || '')) {
    tracker.addEventListener('load', () => {
      const recorder = doc.createElement('script');
      recorder.async = true;
      recorder.src = '/heatmaps.js';
      recorder.setAttribute('data-website-id', websiteId);
      doc.head.append(recorder);
      markRecorderLoaded(win);
    }, { once: true });
  }
  doc.head.append(tracker);
  void startPerformanceCollection({ websiteId, doc, nav, win });
  return true;
}

startAnalytics();
