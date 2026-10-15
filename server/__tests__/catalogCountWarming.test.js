jest.mock('../db/catalogFacetQueries', () => ({ readDatasetFacets: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(), listPopularResources: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn() }));

const { readDatasetFacets } = require('../db/catalogFacetQueries');
const catalogReadQueries = require('../db/catalogReadQueries');
const { searchDatasets, startCatalogCountWarming } = require('../services/catalogService');

const flush = () => new Promise(resolve => setImmediate(resolve));

test('warming fills the counts that unfiltered homepage and catalogue requests read', async () => {
    readDatasetFacets.mockImplementation(async filters => [{ facet: 'total', value: null, count: filters.lang === 'fr' ? 2 : 1 }]);
    catalogReadQueries.searchDatasets.mockResolvedValue([]);
    const stop = startCatalogCountWarming();
    try {
        for (let i = 0; i < 5; i++) await flush();
        expect(readDatasetFacets.mock.calls.map(([filters]) => filters.lang)).toEqual(['en', 'fr']);
        await expect(searchDatasets({ facets: '1', limit: '6' })).resolves.toMatchObject({ total: 1 });
        await expect(searchDatasets({ facets: 'true', lang: 'fr', sort: 'updated' })).resolves.toMatchObject({ total: 2 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
    } finally {
        stop();
    }
});
