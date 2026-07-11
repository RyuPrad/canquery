jest.mock('../db/pool', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    end: jest.fn()
}));
jest.mock('../db/longRunningPool', () => ({ end: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({ getResourceById: jest.fn() }));
jest.mock('../services/ingestPipeline', () => ({
    ingestResource: jest.fn(),
    validateStorageFilesystems: jest.fn()
}));
jest.mock('../db/ingestWorkerQueries', () => ({
    acquireWorkerLock: jest.fn(),
    releaseWorkerLock: jest.fn(),
    recoverOrphanedJobs: jest.fn(),
    claimJob: jest.fn(),
    heartbeatJob: jest.fn().mockResolvedValue(true),
    finishJob: jest.fn().mockResolvedValue(true),
    requeueJob: jest.fn()
}));

const pool = require('../db/pool');
const { getResourceById } = require('../db/catalogReadQueries');
const { ingestResource } = require('../services/ingestPipeline');
const { finishJob } = require('../db/ingestWorkerQueries');
const { processJob } = require('../scripts/ingest-worker');

describe('ingest worker reconciliation', () => {
    beforeEach(() => jest.clearAllMocks());

    it('repairs a crash-after-commit job without rebuilding the ready table', async () => {
        getResourceById.mockResolvedValue({
            id: 'resource-a',
            ingest_status: 'ready',
            table_name: 'r_a',
            ingested_row_count: '12',
            ingested_byte_size: '4096'
        });
        finishJob.mockResolvedValue(true);
        pool.query.mockResolvedValue({ rows: [] });

        await processJob({ id: 7, resource_id: 'resource-a', attempts: 2 }, 'worker-a');

        expect(ingestResource).not.toHaveBeenCalled();
        expect(finishJob).toHaveBeenCalledWith(
            pool,
            7,
            'worker-a',
            'resource-a',
            'done',
            null
        );
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO ingest_runs'),
            expect.arrayContaining(['resource-a', true, 12, 4096])
        );
    });
});
