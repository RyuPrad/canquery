const {
    WORKER_LOCK_KEYS,
    acquireWorkerLock,
    recoverOrphanedJobs,
    claimJob,
    heartbeatJob,
    finishJob,
    requeueJob
} = require('../db/ingestWorkerQueries');

describe('ingest worker leases', () => {
    test('uses one process-wide PostgreSQL advisory lock', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };

        await expect(acquireWorkerLock(db)).resolves.toBe(true);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('pg_try_advisory_lock'),
            WORKER_LOCK_KEYS
        );
    });

    test('requeues all running jobs immediately after exclusive startup', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rowCount: 2 }) };

        await expect(recoverOrphanedJobs(db)).resolves.toMatchObject({ rowCount: 2 });
        const sql = db.query.mock.calls[0][0];
        expect(sql).toContain("status = 'pending'");
        expect(sql).toContain("WHERE status = 'running'");
        expect(sql).toContain('worker_id = NULL');
        expect(sql).toContain('heartbeat_at = NULL');
    });

    test('claim records worker ownership and a heartbeat', async () => {
        const db = {
            query: jest.fn().mockResolvedValue({
                rows: [{ id: 7, resource_id: 'r-1', attempts: 1 }]
            })
        };

        await expect(claimJob(db, 'worker-a')).resolves.toEqual({
            id: 7,
            resource_id: 'r-1',
            attempts: 1
        });
        expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
        expect(db.query.mock.calls[0][0]).toContain('heartbeat_at = now()');
        expect(db.query.mock.calls[0][1]).toEqual(['worker-a']);
    });

    test('heartbeat and terminal transitions are guarded by the worker id', async () => {
        const client = {
            query: jest.fn(async (sql) => ({
                rows: [],
                rowCount: sql.includes('UPDATE ingest_jobs') ? 0 : undefined
            })),
            release: jest.fn()
        };
        const db = {
            query: jest.fn().mockResolvedValue({ rowCount: 0 }),
            connect: jest.fn().mockResolvedValue(client)
        };

        await expect(heartbeatJob(db, 7, 'stale-worker')).resolves.toBe(false);
        await expect(finishJob(db, 7, 'stale-worker', 'resource-1', 'done', null)).resolves.toBe(false);
        await expect(requeueJob(db, 7, 'stale-worker', 'failed')).resolves.toBe(false);

        for (const [sql, values] of db.query.mock.calls) {
            expect(sql).toContain("status = 'running'");
            expect(sql).toContain('worker_id = $2');
            expect(values.slice(0, 2)).toEqual([7, 'stale-worker']);
        }
        const transactionSql = client.query.mock.calls.map(call => call[0]);
        expect(transactionSql[0]).toBe('BEGIN');
        expect(transactionSql[1]).toContain('pg_advisory_xact_lock');
        expect(transactionSql[2]).toContain("status = 'running'");
        expect(client.query.mock.calls[2][1].slice(0, 2)).toEqual([7, 'stale-worker']);
        expect(transactionSql[3]).toBe('COMMIT');
        expect(client.release).toHaveBeenCalled();
    });
});
