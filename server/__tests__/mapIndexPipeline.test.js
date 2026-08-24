const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('csv-parse');
const { csvParseOptions } = require('../services/csvLoad');
const {
    MapSkipError,
    geometryVertexCount,
    selectPropertyFields,
    selectGeoJsonPropertyFields,
    stagingTransform,
    geoJsonStagingTransform,
    validateCandidate,
    candidateMode,
    sourceSridFromCrs,
    inspectGeoJsonFile,
    validWgs84Extent
} = require('../services/mapIndexPipeline');

describe('bounded local-map conversion', () => {
    test('counts vertices across standard and collection GeoJSON', () => {
        expect(geometryVertexCount({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBe(2);
        expect(geometryVertexCount({
            type: 'GeometryCollection', geometries: [
                { type: 'Point', coordinates: [0, 0] },
                { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }
            ]
        })).toBe(4);
    });

    test('prioritizes useful scalar popup fields and excludes geometry/blob columns', () => {
        const headers = ['_id', 'description', 'Ward', 'geometry', 'payload', 'Address'];
        const fields = selectPropertyFields(headers, {
            description: 'short', Ward: '4', geometry: '{}', payload: '{"large":true}', Address: '1 Queen St'
        }, 'geometry');
        expect(fields.map(field => field.name)).toEqual(['Ward', 'Address', 'description']);
    });

    test('streams valid geometry, drops malformed rows and enforces vertex caps', async () => {
        let metadata;
        const transform = stagingTransform({
            caps: { maxRows: 10, maxVertices: 10 },
            onMetadata: value => { metadata = value; }
        });
        const chunks = [];
        transform.on('data', chunk => chunks.push(chunk.toString()));
        transform.write({ _id: '1', Name: 'Park', geometry: '{bad json' });
        transform.write({ _id: '2', Name: 'Trail', geometry: JSON.stringify({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }) });
        transform.end();
        await once(transform, 'end');
        expect(transform.result()).toEqual(expect.objectContaining({
            rowCount: 2, featureCount: 1, vertexCount: 2, invalidCount: 1,
            geometryType: 'polyline'
        }));
        expect(metadata.fields[0].name).toBe('Name');
        expect(chunks.join('')).toContain('Trail');

        expect(() => validateCandidate({ expectedRows: 11 }, { maxRows: 10, maxVertices: 100 }))
            .toThrow(MapSkipError);
        expect(() => validateCandidate({ expectedBytes: 101 }, {
            maxRows: 10, maxVertices: 100, maxFileBytes: 100
        })).toThrow(MapSkipError);
    });

    test('keeps legacy candidate mode while validating explicit modes', () => {
        expect(candidateMode({})).toBe('ckan-datastore-csv');
        expect(candidateMode({ mode: 'geojson-file' })).toBe('geojson-file');
        expect(() => candidateMode({ mode: 'remote-url' })).toThrow(MapSkipError);
    });

    test('recognizes supported named CRSs and rejects unsupported declarations', () => {
        expect(sourceSridFromCrs({ present: false })).toBe(4326);
        expect(sourceSridFromCrs({ present: true, isNull: true })).toBe(4326);
        expect(sourceSridFromCrs({
            present: true, type: 'name', name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
        })).toBe(4326);
        expect(sourceSridFromCrs({
            present: true, type: 'name', name: 'urn:ogc:def:crs:EPSG::32188'
        })).toBe(32188);
        expect(() => sourceSridFromCrs({ present: true, type: 'link', name: 'EPSG:2950' }))
            .toThrow(MapSkipError);
    });

    test('inspects a FeatureCollection without assembling its features', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'canquery-map-test-'));
        const projected = path.join(dir, 'projected.geojson');
        const defaultCrs = path.join(dir, 'default.geojson');
        try {
            await fs.promises.writeFile(projected, JSON.stringify({
                type: 'FeatureCollection',
                crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2950' } },
                features: []
            }));
            await fs.promises.writeFile(defaultCrs, JSON.stringify({
                type: 'FeatureCollection', features: []
            }));
            await expect(inspectGeoJsonFile(projected)).resolves.toEqual({
                sourceSrid: 2950, crsName: 'urn:ogc:def:crs:EPSG::2950'
            });
            await expect(inspectGeoJsonFile(defaultCrs)).resolves.toEqual({
                sourceSrid: 4326, crsName: null
            });
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });

    test('streams Feature objects and keeps only bounded scalar popup fields', async () => {
        let metadata;
        const transform = geoJsonStagingTransform({
            caps: { maxRows: 10, maxVertices: 10 },
            onMetadata: value => { metadata = value; }
        });
        const chunks = [];
        transform.on('data', chunk => chunks.push(chunk.toString()));
        transform.write({ key: 0, value: { type: 'Feature', geometry: null, properties: {} } });
        transform.write({
            key: 1,
            value: {
                type: 'Feature', geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
                properties: { Name: 'Station', nested: { secret: true }, values: [1, 2], year: 2026 }
            }
        });
        transform.end();
        await once(transform, 'end');
        expect(transform.result()).toEqual(expect.objectContaining({
            rowCount: 2, featureCount: 1, vertexCount: 1, invalidCount: 1,
            geometryType: 'point'
        }));
        expect(metadata.fields.map(field => field.name)).toEqual(['Name', 'year']);
        expect(chunks.join('')).toContain('Station');
        expect(chunks.join('')).not.toContain('secret');
        expect(selectGeoJsonPropertyFields({ payload: {}, Address: 'Main' }).map(field => field.name))
            .toEqual(['Address']);
    });

    test('rejects one oversized feature before PostGIS conversion', async () => {
        const transform = geoJsonStagingTransform({
            caps: { maxRows: 10, maxVertices: 10, maxFeatureVertices: 2 },
            onMetadata: () => {}
        });
        const failed = once(transform, 'error');
        transform.end({
            key: 0,
            value: {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] },
                properties: {}
            }
        });
        const [error] = await failed;
        expect(error).toBeInstanceOf(MapSkipError);
        expect(error).toMatchObject({ code: 'MAP_VERTICES' });
        expect(error.message).toContain('feature vertex count exceeds map cap 2');
    });

    test('validates transformed WGS84 extents', () => {
        expect(validWgs84Extent([-74, 45, -73, 46])).toBe(true);
        expect(validWgs84Extent([277000, 5040000, 300000, 5060000])).toBe(false);
        expect(validWgs84Extent(null)).toBe(false);
    });

    test('accepts CKAN exports that mix CRLF headers with LF records', async () => {
        const csv = '_id,Name,Description,geometry\r\n' +
            '1,Park,"first line\nsecond line","{""type"":""Point"",""coordinates"":[-79.38,43.65]}"\n' +
            '2,Trail,short,"{""type"":""LineString"",""coordinates"":[[-79.4,43.6],[-79.3,43.7]]}"\n';
        let metadata;
        const parser = parse(csvParseOptions({ columns: true, delimiter: ',' }));
        const transform = stagingTransform({
            caps: { maxRows: 10, maxVertices: 10 },
            onMetadata: value => { metadata = value; }
        });
        transform.on('data', () => {});
        const ended = once(transform, 'end');
        parser.pipe(transform);
        parser.end(csv);
        await ended;

        expect(transform.result()).toEqual(expect.objectContaining({
            rowCount: 2, featureCount: 2, vertexCount: 3
        }));
        expect(metadata.geometryColumn).toBe('geometry');
    });
});
