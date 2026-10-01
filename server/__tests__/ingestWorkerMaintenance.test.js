jest.mock('../db/pool', () => ({ connect: jest.fn(), end: jest.fn() }));
jest.mock('../db/longRunningPool', () => ({ end: jest.fn() }));
jest.mock('../services/ingestPipeline', () => ({ validateStorageFilesystems: jest.fn() }));
jest.mock('../services/retiredIngestTables', () => ({ cleanRetiredTables: jest.fn() }));
jest.mock('../services/evictService', () => ({ withStoreBudgetLock: jest.fn() }));
jest.mock('../db/ingestWorkerQueries', () => ({
    acquireWorkerLock: jest.fn(), releaseWorkerLock: jest.fn(),
    recoverOrphanedJobs: jest.fn(), claimJob: jest.fn()
}));

let fixture;
beforeEach(() => {
    const argv = process.argv;
    process.argv = [...argv, '--once'];
    try {
        jest.isolateModules(() => {
            const pool = require('../db/pool');
            const longPool = require('../db/longRunningPool');
            const worker = require('../scripts/ingest-worker');
            const queries = require('../db/ingestWorkerQueries');
            const eviction = require('../services/evictService');
            const retired = require('../services/retiredIngestTables');
            const client = { on: jest.fn(), release: jest.fn() };
            jest.clearAllMocks();
            pool.connect.mockResolvedValue(client);
            queries.acquireWorkerLock.mockResolvedValue(true);
            queries.recoverOrphanedJobs.mockResolvedValue({ rowCount: 0 });
            queries.claimJob.mockResolvedValue(null);
            retired.cleanRetiredTables.mockResolvedValue(undefined);
            eviction.withStoreBudgetLock.mockImplementation((_db, callback) => callback());
            fixture = { pool, longPool, worker, queries, eviction, retired, client };
        });
    } finally { process.argv = argv; }
});

test('busy idle cleanup skips immediately and still claims work under exclusive worker ownership', async () => {
    const { pool, longPool, worker, queries, eviction, retired, client } = fixture;
    eviction.withStoreBudgetLock.mockResolvedValue(null);
    queries.claimJob.mockImplementation(async () => {
        expect(queries.releaseWorkerLock).not.toHaveBeenCalled();
        expect(client.release).not.toHaveBeenCalled();
        return null;
    });
    await worker.main();
    expect(eviction.withStoreBudgetLock).toHaveBeenCalledWith(pool, expect.any(Function), { tryLock: true });
    expect(retired.cleanRetiredTables).not.toHaveBeenCalled();
    expect(queries.claimJob).toHaveBeenCalledTimes(1);
    expect(queries.releaseWorkerLock).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalled();
    expect(longPool.end).toHaveBeenCalled();
});

test('acquired idle cleanup completes before job claiming', async () => {
    const { worker, queries, retired } = fixture;
    queries.claimJob.mockImplementation(async () => {
        expect(retired.cleanRetiredTables).toHaveBeenCalledTimes(1);
        return null;
    });
    await worker.main();
    expect(queries.claimJob).toHaveBeenCalledTimes(1);
});

test.each(['57014', '08006'])('database acquisition failure %s propagates instead of becoming a busy skip', async code => {
    const { pool, longPool, worker, queries, eviction, retired, client } = fixture;
    const error = Object.assign(new Error('database failure'), { code });
    eviction.withStoreBudgetLock.mockRejectedValue(error);
    await expect(worker.main()).rejects.toBe(error);
    expect(retired.cleanRetiredTables).not.toHaveBeenCalled();
    expect(queries.claimJob).not.toHaveBeenCalled();
    expect(queries.releaseWorkerLock).toHaveBeenCalledWith(client);
    expect(pool.end).toHaveBeenCalled();
    expect(longPool.end).toHaveBeenCalled();
});

test('retirement failure propagates and does not continue with an unverified cleanup', async () => {
    const { worker, queries, retired } = fixture;
    const error = Object.assign(new Error('retirement database failure'), { code: '53100' });
    retired.cleanRetiredTables.mockRejectedValue(error);
    await expect(worker.main()).rejects.toBe(error);
    expect(queries.claimJob).not.toHaveBeenCalled();
});
