// Two signed int32 keys spelling "canq" / "work". A session-level advisory
// lock held on a dedicated client prevents two worker processes from draining
// the same queue concurrently.
const WORKER_LOCK_KEYS = [1667329649, 2003792491];
const { lockIngestResource } = require('./ingestResourceLock');
const { settlePreparationOn } = require('./preparationAccounting');

async function acquireWorkerLock(db) {
    const result = await db.query(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        WORKER_LOCK_KEYS
    );
    return result.rows[0].acquired === true;
}

async function releaseWorkerLock(db) {
    const result = await db.query(
        'SELECT pg_advisory_unlock($1, $2) AS released',
        WORKER_LOCK_KEYS
    );
    return result.rows[0].released === true;
}

// This is only safe after acquireWorkerLock succeeds. At that point no other
// advisory-lock-aware worker can still own a running job, so restart recovery is
// immediate rather than waiting for an arbitrary one-hour age threshold.
async function recoverOrphanedJobs(db) {
    return db.query(`
        UPDATE ingest_jobs
        SET status = 'pending',
            error = 'requeued after worker restart',
            claimed_at = NULL,
            finished_at = NULL,
            worker_id = NULL,
            heartbeat_at = NULL
        WHERE status = 'running'
    `);
}

async function claimJob(db, workerId) {
    const result = await db.query(`
        UPDATE ingest_jobs
        SET status = 'running',
            claimed_at = now(),
            finished_at = NULL,
            worker_id = $1,
            heartbeat_at = now(),
            attempts = attempts + 1
        WHERE id = (
            SELECT id
            FROM ingest_jobs
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, resource_id, attempts, preparation, source_version,
            published_table_name, published_source_version, published_at
    `, [workerId]);
    return result.rows[0] || null;
}

async function heartbeatJob(db, id, workerId) {
    const result = await db.query(`
        UPDATE ingest_jobs
        SET heartbeat_at = now()
        WHERE id = $1 AND status = 'running' AND worker_id = $2
    `, [id, workerId]);
    return result.rowCount === 1;
}

async function finishJob(db, id, workerId, resourceId, status, error, failure = {}, publishedOnly = false) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await lockIngestResource(client, resourceId);
        const result = await client.query(`
            UPDATE ingest_jobs
            SET status = CASE WHEN published_at IS NOT NULL THEN 'done' ELSE $3 END,
                error = CASE WHEN published_at IS NOT NULL THEN NULL ELSE $4 END,
                finished_at = now(),
                heartbeat_at = now(),
                failure_code = CASE WHEN published_at IS NOT NULL THEN NULL ELSE $5 END,
                retry_at = CASE WHEN published_at IS NOT NULL OR $6::int IS NULL THEN NULL
                    ELSE now() + $6 * interval '1 second' END
            WHERE id = $1 AND status = 'running' AND worker_id = $2 AND resource_id = $7
                AND (NOT $8::boolean OR published_at IS NOT NULL)
            RETURNING id
        `, [id, workerId, status, error, failure.code || null, failure.seconds || null, resourceId, publishedOnly]);
        if (result.rowCount === 1) await settlePreparationOn(client, id);
        await client.query('COMMIT');
        return result.rowCount === 1;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

// Read the publication proof and finish under the same resource/job locks. A
// failed COMMIT acknowledgement must not turn a published result into a refund.
function finishPublishedJob(db, id, workerId, resourceId) {
    return finishJob(db, id, workerId, resourceId, 'done', null, {}, true);
}

async function requeueJob(db, id, workerId, error, delaySeconds = 0) {
    const result = await db.query(`
        UPDATE ingest_jobs
        SET status = 'pending',
            error = $3,
            claimed_at = NULL,
            finished_at = NULL,
            worker_id = NULL,
            heartbeat_at = NULL,
            next_attempt_at = now() + $4 * interval '1 second'
        WHERE id = $1 AND status = 'running' AND worker_id = $2 AND published_at IS NULL
    `, [id, workerId, error, delaySeconds]);
    return result.rowCount === 1;
}

module.exports = {
    WORKER_LOCK_KEYS,
    acquireWorkerLock,
    releaseWorkerLock,
    recoverOrphanedJobs,
    claimJob,
    heartbeatJob,
    finishJob,
    finishPublishedJob,
    requeueJob
};
