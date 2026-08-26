jest.mock('../db/pool', () => ({
    query: jest.fn(), connect: jest.fn(), end: jest.fn()
}));
jest.mock('../db/longRunningPool', () => ({ end: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({ getResourceById: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ datastoreSearch: jest.fn() }));
jest.mock('../services/mapIndexPipeline', () => {
    const actual = jest.requireActual('../services/mapIndexPipeline');
    return {
        ...actual,
        indexMapResource: jest.fn(),
        validateMapFilesystems: jest.fn()
    };
});
jest.mock('../db/mapIndexQueries', () => ({
    acquireWorkerLock: jest.fn(), releaseWorkerLock: jest.fn(),
    recoverOrphanedJobs: jest.fn(), reconcileMissingFeatures: jest.fn(),
    claimJob: jest.fn(), heartbeatJob: jest.fn().mockResolvedValue(true),
    finishJob: jest.fn(), requeueJob: jest.fn(), getReadyMapState: jest.fn(),
    listPmtilesMapObjects: jest.fn(), deletePmtilesMapMetadata: jest.fn(),
    requeueMissingPmtilesMaps: jest.fn()
}));

const pool = require('../db/pool');
const mapQueries = require('../db/mapIndexQueries');
const { MapSkipError } = require('../services/mapIndexPipeline');
const { getSource } = require('../config/catalogSources');
const { exportUrl } = require('../services/opendatasoftAdapter');
const { processJob, validateDirectGeoJson } = require('../scripts/map-worker');

const resource = {
    id: 'r1', url: 'https://example.test/r1.csv',
    raw: { source_id: 'toronto-open-data', upstream_resource_id: 'upstream-r1' }
};
const job = { resource_id: 'r1', claimed_version: 'v1', candidate: {}, attempts: 1 };

beforeEach(() => {
    jest.clearAllMocks();
    mapQueries.heartbeatJob.mockResolvedValue(true);
    mapQueries.getReadyMapState.mockResolvedValue(null);
});

describe('map worker transitions', () => {
    test('lets the indexing transaction make the ready transition atomically', async () => {
        const index = jest.fn().mockResolvedValue({ queueStatus: 'ready', featureCount: 2, vertexCount: 3 });
        await processJob(job, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => resource,
            probeGeometry: async () => ({ total: 2, fields: [{ id: 'geometry' }] }),
            indexMapResource: index,
            caps: { maxRows: 10 }
        });
        expect(index).toHaveBeenCalled();
        expect(mapQueries.finishJob).not.toHaveBeenCalled();
        expect(mapQueries.requeueJob).not.toHaveBeenCalled();
    });

    test('records expected cap failures as skipped without retrying', async () => {
        await processJob(job, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => resource,
            probeGeometry: async () => { throw new MapSkipError('too many vertices'); }
        });
        expect(mapQueries.finishJob).toHaveBeenCalledWith(
            pool, job, expect.any(String), 'skipped', {}, 'MAP_CAP: too many vertices'
        );
        expect(mapQueries.requeueJob).not.toHaveBeenCalled();
    });

    test('indexes a catalogued direct GeoJSON without probing DataStore', async () => {
        const directResource = {
            id: 'r2', url: 'https://donnees.montreal.ca/r2.geojson', datastore_active: false,
            raw: {
                source_id: 'montreal-open-data', upstream_resource_id: 'upstream-r2',
                original_format: 'GEOJSON'
            }
        };
        const directJob = {
            ...job, resource_id: 'r2',
            candidate: { mode: 'geojson-file', sourceUrl: directResource.url }
        };
        const probe = jest.fn();
        const index = jest.fn().mockResolvedValue({ queueStatus: 'ready', featureCount: 1, vertexCount: 1 });
        await processJob(directJob, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => directResource,
            probeGeometry: probe,
            indexMapResource: index,
            validateDirectGeoJson
        });
        expect(probe).not.toHaveBeenCalled();
        expect(index).toHaveBeenCalled();

        expect(() => validateDirectGeoJson(directResource, {
            sourceUrl: 'https://attacker.example/map.geojson'
        })).toThrow(MapSkipError);
    });

    test('reconstructs the Opendatasoft GeoJSON export instead of trusting the candidate URL', async () => {
        const source = getSource('vancouver-open-data');
        const upstreamId = 'public-trees';
        const csvUrl = exportUrl(source, upstreamId, 'csv');
        const geoJsonUrl = exportUrl(source, upstreamId, 'geojson');
        const directResource = {
            id: 'r-vancouver', url: csvUrl, format: 'CSV', datastore_active: false,
            raw: {
                provider: 'opendatasoft', source_id: source.id,
                upstream_dataset_id: upstreamId, dataset_uid: 'da_trees',
                original_format: 'CSV'
            }
        };
        const candidate = {
            mode: 'geojson-file', sourceUrl: geoJsonUrl, expectedRows: 42,
            raw: {
                provider: 'opendatasoft', source_id: source.id,
                upstream_dataset_id: upstreamId, dataset_uid: 'da_trees'
            }
        };
        const directJob = { ...job, resource_id: directResource.id, candidate };
        const probe = jest.fn();
        const index = jest.fn().mockResolvedValue({ queueStatus: 'ready', featureCount: 1, vertexCount: 1 });

        await processJob(directJob, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => directResource,
            probeGeometry: probe,
            indexMapResource: index,
            validateDirectGeoJson
        });

        expect(probe).not.toHaveBeenCalled();
        expect(index).toHaveBeenCalledWith(
            expect.objectContaining({ id: directResource.id, url: geoJsonUrl }),
            directJob,
            '00000000-0000-4000-8000-000000000001',
            undefined
        );
        expect(csvUrl).not.toBe(geoJsonUrl);
    });

    test('skips a mismatched Opendatasoft map URL before invoking the downloader', async () => {
        const source = getSource('vancouver-open-data');
        const upstreamId = 'public-trees';
        const directResource = {
            id: 'r-vancouver-bad', url: exportUrl(source, upstreamId, 'csv'),
            format: 'CSV', datastore_active: false,
            raw: {
                provider: 'opendatasoft', source_id: source.id,
                upstream_dataset_id: upstreamId, original_format: 'CSV'
            }
        };
        const directJob = {
            ...job,
            resource_id: directResource.id,
            candidate: {
                mode: 'geojson-file', sourceUrl: 'https://attacker.example/map.geojson',
                raw: {
                    provider: 'opendatasoft', source_id: source.id,
                    upstream_dataset_id: upstreamId
                }
            }
        };
        const index = jest.fn();

        await processJob(directJob, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => directResource,
            indexMapResource: index,
            validateDirectGeoJson
        });

        expect(index).not.toHaveBeenCalled();
        expect(mapQueries.finishJob).toHaveBeenCalledWith(
            pool, directJob, expect.any(String), 'skipped', {},
            expect.stringContaining('MAP_SOURCE')
        );
        expect(mapQueries.requeueJob).not.toHaveBeenCalled();
    });

    test('retries transient failures and marks the third attempt failed', async () => {
        const options = {
            getResourceById: async () => resource,
            probeGeometry: async () => { throw new Error('temporary upstream failure'); }
        };
        await processJob(job, '00000000-0000-4000-8000-000000000001', options);
        expect(mapQueries.requeueJob).toHaveBeenCalledWith(pool, job, expect.any(String), 'temporary upstream failure');

        const finalJob = { ...job, attempts: 3 };
        await processJob(finalJob, '00000000-0000-4000-8000-000000000001', options);
        expect(mapQueries.finishJob).toHaveBeenCalledWith(
            pool, finalJob, expect.any(String), 'failed', {}, 'temporary upstream failure'
        );
    });

    test('skips a permanently missing catalogued download without retrying', async () => {
        const error = Object.assign(new Error('download failed: HTTP 404'), {
            code: 'DOWNLOAD_HTTP', httpStatus: 404
        });
        await processJob(job, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => resource,
            probeGeometry: async () => ({ total: 1, fields: [{ id: 'geometry' }] }),
            indexMapResource: async () => { throw error; }
        });
        expect(mapQueries.finishJob).toHaveBeenCalledWith(
            pool, job, expect.any(String), 'skipped', {},
            'DOWNLOAD_HTTP: download failed: HTTP 404'
        );
        expect(mapQueries.requeueJob).not.toHaveBeenCalled();
    });

    test('builds Socrata PMTiles without passing a queued URL to the PostGIS indexer', async () => {
        const pmtilesResource = {
            id: 'socrata-calgary-open-data-resource-abcd-1234',
            url: 'https://data.calgary.ca/api/views/abcd-1234/rows.csv?accessType=DOWNLOAD',
            format: 'CSV', datastore_active: false,
            raw: {
                provider: 'socrata', source_id: 'calgary-open-data',
                upstream_dataset_id: 'abcd-1234'
            }
        };
        const pmtilesJob = {
            ...job, resource_id: pmtilesResource.id,
            candidate: {
                mode: 'socrata-geojson-pmtiles',
                sourceUrl: 'https://data.calgary.ca/resource/abcd-1234.geojson',
                raw: {
                    provider: 'socrata', source_id: 'calgary-open-data',
                    upstream_dataset_id: 'abcd-1234'
                }
            }
        };
        const build = jest.fn().mockResolvedValue({
            queueStatus: 'ready', featureCount: 2, vertexCount: 2
        });
        const index = jest.fn();
        await processJob(pmtilesJob, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => pmtilesResource,
            buildPmtilesResource: build,
            indexMapResource: index
        });
        expect(build).toHaveBeenCalledWith(pmtilesResource, pmtilesJob, expect.any(String), undefined, {});
        expect(index).not.toHaveBeenCalled();
    });

    test('skips stale Socrata PMTiles work without retrying the unchanged candidate', async () => {
        const staleJob = {
            ...job,
            candidate: { mode: 'socrata-geojson-pmtiles' }
        };
        await processJob(staleJob, '00000000-0000-4000-8000-000000000001', {
            getResourceById: async () => resource,
            buildPmtilesResource: async () => {
                throw new MapSkipError('source changed', 'MAP_SOURCE_CHANGED');
            }
        });
        expect(mapQueries.finishJob).toHaveBeenCalledWith(
            pool, staleJob, expect.any(String), 'skipped', {},
            'MAP_SOURCE_CHANGED: source changed'
        );
        expect(mapQueries.requeueJob).not.toHaveBeenCalled();
    });
});
