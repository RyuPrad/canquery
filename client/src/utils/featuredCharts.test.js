import { describe, expect, test } from 'vitest';
import { featuredPeriodTime, isValidFeaturedChart, selectFeaturedCharts } from './featuredCharts.js';

const categorical = () => ({
  dataset_id: 'dataset', title: { en: 'Publisher dataset title' }, kind: 'donut',
  points: [{ key: 'A', label: 'A', value: 3 }, { key: 'B', label: 'B', value: 1 }],
  context: { resource_id: 'resource', group_by: 'status', agg: 'count', agg_column: null, bucket: null, group_type: 'TEXT',
    snapshot_at: '2026-09-29T23:30:00.000Z', snapshot_rows: 4, total_groups: 2, displayed_groups: 2, limited: false, missing_periods: [] },
});
const timeSeries = () => ({
  ...categorical(), kind: 'line',
  points: [{ key: '2015', label: '2015', value: -2.5 }, { key: '2026', label: '2026', value: 1.75 }],
  context: { ...categorical().context, group_by: 'year', agg: 'avg', agg_column: 'temperature_departure', snapshot_rows: 80 },
});

describe('featured preview admission', () => {
  test('accepts complete counts and genuine signed/zero averages with recorded context', () => {
    expect(isValidFeaturedChart(categorical())).toBe(true);
    const average = timeSeries();
    average.points[1].value = 0;
    expect(isValidFeaturedChart(average)).toBe(true);
    const bars = { ...categorical(), kind: 'bars' };
    bars.context = { ...bars.context, snapshot_rows: 50, total_groups: 12, limited: true };
    expect(isValidFeaturedChart(bars)).toBe(true);
  });

  test('accepts a counted null category only with its honest localized label', () => {
    const item = categorical();
    item.points[0] = { key: null, label: 'Not recorded', value: 3 };
    expect(isValidFeaturedChart(item)).toBe(true);
    item.points[0].label = 'Non renseigné';
    expect(isValidFeaturedChart(item)).toBe(true);
    item.points[0].label = 'Ontario';
    expect(isValidFeaturedChart(item)).toBe(false);
  });

  test('keeps latest-window gaps without converting missing averages into zero', () => {
    const item = timeSeries();
    item.points = [
      { key: '2026-01-01T00:00:00.000Z', label: 'Jan 2026', value: -2 },
      { key: '2026-03-01T00:00:00.000Z', label: 'Mar 2026', value: 3 },
    ];
    item.context = { ...item.context, group_type: 'DATE', bucket: 'month', total_groups: 10, limited: true,
      missing_periods: ['2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'] };
    expect(isValidFeaturedChart(item)).toBe(true);
    item.context.missing_periods.push('2026-03-01T00:00:00.000Z');
    expect(isValidFeaturedChart(item)).toBe(false);
  });

  test.each([
    ['old metadata-free teaser', item => { delete item.context; }],
    ['unknown chart', item => { item.kind = 'area'; }],
    ['missing publisher title', item => { item.title = {}; }],
    ['flat distribution', item => { item.points.forEach(point => { point.value = 2; }); }],
    ['numeric strings', item => { item.points[0].value = '3'; }],
    ['null numeric value', item => { item.points[0].value = null; }],
    ['infinite numeric value', item => { item.points[0].value = Infinity; }],
    ['negative count', item => { item.points[0].value = -3; }],
    ['fractional count', item => { item.points[0].value = 2.5; }],
    ['zero count', item => { item.points[0].value = 0; }],
    ['missing raw key', item => { delete item.points[0].key; }],
    ['duplicate key', item => { item.points[0].key = 'B'; }],
    ['empty label', item => { item.points[0].label = ' '; }],
    ['publisher footnote', item => { item.points[0].label = 'Notes: values may not add up'; }],
    ['overlong label', item => { item.points[0].label = 'x'.repeat(201); }],
    ['missing aggregate column contract', item => { delete item.context.agg_column; }],
    ['incorrect count measure', item => { item.context.agg_column = 'amount'; }],
    ['incorrect group type', item => { item.context.group_type = 4; }],
    ['unknown group type', item => { item.context.group_type = 'ALIEN'; }],
    ['missing snapshot date', item => { item.context.snapshot_at = null; }],
    ['invalid snapshot date', item => { item.context.snapshot_at = '2026-02-29T00:00:00.000Z'; }],
    ['snapshot without timezone', item => { item.context.snapshot_at = '2026-09-29T23:30:00'; }],
    ['unknown row count', item => { item.context.snapshot_rows = null; }],
    ['wrong displayed count', item => { item.context.displayed_groups = 1; }],
    ['wrong limited flag', item => { item.context.limited = true; }],
    ['groups exceed rows', item => { item.context.total_groups = 5; item.context.limited = true; }],
    ['partial donut', item => { item.context.total_groups = 3; item.context.limited = true; }],
    ['count total mismatches snapshot', item => { item.context.snapshot_rows = 5; }],
    ['count total exceeds snapshot', item => { item.context.snapshot_rows = 3; }],
    ['unknown missing scope', item => { delete item.context.missing_periods; }],
  ])('rejects %s rather than inventing usable context', (_label, mutate) => {
    const item = categorical();
    mutate(item);
    expect(isValidFeaturedChart(item)).toBe(false);
  });

  test.each([
    ['missing measure field', item => { item.context.agg_column = null; }],
    ['non-temporal key', item => { item.points[0].key = 'Before'; }],
    ['invalid calendar key', item => { item.points[0].key = '2015-02-30'; }],
    ['reversed temporal order', item => { item.points.reverse(); }],
    ['missing temporal key', item => { item.points[0].key = null; }],
    ['unsupported bucket', item => { item.context.bucket = 'week'; }],
    ['bucket for a raw text field', item => { item.context.bucket = 'year'; }],
    ['invalid gap key', item => { item.context.missing_periods = ['Missing']; item.context.total_groups = 3; item.context.limited = true; }],
    ['repeated gap', item => { item.context.missing_periods = ['2020', '2020']; item.context.total_groups = 4; item.context.limited = true; }],
    ['gap overlaps available point', item => { item.context.missing_periods = ['2015']; item.context.total_groups = 3; item.context.limited = true; }],
  ])('rejects a line with %s', (_label, mutate) => {
    const item = timeSeries();
    mutate(item);
    expect(isValidFeaturedChart(item)).toBe(false);
  });

  test('filters unusable payloads without changing admitted points or source order', () => {
    const items = [categorical(), { ...categorical(), dataset_id: 'old', context: undefined }, timeSeries()];
    const before = JSON.stringify(items);
    expect(selectFeaturedCharts(items)).toEqual([items[0], items[2]]);
    expect(JSON.stringify(items)).toBe(before);
    expect(selectFeaturedCharts(null)).toEqual([]);
    expect(selectFeaturedCharts({ data: items })).toEqual([]);
    expect(isValidFeaturedChart(null)).toBe(false);
  });

  test('parses real years and ISO dates without accepting rolled-over calendar dates', () => {
    expect(featuredPeriodTime('2026')).toBe(Date.UTC(2026, 0, 1));
    expect(featuredPeriodTime('2024-02-29T00:00:00.000Z')).toBe(Date.UTC(2024, 1, 29));
    expect(featuredPeriodTime('2026-02-29')).toBeNull();
    expect(featuredPeriodTime('2026-01-32')).toBeNull();
    expect(featuredPeriodTime('unknown')).toBeNull();
    expect(featuredPeriodTime(2026)).toBeNull();
  });
});
