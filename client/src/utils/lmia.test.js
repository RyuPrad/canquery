import { describe, expect, test } from 'vitest';
import { formatCount, lmiaPeriodLabel, provinceName, streamName } from './lmia.js';

describe('lmia labels', () => {
  test('periods in English and French', () => {
    const quarter = { kind: 'quarter', start: '2026-04-01', end: '2026-06-30' };
    const half = { period_kind: 'half', period_start: '2017-01-01', period_end: '2017-06-30' };
    const year = { kind: 'year', start: '2016-01-01', end: '2016-12-31' };
    const partial = { kind: 'year', start: '2014-06-20', end: '2014-12-31' };
    expect([quarter, half, year, partial].map(period => lmiaPeriodLabel(period, 'en'))).toEqual(
      ['Q2 2026', 'January to June 2017', '2016', 'June 20 to December 31, 2014']);
    expect([quarter, half, year, partial].map(period => lmiaPeriodLabel(period, 'fr'))).toEqual(
      ['T2 2026', 'de janvier à juin 2017', '2016', 'du 20 juin au 31 décembre 2014']);
    expect(lmiaPeriodLabel({ kind: 'year', start: '2014-01-01', end: '2014-06-30' }, 'fr')).toBe('du 1er janvier au 30 juin 2014');
    expect(lmiaPeriodLabel(null, 'en')).toBe('');
    expect(lmiaPeriodLabel({ kind: 'quarter' }, 'en')).toBe('');
  });

  test('provinces, streams and counts', () => {
    expect(provinceName('HO', 'en')).toBe('Head office outside Canada');
    expect(provinceName('QC', 'fr')).toBe('Québec');
    expect(provinceName('ZZ', 'en')).toBe('ZZ');
    expect(provinceName(null, 'en')).toBe('');
    expect(streamName('Low Wage', 'en')).toBe('Low Wage');
    expect(streamName('Global Talent Stream', 'fr')).toBe('Volet des talents mondiaux');
    expect(streamName('Something new', 'fr')).toBe('Something new');
    expect(formatCount(150691, 'en')).toBe('150,691');
    expect(formatCount(150691, 'fr').replace(/\s/g, ' ')).toBe('150 691');
  });
});
