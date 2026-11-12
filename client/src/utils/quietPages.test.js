import { describe, expect, test } from 'vitest';
import { isQuietPath, markRecorderLoaded, recorderLoaded } from './quietPages.js';

describe('pages the heatmap recorder stays out of', () => {
  test('are the OAS amounts hub and its table pages, in both languages', () => {
    for (const pathname of ['/oas', '/oas/', '/oas/table-1', '/oas/table-5', '/fr/sv', '/fr/sv/tableau-2', '/Oas/Table-4']) {
      expect([pathname, isQuietPath(pathname)]).toEqual([pathname, true]);
    }
    for (const pathname of ['/', '/oas/table-6', '/oas/table-1/rows', '/oasis', '/fr', '/fr/sv/table-1', '/lmia', '/blog/guaranteed-income-supplement-amounts', '', undefined]) {
      expect([pathname, isQuietPath(pathname)]).toEqual([pathname, false]);
    }
  });

  test('a document knows whether the recorder was added to it', () => {
    const win = {};
    expect(recorderLoaded(win)).toBe(false);
    markRecorderLoaded(win);
    expect(recorderLoaded(win)).toBe(true);
    expect(recorderLoaded(undefined)).toBe(false);
  });
});
