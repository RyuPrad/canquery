import { expect, test } from 'vitest';
import { fmtNum } from './theme.js';

test('small nonzero measures are never displayed as zero', () => {
  expect(fmtNum(0.00125, 'en')).toBe('1.25E-3');
  expect(fmtNum(-0.0005, 'en')).toBe('-5E-4');
  expect(fmtNum(0.0005, 'fr')).toBe('5E-4');
  expect(fmtNum(0, 'en')).toBe('0');
  expect(fmtNum(0.75, 'en')).toBe('0.75');
});
