import { describe, expect, test } from 'vitest';
import {
  answerLocal,
  compareDecimal,
  createLocalTable,
  exportLocal,
  kindOf,
  likeRegExp,
  parseDecimal,
  parseTimestamp,
  refusalOf,
  textForm
} from './localTable.js';

const fields = [
  { id: '_id', type: 'int' },
  { id: 'Ward', type: 'TEXT' },
  { id: 'Count', type: 'INTEGER' },
  { id: 'Amount', type: 'NUMERIC' },
  { id: 'Day', type: 'DATE' },
  { id: 'At', type: 'TIMESTAMPTZ' }
];
// Values as the JSON API sends a prepared copy: bigint and numeric as text,
// dates as the ISO string of their midnight, timestamps in ISO UTC.
const rows = [
  ['1', 'Ward 3', '3', '98200.50', '2024-01-05T00:00:00.000Z', '2024-01-05T10:00:00.000Z'],
  ['2', 'ward 11', null, '0.5', '2023-12-31T00:00:00.000Z', '2024-01-05T08:00:00.123Z'],
  ['3', 'Côte 100%', '5', '-2', null, null],
  ['4', 'Ward_3', '-2', '1000', '2024-02-29T00:00:00.000Z', '2024-07-01T03:59:59.000Z'],
  ['5', 'Ward 3', '3', null, '2024-01-05T00:00:00.000Z', '2024-01-05T10:00:00.000Z']
];
const table = (complete = true) => createLocalTable({ fields, rows, complete });
const ids = (answer) => (answer.status === 'ok' ? answer.records.map((record) => record._id) : answer);
const ask = (query, complete) => answerLocal(table(complete), query);

describe('value forms and parsing', () => {
  test('kinds follow the recorded types, CKAN types included', () => {
    expect(fields.map(kindOf)).toEqual(['integer', 'text', 'integer', 'number', 'date', 'timestamp']);
    expect(['int4', 'numeric', 'float8', 'timestamp', 'bool', 'text'].map((type) => kindOf({ id: 'x', type }))).toEqual([
      'integer',
      'number',
      'number',
      'timestamp',
      'bool',
      'text'
    ]);
  });

  test('text forms are what PostgreSQL prints for ::text', () => {
    expect(textForm('date', '2024-01-05T00:00:00.000Z')).toBe('2024-01-05');
    expect(textForm('timestamp', '2024-01-05T10:00:00.000Z')).toBe('2024-01-05 10:00:00+00');
    expect(textForm('timestamp', '2024-01-05T08:00:00.120Z')).toBe('2024-01-05 08:00:00.12+00');
    expect(textForm('number', '0.5')).toBe('0.5');
    expect(textForm('text', null)).toBeNull();
  });

  test('LIKE patterns keep % and _ and the backslash escape', () => {
    expect(likeRegExp('%ward_3%').test('Ward 3')).toBe(true);
    expect(likeRegExp('%ward\\_3%').test('Ward 3')).toBe(false);
    expect(likeRegExp('%ward\\_3%').test('WARD_3')).toBe(true);
    expect(likeRegExp('%100\\%%').test('Côte 100%')).toBe(true);
    expect(likeRegExp('%a.b%').test('axb')).toBe(false);
    expect(likeRegExp('%dangling\\')).toBeNull();
  });

  test('decimals compare exactly, with NaN above every number', () => {
    const order = ['-10', '-2.5', '-0', '0.5', '.50', '999.999', '1e3', 'NaN'].map(parseDecimal);
    expect(compareDecimal(order[3], order[4])).toBe(0);
    expect(compareDecimal(order[2], parseDecimal('0'))).toBe(0);
    for (let index = 1; index < order.length; index += 1) {
      if (index === 4) continue;
      expect(compareDecimal(order[index - 1], order[index])).toBeLessThanOrEqual(0);
    }
    expect(compareDecimal(parseDecimal('12345678901234567890'), parseDecimal('12345678901234567891'))).toBe(-1);
  });

  test('timestamps without a zone are UTC, and offsets are applied', () => {
    expect(parseTimestamp('2024-01-05 10:00')).toBe(Date.UTC(2024, 0, 5, 10));
    expect(parseTimestamp('2024-01-05T10:00:00+02:00')).toBe(Date.UTC(2024, 0, 5, 8));
    expect(parseTimestamp('2024-01-05')).toBe(Date.UTC(2024, 0, 5));
    expect(parseTimestamp('2024-02-30')).toBeNull();
  });
});

