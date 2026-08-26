jest.mock('../services/mapService', () => ({ queryMap: jest.fn() }));
jest.mock('../services/pmtilesMapService', () => ({ getTile: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(),
    pingDb: jest.fn(), getLastSyncTime: jest.fn(), listRecentlyIngested: jest.fn(), getJobHealth: jest.fn(),
    getResourceMapById: jest.fn()
}));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(), listPopularResources: jest.fn() }));

const request = require('supertest');
const mapService = require('../services/mapService');
const pmtilesMapService = require('../services/pmtilesMapService');
const catalogQueries = require('../db/catalogReadQueries');
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

    test('serves a private PMTiles range decode through an immutable binary URL', async () => {
        catalogQueries.getResourceMapById.mockResolvedValue({
            provider: 'pmtiles', source_version: 'a'.repeat(64)
        });
        pmtilesMapService.getTile.mockResolvedValue(Buffer.from([0x1a, 0x00]));
        const url = '/api/v1/resources/spatial/map/tiles/' + 'a'.repeat(64) + '/0/0/0.pbf';
        const res = await request(app).get(url);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/x-protobuf');
        expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(pmtilesMapService.getTile).toHaveBeenCalledWith(
            expect.objectContaining({ provider: 'pmtiles' }),
            expect.objectContaining({ id: 'spatial', version: 'a'.repeat(64), z: '0', x: '0', y: '0' })
        );
    });

    test('returns 404 for a non-PMTiles resource and 204 for an empty tile', async () => {
        catalogQueries.getResourceMapById.mockResolvedValue({ provider: 'canquery' });
        await request(app).get('/api/v1/resources/spatial/map/tiles/' + 'a'.repeat(64) + '/0/0/0.pbf')
            .expect(404);
        catalogQueries.getResourceMapById.mockResolvedValue({ provider: 'pmtiles' });
        pmtilesMapService.getTile.mockResolvedValue(null);
        await request(app).get('/api/v1/resources/spatial/map/tiles/' + 'a'.repeat(64) + '/0/0/0.pbf')
            .expect(204);
    });
});
