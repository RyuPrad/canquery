const {
    WORKER_LOCK_KEYS,
    acquireWorkerLock,
    recoverOrphanedJobs,
    claimJob,
    finishJob,
    requeueJob,
    upsertMapCandidates
} = require('../db/mapIndexQueries');

describe('versioned map-index queue', () => {
    test('uses a distinct process-wide advisory lock', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
        await expect(acquireWorkerLock(db)).resolves.toBe(true);
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), WORKER_LOCK_KEYS);
        expect(WORKER_LOCK_KEYS).not.toEqual([1667329649, 2003792491]);
    });

    test('candidate upsert preserves same-version terminal state and resets changed versions', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await upsertMapCandidates(db, [{ resourceId: 'r1', desiredVersion: 'v2', sourceUrl: 'https://example.test' }]);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toContain('map_index_jobs.desired_version = EXCLUDED.desired_version');
        expect(sql).toContain("ELSE 'pending'");
        expect(db.query.mock.calls[0][1][0]).toBe('r1');
    });

    test('recovers leases and claims one pending version with SKIP LOCKED', async () => {
        const db = { query: jest.fn()
            .mockResolvedValueOnce({ rowCount: 2 })
            .mockResolvedValueOnce({ rows: [{ resource_id: 'r1', claimed_version: 'v1', candidate: {}, attempts: 1 }] }) };
        await expect(recoverOrphanedJobs(db)).resolves.toMatchObject({ rowCount: 2 });
        await expect(claimJob(db, '00000000-0000-4000-8000-000000000001')).resolves.toEqual(expect.objectContaining({
            resource_id: 'r1', claimed_version: 'v1'
        }));
        expect(db.query.mock.calls[1][0]).toContain('FOR UPDATE SKIP LOCKED');
        expect(db.query.mock.calls[1][0]).toContain("candidate->>'expectedBytes'");
        expect(db.query.mock.calls[1][0]).toContain('NULLS LAST');
    });

    test('terminal and retry transitions are lease and version guarded', async () => {
        const db = { query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ status: 'pending' }] })
            .mockResolvedValueOnce({ rowCount: 1 }) };
        const job = { resource_id: 'r1', claimed_version: 'v1' };
        await expect(finishJob(db, job, 'worker', 'ready', { featureCount: 4 })).resolves.toEqual({ status: 'pending' });
        await expect(requeueJob(db, job, 'worker', 'temporary')).resolves.toBe(true);
        expect(db.query.mock.calls[0][0]).toContain("desired_version <> $3");
        expect(db.query.mock.calls[1][0]).toContain('desired_version = $3');
    });
});
