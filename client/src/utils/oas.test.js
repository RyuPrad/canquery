import { describe, expect, test } from 'vitest';
import {
  NBSP, bandSections, dateLabel, findBand, formatBand, formatChange, formatCount, formatDollars, formatMoney, parseIncome,
  periodLabel, periodState, today
} from './oas.js';

// Bands of $24 from 0, a dollar less per band: [from, to, amount, allowance, with 65, with 75] in cents.
const bands = (rows = 120, width = 2400) => Array.from({ length: rows }, (_, position) =>
  [position * width, (position + 1) * width - 1, 113890 - position * 100, null, 190140 - position * 100, 197765 - position * 100]);

describe('money', () => {
  test('is written from whole cents, the same in every browser', () => {
    expect(formatMoney(113890, 'en')).toBe('$1,138.90');
    expect(formatMoney(113890, 'fr')).toBe('1' + NBSP + '138,90' + NBSP + '$');
    expect(formatMoney(49, 'en')).toBe('$0.49');
    expect(formatMoney(0, 'fr')).toBe('0,00' + NBSP + '$');
    expect(formatMoney(123456789, 'fr')).toBe('1' + NBSP + '234' + NBSP + '567,89' + NBSP + '$');
    expect(formatMoney(undefined, 'en')).toBe('');
    expect(formatDollars(2311200, 'en')).toBe('$23,112');
    expect(formatDollars(2311250, 'fr')).toBe('23' + NBSP + '112,50' + NBSP + '$');
    expect(formatBand(0, 2399, 'en')).toBe('$0.00 to $23.99');
    expect(formatBand(1800000, 1802399, 'fr')).toBe('18' + NBSP + '000,00' + NBSP + '$ à 18' + NBSP + '023,99' + NBSP + '$');
    expect(formatCount(1140, 'en')).toBe('1,140');
    expect(formatCount(1140, 'fr')).toBe('1' + NBSP + '140');
    expect(formatCount(686, 'fr')).toBe('686');
  });
  test('a change is a signed percentage to one decimal', () => {
    expect(formatChange(113890, 112317, 'en')).toBe('+1.4%');
    expect(formatChange(113890, 112317, 'fr')).toBe('+1,4' + NBSP + '%');
    expect(formatChange(99000, 100000, 'en')).toBe('-1.0%');
    expect(formatChange(100000, 100000, 'fr')).toBe('0,0' + NBSP + '%');
    expect(formatChange(100, 0, 'en')).toBe('');
  });
});

describe('quarters', () => {
  test('are named as the publisher names them', () => {
    expect(periodLabel({ quarter: 4, year: 2026 }, 'en')).toBe('October to December 2026');
    expect(periodLabel({ quarter: 4, year: 2026 }, 'fr')).toBe('octobre à décembre 2026');
    expect(periodLabel({ quarter: 1, year: 2027 }, 'en', { short: true })).toBe('Jan–Mar 2027');
    expect(periodLabel({ quarter: 3, year: 2027 }, 'fr', { short: true })).toBe('juill.–sept. 2027');
    expect(periodLabel(null, 'en')).toBe('');
    expect(periodLabel({ quarter: 5, year: 2027 }, 'en')).toBe('');
    expect(dateLabel('2027-01-01', 'en')).toBe('January 1, 2027');
    expect(dateLabel('2027-01-01', 'fr')).toBe('1er janvier 2027');
    expect(dateLabel('2026-10-15', 'fr')).toBe('15 octobre 2026');
    expect(dateLabel('', 'en')).toBe('');
  });
  test('have not started, are in effect or have ended on the visitor’s day', () => {
    const period = { start: '2027-01-01', end: '2027-03-31' };
    expect(periodState(period, '2026-12-31')).toBe('upcoming');
    expect(periodState(period, '2027-01-01')).toBe('current');
    expect(periodState(period, '2027-03-31')).toBe('current');
    expect(periodState(period, '2027-04-01')).toBe('ended');
    expect(periodState(null, '2027-04-01')).toBe('current');
    expect(today(new Date(2027, 0, 5, 23, 59))).toBe('2027-01-05');
  });
});

