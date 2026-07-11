const pool = require('./pool');
const { lockIngestResource } = require('./ingestResourceLock');

async function enqueueJob(resourceId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockIngestResource(client, resourceId);

        // This is a separate READ COMMITTED statement after the advisory lock,
        // so it observes a worker commit that happened while this request was
        // waiting. A single data-modifying CTE cannot do that: all of its CTEs
        // share one snapshot and can enqueue a refresh after a conflict vanishes.
        const loadedResult = await client.query(
            `SELECT resource_id, ingested_at, row_count
             FROM ingested_resources
             WHERE resource_id = $1 AND status = 'ready'`,
            [resourceId]
        );
        if (loadedResult.rows.length > 0) {
            const loaded = loadedResult.rows[0];
            // Clean up a redundant job left pending by an older API version or
            // an enqueue that lost a completion race before these locks existed.
            await client.query(
                `UPDATE ingest_jobs
                 SET status = 'done', error = NULL, finished_at = coalesce(finished_at, now())
                 WHERE resource_id = $1 AND status = 'pending'`,
                [resourceId]
            );
            await client.query('COMMIT');
            return {
                id: null,
                resource_id: loaded.resource_id,
                status: 'done',
                attempts: 0,
                error: null,
                claimed_at: null,
                finished_at: loaded.ingested_at,
                created_at: loaded.ingested_at,
                already_loaded: true,
                row_count: loaded.row_count
            };
        }

        const queuedResult = await client.query(
            `INSERT INTO ingest_jobs (resource_id)
             VALUES ($1)
             ON CONFLICT (resource_id) WHERE status IN ('pending','running')
             DO UPDATE SET resource_id = EXCLUDED.resource_id
             RETURNING id, resource_id, status, attempts, error,
                       claimed_at, finished_at, created_at`,
            [resourceId]
        );
        await client.query('COMMIT');
        return queuedResult.rows[0] || null;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

async function getJobById(id) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT id, resource_id, status, attempts, error, claimed_at, finished_at, created_at, EXTRACT(EPOCH FROM (now() - created_at))::int AS age_seconds FROM ingest_jobs WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    } finally {
        client.release();
    }
}

module.exports = { enqueueJob, getJobById };
