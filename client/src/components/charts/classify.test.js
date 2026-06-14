import { describe, expect, test } from 'vitest';
import { classifyColumns, buildInsights, buildKpis, hasAnyInsight } from './classify.js';

// Mirrors the "Active business corporations" table from the screenshots: a
// unique corporation number + name (identifiers), low-cardinality categoricals,
// and an incorporation date.
const CORPORATIONS = {
  row_count: 643730,
  columns: [
    { id: '_id', type: 'INTEGER', distinct: 643730, nulls: 0 },
    { id: 'corporation_number', type: 'INTEGER', distinct: 643730, nulls: 0, min: 1, max: 999999 },
    { id: 'corporation_name', type: 'TEXT', distinct: 640000, nulls: 0 },
    { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
    { id: 'province', type: 'TEXT', distinct: 13, nulls: 120 },
    { id: 'governing_legislation', type: 'TEXT', distinct: 8, nulls: 0 },
    { id: 'incorporation_date', type: 'DATE', distinct: 20000, nulls: 5, min: '1990-01-01', max: '2026-01-01' },
  ],
};

describe('classifyColumns', () => {
  const c = classifyColumns(CORPORATIONS);

  test('rejects unique identifiers as dimensions', () => {
    const dimIds = c.dimensions.map((d) => d.id);
    expect(dimIds).not.toContain('corporation_number');
    expect(dimIds).not.toContain('corporation_name');
    expect(dimIds).not.toContain('_id');
  });

  test('keeps low-cardinality categoricals as dimensions, best first', () => {
    const dimIds = c.dimensions.map((d) => d.id);
    expect(dimIds).toEqual(expect.arrayContaining(['status', 'province', 'governing_legislation']));
    // status (3 distinct) outranks province (13) for a clean donut.
    expect(c.dimensions[0].id).toBe('status');
  });

  test('detects the date column', () => {
    expect(c.dates.map((d) => d.id)).toEqual(['incorporation_date']);
  });

  test('does not treat the unique corporation_number as a measure', () => {
    expect(c.measures.map((m) => m.id)).not.toContain('corporation_number');
  });
});

describe('buildInsights', () => {
  test('plans a donut for tiny cardinality and a date time-series', () => {
    const c = classifyColumns(CORPORATIONS);
    const insights = buildInsights(c);
    const statusSpec = insights.find((i) => i.column === 'status');
    expect(statusSpec.kind).toBe('donut'); // 3 distinct → donut
    const provinceSpec = insights.find((i) => i.column === 'province');
    expect(provinceSpec.kind).toBe('bar'); // 13 distinct → bar
    const timeSpec = insights.find((i) => i.kind === 'timeseries');
    expect(timeSpec.column).toBe('incorporation_date');
    expect(timeSpec.bucket).toBe('year'); // ~36-year span → yearly buckets
  });

  test('every insight targets a real dimension, never an identifier', () => {
    const insights = buildInsights(classifyColumns(CORPORATIONS));
    for (const i of insights) {
      expect(['corporation_number', 'corporation_name', '_id']).not.toContain(i.column);
    }
  });
});

describe('buildKpis', () => {
  test('leads with total rows and a category count', () => {
    const kpis = buildKpis(classifyColumns(CORPORATIONS));
    expect(kpis[0]).toEqual({ role: 'rows', value: 643730, format: 'int' });
    expect(kpis.some((k) => k.role === 'distinct')).toBe(true);
    expect(kpis.some((k) => k.role === 'span')).toBe(true);
  });
});

// Mirrors a real ingested table: a unique TEXT "Year" axis + continuous numeric
// metrics (seasonal temperature departures). The naive classifier would discard
// Year as an identifier and chart the metrics as categories.
const CLIMATE = {
  row_count: 71,
  columns: [
    { id: '_id', type: 'INTEGER', distinct: 71, nulls: 0 },
    { id: 'Year', type: 'TEXT', distinct: 71, nulls: 0 },
    { id: 'winter', type: 'NUMERIC', distinct: 45, nulls: 0, min: -3.6, max: 4.1, avg: 0.58 },
    { id: 'spring', type: 'NUMERIC', distinct: 32, nulls: 0, min: -2, max: 4, avg: 0.27 },
  ],
};

describe('classifyColumns / metrics-over-time', () => {
  const c = classifyColumns(CLIMATE);

  test('treats a unique year column as a time axis, not an identifier', () => {
    expect(c.dates.map((d) => d.id)).toContain('Year');
    expect(c.dates[0].isRealDate).toBe(false);
    expect(c.dimensions.map((d) => d.id)).not.toContain('Year');
  });

  test('treats continuous numerics as measures, not categorical dimensions', () => {
    expect(c.measures.map((m) => m.id)).toEqual(expect.arrayContaining(['winter', 'spring']));
    expect(c.dimensions.map((d) => d.id)).not.toContain('winter');
  });

  test('plans an averaged time series per measure', () => {
    const insights = buildInsights(c);
    const winterLine = insights.find((i) => i.aggColumn === 'winter');
    expect(winterLine).toMatchObject({ kind: 'timeseries', role: 'metric_time', column: 'Year', agg: 'avg', categorical: true });
    expect(insights.filter((i) => i.role === 'metric_time').length).toBeGreaterThanOrEqual(2);
  });
});

describe('measures vs surrogate ids', () => {
  test('a unique-valued decimal amount is a measure, not an identifier', () => {
    const c = classifyColumns({
      row_count: 420,
      columns: [
        { id: 'province', type: 'TEXT', distinct: 6, nulls: 0 },
        { id: 'amount', type: 'NUMERIC', distinct: 420, nulls: 0, min: 0, max: 500000, avg: 25000 },
      ],
    });
    expect(c.measures.map((m) => m.id)).toContain('amount');
  });

  test('a unique integer key without a measure name stays out of measures', () => {
    const c = classifyColumns({
      row_count: 1000,
      columns: [
        { id: 'record_key', type: 'INTEGER', distinct: 1000, nulls: 0, min: 1, max: 1000 },
        { id: 'region', type: 'TEXT', distinct: 5, nulls: 0 },
      ],
    });
    expect(c.measures.map((m) => m.id)).not.toContain('record_key');
  });
});

describe('hasAnyInsight', () => {
  test('false when nothing is chartable', () => {
    const c = classifyColumns({ row_count: 100, columns: [{ id: 'note', type: 'TEXT', distinct: 100, nulls: 0 }] });
    expect(hasAnyInsight(c)).toBe(false);
  });
});
