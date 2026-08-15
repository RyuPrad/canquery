jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(), getResourceMapById: jest.fn(), listOrganizations: jest.fn(),
    listSources: jest.fn(), listPlaces: jest.fn(), getPlaceByIdOrSlug: jest.fn(),
    getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn(), getJobHealth: jest.fn(), countSitemapDatasets: jest.fn(),
    listDatasetSitemap: jest.fn(), listPlaceSitemap: jest.fn()
}));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(), listPopularResources: jest.fn() }));

const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const app = require('../app');

beforeEach(() => jest.clearAllMocks());

describe('place and source catalogue APIs', () => {
    test('lists active places with hierarchy and map counts', async () => {
        queries.listPlaces.mockResolvedValue([{
            id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality',
            name_en: 'Oshawa', name_fr: 'Oshawa', type_en: 'City', type_fr: 'Ville',
            parent_id: 'ca-on-durham', parent_slug: 'durham-on', parent_name_en: 'Durham', parent_name_fr: 'Durham',
            latitude: 43.897, longitude: -78.866, default_zoom: 11,
            dataset_count: 200, mappable_resource_count: 150
        }]);
        const res = await request(app).get('/api/v1/places?q=Oshawa');
        expect(res.status).toBe(200);
        expect(res.body.data[0]).toEqual(expect.objectContaining({
            slug: 'oshawa-on', dataset_count: 200, mappable_resource_count: 150,
            parent: expect.objectContaining({ slug: 'durham-on' })
        }));
        expect(queries.listPlaces).toHaveBeenCalledWith(expect.objectContaining({ q: 'Oshawa', limit: 51 }));
    });

    test('returns one place with ancestry and counts', async () => {
        queries.getPlaceByIdOrSlug.mockResolvedValue({
            id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality', name_en: 'Oshawa',
            type_en: 'City', latitude: 43.897, longitude: -78.866, default_zoom: 11,
            dataset_count: 10, mappable_dataset_count: 8,
            ancestors: [{ id: 'ca', slug: 'canada', kind: 'country', name_en: 'Canada' }]
        });
        const res = await request(app).get('/api/v1/places/oshawa-on');
        expect(res.status).toBe(200);
        expect(res.body.data.ancestors[0].name.en).toBe('Canada');
        expect(res.body.data.location.zoom).toBe(11);
    });

    test('lists source portals relevant to a place', async () => {
        queries.listSources.mockResolvedValue([{
            id: 'oshawa-hub', kind: 'arcgis-hub', name_en: 'Oshawa Hub',
            homepage_url: 'https://example.test', upstream_host: 'example.test', dataset_count: 12
        }]);
        const res = await request(app).get('/api/v1/sources?place=oshawa-on');
        expect(res.status).toBe(200);
        expect(res.body.data[0]).toEqual(expect.objectContaining({ id: 'oshawa-hub', dataset_count: 12 }));
        expect(queries.listSources).toHaveBeenCalledWith({ place: 'oshawa-on' });
    });
});
