import { describe, expect, test } from 'vitest';
import { isChart, isChartsData, isCustomChartData, customSpec } from './chartContract.js';
import { ANALYSIS, SHARE, LINE, BLOCKED } from '../test/chartAnalysis.js';

describe('the chart engine\'s answers', () => {
  test('a well-formed answer passes, also one with no charts', () => {
    expect(isChartsData(ANALYSIS)).toBe(true);
    expect(isChartsData(BLOCKED)).toBe(true);
    expect(isChart(SHARE)).toBe(true);
    expect(isChart(LINE)).toBe(true);
  });

  test('fields a page does not know are ignored; missing or broken ones are not', () => {
    expect(isChartsData({ ...ANALYSIS, something_new: [1, 2] })).toBe(true);
    expect(isChart({ ...SHARE, extra: true, notes: [...SHARE.notes, { code: 'future', level: 'info' }] })).toBe(true);
    for (const broken of [
      { ...SHARE, kind: 'pie' },
      { ...SHARE, points: [] },
      { ...SHARE, points: [{ label: 'A', value: '12' }] },
      { ...SHARE, points: [{ value: 3 }] },
      { ...SHARE, points: [{ label: 'A', value: Infinity }] },
      { ...SHARE, y: { agg: 'median' } },
      { ...SHARE, x: { type: 'map' } },
      { ...SHARE, notes: [{ level: 'info' }] },
      { ...SHARE, scope: null },
    ]) expect(isChart(broken)).toBe(false);
    expect(isChartsData({ ...ANALYSIS, status: 'maybe' })).toBe(false);
    expect(isChartsData({ ...ANALYSIS, charts: [{ ...SHARE, kind: 'pie' }] })).toBe(false);
    expect(isChartsData({ ...ANALYSIS, model: null })).toBe(false);
    expect(isChartsData(null)).toBe(false);
  });

  test('a custom chart is a chart, or none with its reason', () => {
    expect(isCustomChartData({ chart: SHARE, reason: null })).toBe(true);
    expect(isCustomChartData({ chart: null, reason: 'flat' })).toBe(true);
    expect(isCustomChartData({ chart: null, reason: 7 })).toBe(false);
    expect(isCustomChartData({ chart: { ...SHARE, points: [] }, reason: null })).toBe(false);
  });

  test('the builder\'s choices become the engine\'s request vocabulary', () => {
    expect(customSpec({ x: 'Province', kind: 'donut', agg: 'count' })).toEqual({ kind: 'donut', x: { column: 'Province' }, y: { agg: 'count' } });
    expect(customSpec({ time: 't:EN_YEAR+EN_MONTH', grain: 'year', agg: 'sum', column: 'TOTAL' }))
      .toEqual({ x: { time: 't:EN_YEAR+EN_MONTH', grain: 'year' }, y: { agg: 'sum', column: 'TOTAL' } });
    expect(customSpec({ wide: 'w0', agg: 'avg', column: 'ignored' })).toEqual({ x: { wide: 'w0' }, y: { agg: 'avg' } });
    expect(customSpec({ x: 'Province', agg: 'max', column: 'Rate', limit: 20 })).toEqual({ x: { column: 'Province' }, y: { agg: 'max', column: 'Rate' }, limit: 20 });
  });
});
