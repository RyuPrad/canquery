import { beforeEach, describe, expect, test } from 'vitest';
import { readPlace, writePlace, PLACE_STORAGE_KEY } from './placeStore.js';

describe('remembered place', () => {
  beforeEach(() => localStorage.clear());

  test('stores a stable slug and clears back to All Canada', () => {
    writePlace('oshawa-on');
    expect(readPlace()).toBe('oshawa-on');
    expect(localStorage.getItem(PLACE_STORAGE_KEY)).toBe('oshawa-on');
    writePlace('');
    expect(readPlace()).toBe('');
    expect(localStorage.getItem(PLACE_STORAGE_KEY)).toBeNull();
  });
});