describe('search and filters', () => {
  test('search matches any recorded column case-insensitively, never _id', () => {
    expect(ids(ask({ q: 'ward 3' }))).toEqual(['1', '5']);
    expect(ids(ask({ q: '2024-01-05' }))).toEqual(['1', '2', '5']);
    expect(ids(ask({ q: '1000' }))).toEqual(['4']);
    expect(ids(ask({ q: 'ward_3' }))).toEqual(['1', '4', '5']);
  });

  test('contains and typed comparisons follow the server', () => {
    expect(ids(ask({ filters: { Ward: { op: 'contains', value: 'côte' } } }))).toEqual(['3']);
    expect(ids(ask({ filters: { Count: { op: 'gt', value: '2' } } }))).toEqual(['1', '3', '5']);
    expect(ids(ask({ filters: { Amount: { op: 'eq', value: '0.50' } } }))).toEqual(['2']);
    expect(ids(ask({ filters: { Amount: { op: 'lte', value: '-2' } } }))).toEqual(['3']);
    expect(ids(ask({ filters: { Day: { op: 'gte', value: '2024-01-05' } } }))).toEqual(['1', '4', '5']);
    expect(ids(ask({ filters: { At: { op: 'lt', value: '2024-01-05 09:00' } } }))).toEqual(['2']);
    expect(ids(ask({ filters: { Ward: 'Ward 3' } }))).toEqual(['1', '5']);
    expect(ids(ask({ filters: { Count: { op: 'eq', value: null } } }))).toEqual(['2']);
    expect(ids(ask({ filters: { Count: { op: 'gt', value: '0' }, Ward: { op: 'contains', value: 'ward' } } }))).toEqual(['1', '5']);
  });

  test('values the database reads differently, text ranges and unknown columns go to the server', () => {
    for (const [filters, reason] of [
      [{ Day: { op: 'eq', value: 'Jan 5 2024' } }, 'value'],
      [{ Count: { op: 'eq', value: '1_000' } }, 'value'],
      [{ Count: { op: 'eq', value: '+5' } }, 'value'],
      [{ Count: { op: 'eq', value: '3.5' } }, 'value'],
      [{ Ward: { op: 'gt', value: 'm' } }, 'collation'],
      [{ Missing: 'x' }, 'unknown_column'],
      [{ Ward: { op: 'like', value: 'x' } }, 'operator']
    ]) {
      expect(ask({ filters })).toEqual({ status: 'unsupported', reason });
    }
    // A trailing backslash escapes the closing %, as it does in PostgreSQL.
    expect(ids(ask({ q: '100\\' }))).toEqual(['3']);
  });
});

describe('live tables', () => {
  test("a live table's zone-less timestamps and JSON numbers search as PostgreSQL prints them", () => {
    expect(textForm('timestamp', '2020-01-01T10:00:00')).toBe('2020-01-01 10:00:00');
    expect(textForm('timestamp', '2020-01-01T10:00:00.500')).toBe('2020-01-01 10:00:00.5');
    expect(textForm('number', -1e-7)).toBe('-0.0000001');
    expect(textForm('number', 12.5)).toBe('12.5');
    expect(textForm('integer', 2003)).toBe('2003');
  });

  test('whether a query can be answered depends on the columns alone', () => {
    const textYear = [{ id: '_id', type: 'int' }, { id: 'year', type: 'text' }];
    expect(refusalOf(textYear, { filters: { year: { op: 'gt', value: '2015' } } })).toBe('collation');
    expect(refusalOf(textYear, { filters: { year: { op: 'contains', value: '201' } }, sort: 'year desc' })).toBeNull();
    expect(refusalOf(fields, { filters: { Count: { op: 'gt', value: '10.5' } } })).toBe('value');
    expect(refusalOf(fields, { filters: { Missing: 'x' } })).toBe('unknown_column');
  });
});

describe('the server request limits', () => {
  test('a search of only spaces searches nothing, as on the server', () => {
    expect(ids(ask({ q: '   ' }))).toEqual(ids(ask({})));
  });

  test('what the server refuses (long searches, many filters, integers beyond bigint) goes to it', () => {
    expect(ask({ q: 'x'.repeat(201) })).toMatchObject({ status: 'unsupported' });
    expect(ask({ q: 'x'.repeat(200) }).status).toBe('ok');
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['c' + i, 'v']));
    expect(ask({ filters: many })).toMatchObject({ status: 'unsupported' });
    expect(ask({ filters: { Count: '9223372036854775808' } })).toMatchObject({ status: 'unsupported' });
    expect(ask({ filters: { Count: { op: 'gt', value: '-9223372036854775809' } } })).toMatchObject({ status: 'unsupported' });
    expect(ask({ filters: { Count: '9223372036854775807' } }).status).toBe('ok');
  });
});

describe('sorting and paging', () => {
  test('nulls sort last ascending and first descending, ties keep _id order', () => {
    expect(ids(ask({ sort: 'Count' }))).toEqual(['4', '1', '5', '3', '2']);
    expect(ids(ask({ sort: 'Count asc' }))).toEqual(['4', '1', '5', '3', '2']);
    expect(ids(ask({ sort: 'Count desc' }))).toEqual(['2', '3', '1', '5', '4']);
    expect(ids(ask({ sort: 'Day desc' }))).toEqual(['3', '4', '1', '5', '2']);
    expect(ids(ask({ sort: '_id desc' }))).toEqual(['5', '4', '3', '2', '1']);
    expect(ask({ sort: 'Nope desc' })).toEqual({ status: 'unsupported', reason: 'unknown_sort' });
  });

  test('text sorts with the en-US collation', () => {
    expect(ids(ask({ sort: 'Ward' }))).toEqual(['3', '2', '1', '5', '4']);
  });

  test('a column whose name ends in "desc" is still a column', () => {
    const named = createLocalTable({
      fields: [{ id: '_id', type: 'int' }, { id: 'Order desc', type: 'INTEGER' }],
      rows: [['1', '2'], ['2', '1']],
      complete: true
    });
    expect(ids(answerLocal(named, { sort: 'Order desc' }))).toEqual(['2', '1']);
  });

  test('pages and totals; a partial table reports what it holds', () => {
    const page = ask({ sort: 'Count', offset: 2, limit: 2 });
    expect(page).toMatchObject({ status: 'ok', total: 5, available: 5, complete: true });
    expect(ids(page)).toEqual(['5', '3']);
    expect(page.records[0]).toEqual({ _id: '5', Ward: 'Ward 3', Count: '3', Amount: null, Day: '2024-01-05T00:00:00.000Z', At: '2024-01-05T10:00:00.000Z' });
    const partial = ask({ q: 'ward', limit: 50 }, false);
    expect(partial).toMatchObject({ status: 'ok', total: null, available: 4, complete: false });
  });

  test('an export lists every matching row in view order', () => {
    expect(exportLocal(table(), { sort: 'Count desc' }, 3)).toEqual({ fields, rows: [rows[1], rows[2], rows[0]] });
  });
});
