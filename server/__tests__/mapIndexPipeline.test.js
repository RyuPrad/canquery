const { once } = require('node:events');
const { parse } = require('csv-parse');
const { csvParseOptions } = require('../services/csvLoad');
const {
    MapSkipError,
    geometryVertexCount,
    selectPropertyFields,
    stagingTransform,
    validateCandidate
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
