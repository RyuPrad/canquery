import { describe, expect, test } from 'vitest';
import { adsLoaded, carriesTrackers, isQuietPath, markRecorderLoaded, recorderLoaded, siteHasTrackers } from './quietPages.js';

describe('pages the heatmap recorder stays out of', () => {
  test('are the OAS amounts hub and its table pages, in both languages', () => {
    for (const pathname of ['/oas', '/oas/', '/oas/table-1', '/oas/table-5', '/fr/sv', '/fr/sv/tableau-2', '/Oas/Table-4']) {
      expect([pathname, isQuietPath(pathname)]).toEqual([pathname, true]);
    }
    for (const pathname of ['/', '/oas/table-6', '/oas/table-1/rows', '/oasis', '/fr', '/fr/sv/table-1', '/lmia', '/blog/guaranteed-income-supplement-amounts', '', undefined]) {
      expect([pathname, isQuietPath(pathname)]).toEqual([pathname, false]);
    }
  });

  test('a document knows whether it has the ad loader, and whether the site has ads or analytics at all', () => {
    const page = (head) => new DOMParser().parseFromString('<!doctype html><html><head>' + head + '</head><body></body></html>', 'text/html');
    const loader = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>';
    const account = '<meta name="google-adsense-account" content="ca-pub-1234567890123456">';
    const analytics = '<meta name="canquery-analytics-site" content="01a02c60-cd0a-77f4-8680-7e9e317534a1">';
    expect(adsLoaded(page(account + loader))).toBe(true);
    // The account meta alone loads nothing: a quiet page's HTML has it and no loader.
    expect(adsLoaded(page(account))).toBe(false);
    expect(adsLoaded(page('<script src="/assets/index-a.js"></script>'))).toBe(false);
    expect(carriesTrackers({}, page(account + loader))).toBe(true);
    expect(carriesTrackers({ __cqHeatmaps: true }, page(account))).toBe(true);
    expect(carriesTrackers({}, page(account + analytics))).toBe(false);
    expect(siteHasTrackers(page(account))).toBe(true);
    expect(siteHasTrackers(page(analytics))).toBe(true);
    expect(siteHasTrackers(page('<title>x</title>'))).toBe(false);
  });

  test('a document knows whether the recorder was added to it', () => {
    const win = {};
    expect(recorderLoaded(win)).toBe(false);
    markRecorderLoaded(win);
    expect(recorderLoaded(win)).toBe(true);
    expect(recorderLoaded(undefined)).toBe(false);
  });
});
