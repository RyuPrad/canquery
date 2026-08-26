const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { getSource } = require('../config/catalogSources');
const { csvUrl, geoJsonBaseUrl } = require('../services/socrataAdapter');
const {
    selectFields,
    validateSocrataCandidate,
    downloadSocrataFeatures,
    runTippecanoe,
    commitPmtilesMap
} = require('../services/pmtilesMapPipeline');

const source = getSource('calgary-open-data');
const resource = {
    id: 'socrata-calgary-open-data-resource-abcd-1234',
    url: csvUrl(source, 'abcd-1234'), format: 'CSV',
    raw: { provider: 'socrata', source_id: source.id, upstream_dataset_id: 'abcd-1234' }
};
const candidate = {
    mode: 'socrata-geojson-pmtiles', sourceUrl: geoJsonBaseUrl(source, 'abcd-1234'),
    expectedRows: 2,
    raw: {
        provider: 'socrata', source_id: source.id, upstream_dataset_id: 'abcd-1234',
        geometry_fields: [{ name: 'point' }]
    }
};

describe('PMTiles map pipeline', () => {
    test('reconstructs Socrata endpoints instead of trusting queued URLs', () => {
        expect(validateSocrataCandidate(resource, candidate)).toEqual(expect.objectContaining({
            source, datasetId: 'abcd-1234'
        }));
        expect(() => validateSocrataCandidate(resource, {
            ...candidate, sourceUrl: 'https://attacker.example/map.geojson'
        })).toThrow(/catalogued exports/);
    });

    test('selects at most 20 scalar popup columns with useful fields first', () => {
        const columns = Array.from({ length: 25 }, (_, index) => ({
            fieldName: index === 24 ? 'name' : 'field_' + index,
            name: index === 24 ? 'Name' : 'Field ' + index,
            dataTypeName: 'text'
        })).concat([{ fieldName: 'point', name: 'Point', dataTypeName: 'point' }]);
        const fields = selectFields({ columns }, new Set(['point']));
        expect(fields).toHaveLength(20);
        expect(fields[0].name).toBe('name');
        expect(fields.some(field => field.name === 'point')).toBe(false);
    });

    test('streams sequential bounded GeoJSON pages into newline-delimited features', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pmtiles-input-test-'));
        const inputPath = path.join(dir, 'features.geojsonseq');
        const fetchJson = jest.fn(async value => {
            const url = new URL(value);
            const offset = Number(url.searchParams.get('$offset'));
            return {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature', id: offset + 1,
                    geometry: { type: 'Point', coordinates: [-114 + offset, 51] },
                    properties: { name: 'Feature ' + offset, nested: { drop: true } }
                }]
            };
        });
        try {
            const result = await downloadSocrataFeatures({
                resource, candidate, inputPath,
                caps: {
                    pageSize: 1, maxRows: 10, maxVertices: 10, maxFeatureVertices: 10,
                    maxFileBytes: 1024 * 1024, fetchJson, userAgent: 'test'
                },
                view: { columns: [
                    { fieldName: 'name', name: 'Name', dataTypeName: 'text' },
                    { fieldName: 'point', name: 'Point', dataTypeName: 'point' }
                ] },
                source, datasetId: 'abcd-1234'
            });
            expect(fetchJson).toHaveBeenCalledTimes(2);
            expect(result).toEqual(expect.objectContaining({
                rowCount: 2, featureCount: 2, vertexCount: 2,
                geometryType: 'point', extent: [-114, 51, -113, 51]
            }));
            const lines = (await fs.promises.readFile(inputPath, 'utf8')).trim().split('\n').map(JSON.parse);
            expect(lines).toHaveLength(2);
            expect(lines[0].properties).toEqual({ name: 'Feature 0' });
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });

    test('invokes Tippecanoe with fixed zoom, layer, drop, and tile-byte bounds', async () => {
        let invocation;
        const spawnImpl = (command, args) => {
            invocation = { command, args };
            const child = new EventEmitter();
            child.stderr = new PassThrough();
            child.kill = jest.fn();
            process.nextTick(() => child.emit('exit', 0, null));
            return child;
        };
        await runTippecanoe('/tmp/input', '/tmp/output.pmtiles', {
            tippecanoePath: '/opt/tippecanoe', buildTimeoutMs: 1000
        }, { spawnImpl });
        expect(invocation.command).toBe('/opt/tippecanoe');
        expect(invocation.args).toEqual(expect.arrayContaining([
            '--minimum-zoom=0', '--maximum-zoom=16', '--layer=features',
            '--drop-densest-as-needed', '--maximum-tile-bytes=500000'
        ]));
        expect(invocation.args).not.toContain('--extend-zooms-if-still-dropping');
    });

    test('commits object metadata and queue readiness in one transaction', async () => {
        const client = {
            query: jest.fn(async sql => {
                if (sql.includes('SELECT desired_version')) return { rowCount: 1, rows: [{ desired_version: 'v1' }] };
                if (sql.includes('RETURNING status')) return { rowCount: 1, rows: [{ status: 'ready' }] };
                return { rowCount: 1, rows: [] };
            }),
            release: jest.fn()
        };
        const db = { connect: jest.fn().mockResolvedValue(client) };
        const status = await commitPmtilesMap({
            db, resource,
            job: { resource_id: resource.id, claimed_version: 'a'.repeat(64) },
            workerId: '00000000-0000-4000-8000-000000000001',
            result: { geometryType: 'point', fields: [], featureCount: 2, vertexCount: 2, downloadedBytes: 200 },
            archive: { extent: [-114, 51, -113, 52], header: { minZoom: 0, maxZoom: 16 } },
            object: { key: 'maps/key', etag: 'etag', sha256: 'b'.repeat(64), byteSize: 100 },
            sourceUrl: candidate.sourceUrl
        });
        expect(status).toBe('ready');
        expect(client.query.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
            'BEGIN', 'COMMIT', expect.stringContaining("VALUES (\n                $1,'pmtiles'")
        ]));
        expect(client.query.mock.calls.some(call => call[0].includes('DELETE FROM map_store.features'))).toBe(true);
    });
});
