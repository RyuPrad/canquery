const service = require('../services/pmtilesMapService');

function row() {
    return {
        provider: 'pmtiles', storage_key: 'maps/key', storage_etag: 'etag',
        source_version: 'a'.repeat(64), tile_min_zoom: 0, tile_max_zoom: 16,
        tile_layer: 'features', fields: [{ name: 'name', alias: 'Name' }]
    };
}

describe('PMTiles API reads', () => {
    afterEach(() => service.clearArchiveCache());

    test('requires the immutable catalogue version and valid XYZ coordinates', () => {
        expect(service.validateTile(row(), {
            version: 'a'.repeat(64), z: '5', x: '10', y: '12'
        })).toEqual({ z: 5, x: 10, y: 12 });
        expect(() => service.validateTile(row(), {
            version: 'b'.repeat(64), z: '5', x: '10', y: '12'
        })).toThrow(/version/);
        expect(() => service.validateTile(row(), {
            version: 'a'.repeat(64), z: '5', x: '32', y: '12'
        })).toThrow(/invalid/);
    });

    test('serves decoded tile bytes without exposing the storage key', async () => {
        const archive = { getZxy: jest.fn().mockResolvedValue({ data: Uint8Array.from([1, 2, 3]).buffer }) };
        await expect(service.getTile(row(), {
            version: 'a'.repeat(64), z: '0', x: '0', y: '0'
        }, { archive })).resolves.toEqual(Buffer.from([1, 2, 3]));
        expect(archive.getZxy).toHaveBeenCalledWith(0, 0, 0, expect.anything());
    });

    test('rejects a decompressed tile that exceeds the API response cap', async () => {
        const archive = {
            getZxy: jest.fn().mockResolvedValue({
                data: new Uint8Array(service.MAX_TILE_RESPONSE_BYTES + 1).buffer
            })
        };
        await expect(service.getTile(row(), {
            version: 'a'.repeat(64), z: '0', x: '0', y: '0'
        }, { archive })).rejects.toThrow(/response cap/);
    });

    test('caps compatibility viewport fanout at 64 tiles', () => {
        expect(service.tilesForBbox([-114.2, 50.9, -113.9, 51.2], 9).length).toBeLessThanOrEqual(64);
        expect(() => service.tilesForBbox([-180, -80, 180, 80], 5)).toThrow(/zoom in/);
        expect(service.intersects({ type: 'Point', coordinates: [-114, 51] }, [-115, 50, -113, 52])).toBe(true);
    });

    test('returns an empty compatibility collection for empty tiles', async () => {
        const archive = { getZxy: jest.fn().mockResolvedValue(null) };
        const result = await service.decodeViewport(row(), {
            bbox: [-114.2, 50.9, -113.9, 51.2], zoom: 9, limit: 100
        }, { archive });
        expect(result).toEqual({
            collection: { type: 'FeatureCollection', features: [] }, exceeded: false
        });
    });

    test('rejects an oversized compatibility tile before decoding it', async () => {
        const archive = {
            getZxy: jest.fn().mockResolvedValue({
                data: new Uint8Array(service.MAX_TILE_RESPONSE_BYTES + 1).buffer
            })
        };
        await expect(service.decodeViewport(row(), {
            bbox: [-114.001, 50.999, -114, 51], zoom: 16, limit: 100
        }, { archive })).rejects.toThrow(/response cap/);
    });
});
