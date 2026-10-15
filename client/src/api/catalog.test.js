import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./client.js', () => ({ getJSON: vi.fn(), postJSON: vi.fn() }));

import { getJSON } from './client.js';
import { datasetSearchPath, fetchFeaturedPlaces, searchDatasets } from './catalog.js';

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
    expect(getJSON).toHaveBeenNthCalledWith(1, '/web-api/v1/places', {
      q: undefined, kind: undefined, parent: undefined,
      featured: true, limit: 100, cursor: undefined
    });
    expect(getJSON).toHaveBeenNthCalledWith(2, '/web-api/v1/places', {
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

  test('dataset searches send lists as repeated keys in a stable order and validate the response', async () => {
    expect(datasetSearchPath({ cursor: '50', limit: 50, format: ['CSV', 'PDF'], q: 'parks', mappable: false, place: '', facets: true, lang: 'fr' }))
      .toBe('/web-api/v1/datasets?q=parks&format=CSV&format=PDF&lang=fr&facets=true&limit=50&cursor=50');
    expect(datasetSearchPath()).toBe('/web-api/v1/datasets');
    getJSON.mockResolvedValue({ data: [] });
    const signal = new AbortController().signal;
    await searchDatasets({ org: ['a', 'b'], limit: 20 }, { signal });
    expect(getJSON).toHaveBeenCalledWith('/web-api/v1/datasets?org=a&org=b&limit=20', undefined,
      expect.objectContaining({ signal, validate: expect.any(Function) }));
  });
});
