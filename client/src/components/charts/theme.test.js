import { expect, test } from 'vitest';
import { axisWidthFor, charsForWidth, chronological, fmtNum } from './theme.js';

test('small nonzero measures are never displayed as zero', () => {
  expect(fmtNum(0.00125, 'en')).toBe('1.25E-3');
  expect(fmtNum(-0.0005, 'en')).toBe('-5E-4');
  expect(fmtNum(0.0005, 'fr')).toBe('5E-4');
  expect(fmtNum(0, 'en')).toBe('0');
  expect(fmtNum(0.75, 'en')).toBe('0.75');
});

test('axis widths follow their labels within bounds', () => {
  expect(axisWidthFor(['ON', 'QC'], { min: 64, max: 200 })).toBe(64);
  const long = axisWidthFor(['Parks & public open spaces'], { min: 64, max: 200 });
  expect(long).toBeGreaterThan(132);
  expect(charsForWidth(long)).toBeGreaterThanOrEqual('Parks & public open spaces'.length);
  expect(axisWidthFor(['x'.repeat(80)], { min: 64, max: 116 })).toBe(116);
});

test('newest-first temporal windows are returned in chronological order', () => {
  const desc = [{ key: '2026' }, { key: '2025' }, { key: '2024' }];
  expect(chronological(desc).map((r) => r.key)).toEqual(['2024', '2025', '2026']);
  expect(desc[0].key).toBe('2026');
});
