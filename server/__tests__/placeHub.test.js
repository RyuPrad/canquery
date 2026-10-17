const catalogReadCache = require('../services/catalogReadCache');
const { loadPlaceHub, SECTION_BUDGET_MS } = require('../services/placeHub');

const place = { id: 'sgc-csd-3518013', slug: 'oshawa-on', kind: 'municipality', parent_id: 'sgc-cd-3518' };
const rows = Array.from({ length: 51 }, (_, i) => ({ id: 'd' + i, name: 'd' + i, title_en: 'Dataset ' + i }));
const facets = { total: 200, facets: { level: [{ value: 'municipal', count: 20 }], access: [{ value: 'queryable', count: 40 }, { value: 'mappable', count: 150 }],
    organization: [{ value: 'city', count: 20 }], source: [], format: [], keyword: [] } };

beforeEach(() => catalogReadCache.clear());

test('reads the dataset list first and fails the page when that read fails', async () => {
    const deps = { searchDatasets: jest.fn().mockRejectedValue(new Error('db unavailable')), listOrganizations: jest.fn() };
    await expect(loadPlaceHub(place, { page: 1, offset: 0, deps })).rejects.toThrow('db unavailable');
    expect(deps.listOrganizations).not.toHaveBeenCalled();
});

test('fills every section from the optional reads and tolerates missing or failing ones', async () => {
    const deps = {
        searchDatasets: jest.fn().mockResolvedValue(rows),
        datasetFacets: jest.fn().mockResolvedValue(facets),
        listOrganizations: jest.fn().mockResolvedValue([{ name: 'city-works', title_en: 'City Works', dataset_count: 20 }]),
        listSources: jest.fn().mockRejectedValue(new Error('private detail')),
        listPopularResources: jest.fn().mockResolvedValue([{ resource_id: 'r1', hits: 9, name_en: 'Permits' }]),
        listPlaces: jest.fn().mockResolvedValue([{ id: place.id, slug: 'oshawa-on' }, { id: 'a', slug: 'ajax-on' }])
    };
    const hub = await loadPlaceHub(place, { page: 1, offset: 0, deps });
    expect(hub.datasets).toBe(rows);
    expect(hub.facets).toBe(facets);
    expect(hub.organizations).toEqual([{ name: 'city-works', title_en: 'City Works', dataset_count: 20 }]);
    expect(hub.sources).toEqual([]);
    expect(hub.popular).toEqual([{ resource_id: 'r1', hits: 9, name_en: 'Permits' }]);
    expect(hub.recent).toEqual([]);
    expect(hub.siblings).toEqual([{ id: 'a', slug: 'ajax-on' }]);
    expect(deps.searchDatasets).toHaveBeenCalledWith(expect.objectContaining({ place: 'oshawa-on', limit: 51, offset: 0 }));
    expect(deps.datasetFacets).toHaveBeenCalledWith(expect.objectContaining({ place: 'oshawa-on', lang: 'en', sort: 'relevance' }));
    expect(deps.listOrganizations).toHaveBeenCalledWith({ q: null, source: null, place: 'oshawa-on', limit: 12, offset: 0 });
    expect(deps.listPopularResources).toHaveBeenCalledWith({ days: 7, limit: 6, place: 'oshawa-on' });
    expect(deps.listPlaces).toHaveBeenCalledWith({ q: null, kind: null, parent: 'sgc-cd-3518', featured: true, limit: 13, offset: 0 });
});

test('ignores a facet result without counts and a place without a parent', async () => {
    const deps = { searchDatasets: jest.fn().mockResolvedValue([]), datasetFacets: jest.fn().mockResolvedValue(null), listPlaces: jest.fn() };
    const hub = await loadPlaceHub({ id: 'ca', slug: 'canada', kind: 'country' }, { page: 1, offset: 0, deps });
    expect(hub.facets).toBeNull();
    expect(hub.siblings).toEqual([]);
    expect(deps.listPlaces).not.toHaveBeenCalled();
});

test('reads only the dataset list on later pages', async () => {
    const deps = { searchDatasets: jest.fn().mockResolvedValue(rows), datasetFacets: jest.fn(), listOrganizations: jest.fn(), listSources: jest.fn() };
    const hub = await loadPlaceHub(place, { page: 2, offset: 50, deps });
    expect(hub.datasets).toBe(rows);
    expect(deps.searchDatasets).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }));
    for (const name of ['datasetFacets', 'listOrganizations', 'listSources']) expect(deps[name]).not.toHaveBeenCalled();
    expect(hub.organizations).toEqual([]);
});

test('caches the popular and recent table reads between requests', async () => {
    const deps = {
        searchDatasets: jest.fn().mockResolvedValue([]),
        listPopularResources: jest.fn().mockResolvedValue([{ resource_id: 'r1' }]),
        listRecentlyIngested: jest.fn().mockResolvedValue([{ resource_id: 'r2' }])
    };
    await loadPlaceHub(place, { page: 1, offset: 0, deps });
    await loadPlaceHub(place, { page: 1, offset: 0, deps });
    expect(deps.listPopularResources).toHaveBeenCalledTimes(1);
    expect(deps.listRecentlyIngested).toHaveBeenCalledTimes(1);
    expect(deps.listRecentlyIngested).toHaveBeenCalledWith(6, 'oshawa-on');
});

test('leaves a section empty when its read outlasts the budget', async () => {
    jest.useFakeTimers();
    try {
        const deps = {
            searchDatasets: jest.fn().mockResolvedValue(rows),
            listOrganizations: jest.fn(() => new Promise(() => {})),
            listSources: jest.fn().mockResolvedValue([{ id: 'oshawa-hub' }])
        };
        const pending = loadPlaceHub(place, { page: 1, offset: 0, deps });
        await jest.advanceTimersByTimeAsync(SECTION_BUDGET_MS + 10);
        const hub = await pending;
        expect(hub.organizations).toEqual([]);
        expect(hub.sources).toEqual([{ id: 'oshawa-hub' }]);
    } finally {
        jest.useRealTimers();
    }
});
