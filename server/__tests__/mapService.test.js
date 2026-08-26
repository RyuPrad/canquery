const mapService = require('../services/mapService');

function row(id = 'map-resource') {
    return {
        id,
        service_url: 'https://services.arcgis.com/example/FeatureServer/0',
        geometry_type: 'point',
        extent: [-79, 43, -78, 44],
        object_id_field: 'OBJECTID',
        fields: [
            { name: 'OBJECTID', alias: 'Object ID', type: 'oid' },
            { name: 'NAME', alias: 'Name', type: 'text' }
        ],
        max_record_count: 2000,
        provenance_sources: [{
            id: 'oshawa-hub', kind: 'arcgis-hub', name_en: 'Oshawa Hub',
            upstream_host: 'city-oshawa.opendata.arcgis.com', authoritative: true,
            license_title_en: 'Oshawa licence', license_url: 'https://example.test/licence'
        }]
    };
}

describe('bounded ArcGIS map service', () => {
    test('validates a WGS84 bbox', () => {
        expect(mapService.parseBbox('-79,43,-78,44')).toEqual([-79, 43, -78, 44]);
        expect(() => mapService.parseBbox('-78,43,-79,44')).toThrow(/bounds|WGS84/);
        expect(() => mapService.parseBbox('not,a,bbox')).toThrow(/bbox/);
    });

    test('serves a local PostGIS viewport with the same GeoJSON shape', async () => {
        const local = {
            ...row('local-map'), provider: 'canquery', source_version: 'v1',
            indexed_at: '2026-08-20T12:00:00Z',
            fields: [{ name: 'Street name', alias: 'Street name', type: 'text' }]
        };
        const queryLocalMap = jest.fn().mockResolvedValue([{
            feature_id: '7',
            geometry: { type: 'Point', coordinates: [-79.38, 43.65] },
            properties: { 'Street name': 'Queen' }
        }]);
        const result = await mapService.queryMap('local-map', {
            bbox: '-79.5,43.5,-79.2,43.8', zoom: '12', limit: '50'
        }, {
            getResourceMapById: async () => local,
            queryLocalMap,
            db: {}
        });
        expect(queryLocalMap).toHaveBeenCalledWith({}, expect.objectContaining({
            resourceId: 'local-map', bbox: [-79.5, 43.5, -79.2, 43.8], limit: 50
        }));
        expect(result.data.features[0]).toEqual(expect.objectContaining({
            id: '7', properties: { 'Street name': 'Queen' }
        }));
        expect(result.map).toEqual(expect.objectContaining({
            provider: 'canquery', indexed_at: '2026-08-20T12:00:00Z'
        }));
    });

    test('queries only the viewport and allowlisted fields, then sanitizes the response', async () => {
        let requestedUrl;
        const result = await mapService.queryMap('map-one', {
            bbox: '-79,43,-78,44', zoom: '11', limit: '100'
        }, {
            getResourceMapById: async () => row('map-one'),
            fetchJson: async url => {
                requestedUrl = new URL(url);
                return {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature', id: 1,
                        geometry: { type: 'Point', coordinates: [-78.8, 43.9] },
                        properties: { OBJECTID: 1, NAME: 'Park', SECRET: 'drop me' }
                    }]
                };
            }
        });
        expect(requestedUrl.searchParams.get('geometry')).toBe('-79,43,-78,44');
        expect(requestedUrl.searchParams.get('outFields')).toBe('OBJECTID,NAME');
        expect(requestedUrl.searchParams.get('resultRecordCount')).toBe('100');
        expect(result.data.features[0].properties).toEqual({ OBJECTID: 1, NAME: 'Park' });
        expect(result.provenance.primary_license.url).toBe('https://example.test/licence');
    });

    test('decodes a bounded PMTiles viewport through the same compatibility envelope', async () => {
        const pmtiles = {
            ...row('pmtiles-map'), provider: 'pmtiles', source_version: 'a'.repeat(64),
            storage_key: 'maps/private', storage_etag: 'etag', storage_sha256: 'b'.repeat(64),
            tile_min_zoom: 0, tile_max_zoom: 16, tile_layer: 'features'
        };
        const decodePmtilesViewport = jest.fn().mockResolvedValue({
            collection: { type: 'FeatureCollection', features: [] }, exceeded: false
        });
        const result = await mapService.queryMap('pmtiles-map', {
            bbox: '-114.2,50.9,-113.9,51.2', zoom: '10', limit: '25'
        }, {
            getResourceMapById: async () => pmtiles,
            decodePmtilesViewport
        });
        expect(decodePmtilesViewport).toHaveBeenCalledWith(pmtiles, {
            bbox: [-114.2, 50.9, -113.9, 51.2], zoom: 10, limit: 25
        }, {});
        expect(result.map.provider).toBe('pmtiles');
    });

    test('keeps the PMTiles compatibility response under the shared 8 MiB cap', async () => {
        const pmtiles = {
            ...row('pmtiles-cap'), provider: 'pmtiles', source_version: 'a'.repeat(64),
            storage_key: 'maps/private', storage_etag: 'etag', storage_sha256: 'b'.repeat(64),
            tile_min_zoom: 0, tile_max_zoom: 16, tile_layer: 'features'
        };
        await expect(mapService.queryMap('pmtiles-cap', {
            bbox: '-114.2,50.9,-113.9,51.2', zoom: '10', limit: '25'
        }, {
            getResourceMapById: async () => pmtiles,
            decodePmtilesViewport: async () => ({
                collection: {
                    type: 'FeatureCollection',
                    features: [{ type: 'Feature', geometry: null, properties: {
                        value: 'x'.repeat(8 * 1024 * 1024)
                    } }]
                },
                exceeded: false
            })
        })).rejects.toMatchObject({ statusCode: 413 });
    });

    test('uses honest errors for missing and oversized layers', async () => {
        await expect(mapService.queryMap('missing', { bbox: '-79,43,-78,44' }, {
            getResourceMapById: async () => null
        })).rejects.toMatchObject({ statusCode: 422 });
        const cap = new Error('too large');
        cap.code = 'UPSTREAM_JSON_CAP';
        await expect(mapService.queryMap('map-cap', { bbox: '-79,43,-78,44' }, {
            getResourceMapById: async () => row('map-cap'),
            fetchJson: async () => { throw cap; }
        })).rejects.toMatchObject({ statusCode: 413 });
    });
});
