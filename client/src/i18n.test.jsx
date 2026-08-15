import { describe, expect, test } from 'vitest';
import { STRINGS } from './i18n.jsx';

describe('interface translation dictionary', () => {
  test('keeps English and French keys in exact parity', () => {
    expect(Object.keys(STRINGS.fr).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });
});
