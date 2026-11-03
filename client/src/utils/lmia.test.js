import { describe, expect, test } from 'vitest';
import { formatCount, lmiaPeriodLabel, lmiaPeriodRange, provinceName, streamName } from './lmia.js';

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

  test('ranges take the start of the first period and the end of the last, with French prepositions', () => {
    const partial = { kind: 'year', start: '2014-06-20', end: '2014-12-31' };
    const year = { kind: 'year', start: '2015-01-01', end: '2015-12-31' };
    const half = { kind: 'half', start: '2017-01-01', end: '2017-06-30' };
    const q1 = { kind: 'quarter', start: '2019-01-01', end: '2019-03-31' };
    const q2 = { kind: 'quarter', start: '2026-04-01', end: '2026-06-30' };
    expect(lmiaPeriodRange(partial, q2, 'en')).toBe('from June 20, 2014 to Q2 2026');
    expect(lmiaPeriodRange(partial, q2, 'fr')).toBe('du 20 juin 2014 au T2 2026');
    expect(lmiaPeriodRange(year, q2, 'fr')).toBe('de 2015 au T2 2026');
    expect(lmiaPeriodRange(q1, q2, 'fr')).toBe('du T1 2019 au T2 2026');
    expect(lmiaPeriodRange(half, year, 'en')).toBe('from January 2017 to 2015');
    expect(lmiaPeriodRange(half, partial, 'fr')).toBe('de janvier 2017 au 31 décembre 2014');
    expect(lmiaPeriodRange(null, q2, 'en')).toBe('');
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
