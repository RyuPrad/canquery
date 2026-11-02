import { describe, expect, test } from 'vitest';
import { buildCsv, csvFilename } from './csvExport.js';

describe('a CSV of the rows on screen', () => {
  const fields = [
    { id: '_id', type: 'int' },
    { id: 'Name', type: 'TEXT' },
    { id: 'Amount', type: 'NUMERIC' },
    { id: 'Day', type: 'DATE' },
    { id: 'At', type: 'TIMESTAMPTZ' }
  ];

  test("is written like the server's export", () => {
    expect(
      buildCsv(fields, [
        ['1', 'Ward, "3"', '-2.5', '2024-01-05T00:00:00.000Z', '2024-01-05T10:00:00.000Z'],
        ['2', '=HYPERLINK("x")', '-x', null, null],
        ['3', '  @cmd', '12', '2023-12-31T00:00:00.000Z', null]
      ])
    ).toBe(
      '_id,Name,Amount,Day,At\n' +
        '1,"Ward, ""3""",-2.5,2024-01-05,2024-01-05T10:00:00.000Z\n' +
        `2,"'=HYPERLINK(""x"")",'-x,,\n` +
        "3,'  @cmd,12,2023-12-31,\n"
    );
  });

  test('a formula-like header is neutralised too, and the file is named for the resource', () => {
    expect(buildCsv([{ id: '=sum', type: 'TEXT' }], [])).toBe("'=sum\n");
    expect(csvFilename('a/b c')).toBe('resource-a_b_c.csv');
  });
});
