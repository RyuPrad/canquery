jest.mock('../db/preparationAccounting', () => ({ settlePreparationOn: jest.fn() }));
const { settlePreparationOn } = require('../db/preparationAccounting');
const {
    WORKER_LOCK_KEYS,
    acquireWorkerLock,
    recoverOrphanedJobs,
    claimJob,
    heartbeatJob,
    finishJob,
    finishPublishedJob,
    requeueJob
} = require('../db/ingestWorkerQueries');

describe('ingest worker leases', () => {
    beforeEach(() => jest.clearAllMocks());
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
        expect(settlePreparationOn).not.toHaveBeenCalled();
    });

    test('settles a terminal transition in the same transaction after the guarded job update', async () => {
        const calls = [];
        const client = {
            query: jest.fn(async (sql) => {
                calls.push(sql);
                return { rowCount: sql.includes('UPDATE ingest_jobs') ? 1 : 0, rows: [] };
            }), release: jest.fn()
        };
        settlePreparationOn.mockImplementation(async (db, id) => {
            expect(db).toBe(client);
            expect(id).toBe(7);
            expect(calls.at(-1)).toContain('UPDATE ingest_jobs');
            calls.push('settled');
        });
        const db = { connect: jest.fn().mockResolvedValue(client) };
        await expect(finishJob(db, 7, 'worker-a', 'resource-1', 'failed', 'bad file', { code: 'INVALID_FILE', seconds: 86400 }))
            .resolves.toBe(true);
        expect(calls.slice(-2)).toEqual(['settled', 'COMMIT']);
        expect(calls[2]).toContain("CASE WHEN published_at IS NOT NULL THEN 'done'");
        expect(client.query.mock.calls[2][1]).toEqual([7, 'worker-a', 'failed', 'bad file', 'INVALID_FILE', 86400, 'resource-1', false]);
    });

    test('accounting failure rolls back the terminal transition for later recovery', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }), release: jest.fn() };
        const db = { connect: jest.fn().mockResolvedValue(client) };
        settlePreparationOn.mockRejectedValueOnce(new Error('accounting unavailable'));
        await expect(finishJob(db, 7, 'worker-a', 'resource-1', 'failed', 'bad file'))
            .rejects.toThrow('accounting unavailable');
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });

    test('ambiguous commit recovery only completes jobs with publication receipts', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }), release: jest.fn() };
        await expect(finishPublishedJob({ connect: async () => client }, 7, 'worker-a', 'resource-1')).resolves.toBe(false);
        expect(client.query.mock.calls[2][1].at(-1)).toBe(true);
        expect(client.query.mock.calls[2][0]).toContain('OR published_at IS NOT NULL');
        expect(settlePreparationOn).not.toHaveBeenCalled();
    });

    test('lost terminal commit acknowledgement rechecks the already-finished durable publication', async () => {
        const client = {
            query: jest.fn(async sql => ({ rowCount: 0, rows: sql.includes('SELECT id FROM ingest_jobs') ? [{ id: 7 }] : [] })),
            release: jest.fn()
        };
        settlePreparationOn.mockResolvedValueOnce({ outcome: 'succeeded', changed: false });
        await expect(finishPublishedJob({ connect: async () => client }, 7, 'worker-a', 'resource-1')).resolves.toBe(true);
        const read = client.query.mock.calls.find(([sql]) => sql.includes('SELECT id FROM ingest_jobs'));
        expect(read[0]).toContain("status = 'done'");
        expect(read[0]).toContain('published_at IS NOT NULL FOR UPDATE');
        expect(read[1]).toEqual([7, 'resource-1']);
        expect(settlePreparationOn).toHaveBeenCalledWith(client, 7);
        expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    });
});
