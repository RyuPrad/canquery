import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./client.js', () => ({ getJSON: vi.fn(), postJSON: vi.fn() }));

import { getJSON } from './client.js';
import { fetchFeaturedPlaces } from './catalog.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('catalog API helpers', () => {
  test('collects every featured-place page', async () => {
    getJSON
      .mockResolvedValueOnce({
        data: [{ id: 'place-1' }],
        pagination: { nextCursor: '100' },
        meta: { request: 1 }
      })
      .mockResolvedValueOnce({
        data: [{ id: 'place-2' }],
        pagination: { nextCursor: null },
        meta: { request: 2 }
      });

    await expect(fetchFeaturedPlaces()).resolves.toEqual({
      data: [{ id: 'place-1' }, { id: 'place-2' }],
      pagination: { nextCursor: null },
      meta: { request: 2 }
    });
    expect(getJSON).toHaveBeenNthCalledWith(1, '/api/v1/places', {
      q: undefined, kind: undefined, parent: undefined,
      featured: true, limit: 100, cursor: undefined
    });
    expect(getJSON).toHaveBeenNthCalledWith(2, '/api/v1/places', {
      q: undefined, kind: undefined, parent: undefined,
      featured: true, limit: 100, cursor: '100'
    });
  });

  test('rejects a repeated cursor instead of looping forever', async () => {
    getJSON
      .mockResolvedValueOnce({ data: [], pagination: { nextCursor: '100' } })
      .mockResolvedValueOnce({ data: [], pagination: { nextCursor: '100' } });

    await expect(fetchFeaturedPlaces()).rejects.toThrow('repeated cursor');
    expect(getJSON).toHaveBeenCalledTimes(2);
  });
});
