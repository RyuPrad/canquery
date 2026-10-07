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
    finishPublishedJob: jest.fn().mockResolvedValue(false),
    requeueJob: jest.fn()
}));

const pool = require('../db/pool');
const { getResourceById } = require('../db/catalogReadQueries');
const { ingestResource } = require('../services/ingestPipeline');
const { finishJob, finishPublishedJob, requeueJob } = require('../db/ingestWorkerQueries');
const { processJob } = require('../scripts/ingest-worker');

describe('ingest worker reconciliation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        finishPublishedJob.mockResolvedValue(false);
    });

    it('a durable publication survives catalogue removal or expiry before worker recovery', async () => {
        getResourceById.mockResolvedValue(null);
        await processJob({ id: 7, resource_id: 'resource-a', attempts: 2,
            published_at: '2026-10-07T00:00:00Z', published_table_name: 'r_published' }, 'worker-a');
        expect(getResourceById).not.toHaveBeenCalled();
        expect(ingestResource).not.toHaveBeenCalled();
        expect(finishJob).toHaveBeenCalledWith(pool, 7, 'worker-a', 'resource-a', 'done', null);
        expect(requeueJob).not.toHaveBeenCalled();
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ingest_runs'),
            expect.arrayContaining(['resource-a', true]));
    });

    it('checks a publication receipt before interpreting a commit error as a failed attempt', async () => {
        getResourceById.mockResolvedValue({ id: 'resource-a', format: 'CSV', url: 'https://example.org/a.csv' });
        ingestResource.mockRejectedValueOnce(Object.assign(new Error('commit acknowledgement lost'), { code: '08006' }));
        finishPublishedJob.mockResolvedValueOnce(true);
        await processJob({ id: 8, resource_id: 'resource-a', preparation: true, attempts: 3 }, 'worker-a');
        expect(ingestResource).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), { jobId: 8, workerId: 'worker-a' });
        expect(finishPublishedJob).toHaveBeenCalledWith(pool, 8, 'worker-a', 'resource-a');
        expect(finishJob).not.toHaveBeenCalled();
        expect(requeueJob).not.toHaveBeenCalled();
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ingest_runs'),
            expect.arrayContaining(['resource-a', true]));
    });

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

    it.each([
        ['CAP_ROWS', 1, 86400, 'INVALID_FILE'],
        ['CSV_EMPTY', 1, 86400, 'INVALID_FILE'],
        ['CSV_INVALID_CLOSING_QUOTE', 1, 86400, 'INVALID_FILE'],
        ['DISK_FREE', 1, 3600, 'CAPACITY'],
        ['BUDGET', 1, 3600, 'CAPACITY'],
        ['DOWNLOAD_DNS', 1, 86400, 'UPSTREAM_UNAVAILABLE'],
        ['ETIMEDOUT', 3, 3600, 'TEMPORARY']
    ])('records a bounded cooldown for %s', async (code, attempts, seconds, failureCode) => {
        getResourceById.mockResolvedValue({ id: 'resource-a', format: 'CSV', url: 'https://example.org/a.csv' });
        ingestResource.mockRejectedValue(Object.assign(new Error('private failure detail'), { code }));
        await processJob({ id: 8, resource_id: 'resource-a', preparation: true, attempts }, 'worker-a');
        expect(requeueJob).not.toHaveBeenCalled();
        expect(finishJob).toHaveBeenCalledWith(pool, 8, 'worker-a', 'resource-a', 'failed', 'private failure detail',
            { code: failureCode, seconds });
    });

    it('delays transient retries instead of immediately redownloading', async () => {
        getResourceById.mockResolvedValue({ id: 'resource-a', format: 'CSV', url: 'https://example.org/a.csv' });
        ingestResource.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'XLSX_TIMEOUT' }));
        requeueJob.mockResolvedValue(true);
        await processJob({ id: 8, resource_id: 'resource-a', preparation: true, attempts: 1 }, 'worker-a');
        expect(requeueJob).toHaveBeenCalledWith(pool, 8, 'worker-a', 'timeout', 30);
        expect(finishJob).not.toHaveBeenCalled();
    });

    it('respects a bounded publisher delay for a temporary HTTP failure', async () => {
        getResourceById.mockResolvedValue({ id: 'resource-a', format: 'CSV', url: 'https://example.org/a.csv' });
        ingestResource.mockRejectedValue(Object.assign(new Error('HTTP 503'), {
            code: 'DOWNLOAD_HTTP', httpStatus: 503, retryAfterMs: 7200000
        }));
        await processJob({ id: 8, resource_id: 'resource-a', preparation: true, attempts: 1 }, 'worker-a');
        expect(requeueJob).toHaveBeenCalledWith(pool, 8, 'worker-a', 'HTTP 503', 1800);
        expect(finishJob).not.toHaveBeenCalled();
    });
});