describe('parseIncome', () => {
  test('reads the ways people write a yearly income, in cents', () => {
    for (const [text, cents] of [
      ['18000', 1800000], ['18,000', 1800000], ['18,000.50', 1800050], ['18000.5', 1800050], ['18 000', 1800000],
      ['18 000,50', 1800050], ['18' + NBSP + '000,50', 1800050], ['18' + String.fromCharCode(0x202f) + '000', 1800000],
      ['$18,000', 1800000], ['18 000 $', 1800000], ['18000,5', 1800050], ['0', 0], ['0.99', 99], ['  23111.99  ', 2311199],
      ['1,234,567.89', 123456789], ['007', 700], ['18,00', 1800], ['999999999', 99999999900]
    ]) {
      expect([text, parseIncome(text)]).toEqual([text, { cents }]);
    }
  });
  test('an empty box is not an error', () => {
    // A lone dollar sign is someone about to type the amount.
    for (const text of ['', '   ', NBSP, '$', ' $ ', '.', ',', null, undefined]) expect(parseIncome(text)).toEqual({ empty: true });
  });
  test('a separator typed last is the amount so far', () => {
    for (const [text, cents] of [['18,', 1800], ['18.', 1800], ['18,000.', 1800000], ['18 000,', 1800000], ['1,234,', 123400], ['$5.', 500]]) {
      expect([text, parseIncome(text)]).toEqual([text, { cents }]);
    }
  });
  test('a gap only groups thousands: two numbers pasted together are not an amount', () => {
    for (const text of ['18000\t212', '18000 212', '1 8000', '18 00', '18  000', '18\n000', '1,234 567', '18 000 000 0']) {
      expect([text, parseIncome(text)]).toEqual([text, { invalid: true }]);
    }
    expect(parseIncome('1 234 567,8')).toEqual({ cents: 123456780 });
  });
  test('refuses what could be read two ways or is not an amount', () => {
    for (const text of ['18.000', '18,0000', '1,23,456', '18.000,50', '-5', '+5', '1e5', 'abc', '18k', '18 000 CAD', '$$5', '5$$',
      '18..5', '18,000,5', '.5', '5..', '18.000.', '1234567890', '１２３']) {
      expect([text, parseIncome(text)]).toEqual([text, { invalid: true }]);
    }
  });
});

describe('bands', () => {
  test('the band of an income is found at every edge, with its line; none past the table', () => {
    const rows = bands();
    expect(findBand(rows, 0)).toEqual({ row: rows[0], line: 1 });
    expect(findBand(rows, 2399)).toEqual({ row: rows[0], line: 1 });
    expect(findBand(rows, 2400)).toEqual({ row: rows[1], line: 2 });
    expect(findBand(rows, 287999)).toEqual({ row: rows[119], line: 120 });
    expect(findBand(rows, 288000)).toBeNull();
    expect(findBand(rows, -1)).toBeNull();
    expect(findBand([], 5)).toBeNull();
    for (let cents = 0; cents < 288000; cents += 997) expect(findBand(rows, cents).row[0]).toBe(Math.floor(cents / 2400) * 2400);
  });
  test('a table is shown in sections of one round span of income, each named by the income it starts at', () => {
    // 963 bands of $24 end at $23,112, as the single person's table does: twelve sections of $2,000.
    const single = bandSections(bands(963));
    expect(single.map((group) => group.id)).toEqual(['income-0', 'income-2000', 'income-4000', 'income-6000', 'income-8000', 'income-10000',
      'income-12000', 'income-14000', 'income-16000', 'income-18000', 'income-20000', 'income-22000']);
    // The band that holds a round income opens its section.
    expect(single[1]).toMatchObject({ start: 200000, from: 199200, first: 84 });
    expect(single[1].rows[0]).toEqual(bands(963)[83]);
    expect(single[0]).toMatchObject({ from: 0, to: 199199, first: 1 });
    expect(single[11].to).toBe(2311199);
    expect(single.flatMap((group) => group.rows)).toEqual(bands(963));
    expect(single.map((group) => group.first)).toEqual(single.map((group, index) => single.slice(0, index).reduce((sum, item) => sum + item.rows.length, 0) + 1));
    // The same income names the same section in the next quarter's slightly longer table.
    expect(bandSections(bands(980)).slice(0, 12).map((group) => group.id)).toEqual(single.map((group) => group.id));
    // A wider table takes a wider span, and never more than twelve sections: $5,000 for one that ends at $55,392.
    const couple = bandSections(bands(1154, 4800));
    expect(couple).toHaveLength(12);
    expect(couple.map((group) => group.id).slice(0, 3)).toEqual(['income-0', 'income-5000', 'income-10000']);
    for (const rows of [bands(120), bands(686, 4800), bands(1220, 2400), bands(5000, 2400), bands(1)]) {
      expect(bandSections(rows).length).toBeLessThanOrEqual(12);
      expect(bandSections(rows).flatMap((group) => group.rows)).toEqual(rows);
    }
    // A first band wider than the span (the couple's table starts with one of $4,096) stays one band in the first section.
    const wide = [[0, 409599, 113890, null, 190140, 197765], ...bands(40, 4800).map(([from, to, ...rest]) => [from + 409600, to + 409600, ...rest])];
    expect(bandSections(wide)[0]).toMatchObject({ id: 'income-0', from: 0, first: 1 });
    expect(bandSections([])).toEqual([]);
  });
});
