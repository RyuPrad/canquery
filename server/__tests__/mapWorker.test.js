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
    finishJob: jest.fn(), requeueJob: jest.fn(), getReadyMapState: jest.fn()
}));

const pool = require('../db/pool');
const mapQueries = require('../db/mapIndexQueries');
const { MapSkipError } = require('../services/mapIndexPipeline');
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
});
