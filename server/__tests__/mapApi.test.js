jest.mock('../services/mapService', () => ({ queryMap: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(),
    pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn(), getJobHealth: jest.fn()
}));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(), listPopularResources: jest.fn() }));

const request = require('supertest');
const mapService = require('../services/mapService');
const app = require('../app');

beforeEach(() => jest.clearAllMocks());

describe('live map API', () => {
    test('returns GeoJSON with viewport and publisher metadata', async () => {
        mapService.queryMap.mockResolvedValue({
            data: { type: 'FeatureCollection', features: [] },
            map: { live: true, returned: 0, truncated: false },
            provenance: {
                sources: [{ id: 'oshawa-hub', authoritative: true, upstream: 'example.test' }],
                primary_license: { title: { en: 'Oshawa licence' }, url: 'https://example.test/licence' }
            }
        });
        const res = await request(app).get('/api/v1/resources/spatial/map?bbox=-79,43,-78,44&zoom=11');
        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('FeatureCollection');
        expect(res.body.meta.sources).toEqual(['oshawa-hub']);
        expect(res.body.meta.license).toBe('Oshawa licence');
        expect(res.headers['cache-control']).toBe('public, max-age=60');
        expect(mapService.queryMap).toHaveBeenCalledWith('spatial', expect.objectContaining({
            bbox: '-79,43,-78,44', zoom: '11'
        }));
    });
});
