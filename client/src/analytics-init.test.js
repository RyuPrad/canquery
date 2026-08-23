import { afterEach, describe, expect, test, vi } from 'vitest';
import { analyticsOptedOut, startAnalytics } from './analytics-init.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

function configuredDocument() {
  document.head.innerHTML = `<meta name="canquery-analytics-site" content="${ID}">`;
  return document;
}

afterEach(() => {
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('analytics bootstrap privacy signals', () => {
  test.each([
    [{ doNotTrack: '1' }, {}],
    [{ globalPrivacyControl: true }, {}],
    [{}, { doNotTrack: 'yes' }],
  ])('does not start when a browser opt-out is active', (nav, win) => {
    const doc = configuredDocument();
    expect(analyticsOptedOut(nav, win)).toBe(true);
    expect(startAnalytics(doc, nav, win)).toBe(false);
    expect(doc.querySelector('script[src="/metrics.js"]')).toBeNull();
  });

  test('loads the same-origin tracker, then the heatmap recorder', () => {
    const doc = configuredDocument();
    expect(startAnalytics(doc, {}, {})).toBe(true);
    const tracker = doc.querySelector('script[src="/metrics.js"]');
    expect(tracker.dataset.websiteId).toBe(ID);
    expect(tracker.dataset.performance).toBe('true');
    expect(doc.querySelector('script[src="/heatmaps.js"]')).toBeNull();
    tracker.dispatchEvent(new Event('load'));
    const recorder = doc.querySelector('script[src="/heatmaps.js"]');
    expect(recorder).not.toBeNull();
    expect(recorder.dataset.websiteId).toBe(ID);
  });

  test('does nothing without a valid server-injected website id', () => {
    document.head.innerHTML = '<meta name="canquery-analytics-site" content="not-an-id">';
    expect(startAnalytics(document, {}, {})).toBe(false);
  });
});
