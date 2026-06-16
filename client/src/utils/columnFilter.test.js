import { describe, it, expect } from 'vitest';
import { parseColumnFilter, buildColumnFilters } from './columnFilter.js';

describe('parseColumnFilter', () => {
  it('maps comparison prefixes to the backend ops', () => {
    expect(parseColumnFilter('>2')).toEqual({ op: 'gt', value: '2' });
    expect(parseColumnFilter('>=2')).toEqual({ op: 'gte', value: '2' });
    expect(parseColumnFilter('<2')).toEqual({ op: 'lt', value: '2' });
    expect(parseColumnFilter('<=2')).toEqual({ op: 'lte', value: '2' });
    expect(parseColumnFilter('=1948')).toEqual({ op: 'eq', value: '1948' });
  });

  it('reads ">=" as gte, not gt followed by "="', () => {
    expect(parseColumnFilter('>=10').op).toBe('gte');
    expect(parseColumnFilter('<=10').op).toBe('lte');
  });

  it('tolerates whitespace around the operator and value', () => {
    expect(parseColumnFilter('>  2 ')).toEqual({ op: 'gt', value: '2' });
    expect(parseColumnFilter('  = Ontario ')).toEqual({ op: 'eq', value: 'Ontario' });
  });

  it('falls back to contains for bare text', () => {
    expect(parseColumnFilter('housing')).toEqual({ op: 'contains', value: 'housing' });
    expect(parseColumnFilter('1987')).toEqual({ op: 'contains', value: '1987' });
  });

  it('treats a lone operator as contains (no value to compare)', () => {
    expect(parseColumnFilter('>')).toEqual({ op: 'contains', value: '>' });
  });

  it('keeps text values verbatim so codes are not numeric-coerced', () => {
    expect(parseColumnFilter('=K1A 0B1')).toEqual({ op: 'eq', value: 'K1A 0B1' });
  });

  it('handles null and undefined input', () => {
    expect(parseColumnFilter(null)).toEqual({ op: 'contains', value: '' });
    expect(parseColumnFilter(undefined)).toEqual({ op: 'contains', value: '' });
  });
});

describe('buildColumnFilters', () => {
  it('builds an API filters object and drops blank inputs', () => {
    expect(
      buildColumnFilters({ year: '>1990', city: '  ', name: 'housing', empty: '' })
    ).toEqual({
      year: { op: 'gt', value: '1990' },
      name: { op: 'contains', value: 'housing' },
    });
  });

  it('returns an empty object for no active filters', () => {
    expect(buildColumnFilters({})).toEqual({});
    expect(buildColumnFilters(null)).toEqual({});
  });
});
