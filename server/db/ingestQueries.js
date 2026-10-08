const pool = require('./pool');
const { lockIngestResource } = require('./ingestResourceLock');
const AppError = require('../utils/AppError');
const { chargePreparation } = require('./commercialQueries');
const { settlePreparationOn } = require('./preparationAccounting');

async function enqueueJob(resourceId, commercial = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockIngestResource(client, resourceId);

        // Retirement can finish while admission waits for its resource lock.
        // Recheck both public identities after that wait and retain row locks
        // until admission commits so a concurrent removal cannot orphan a job.
        const resource = await client.query('SELECT public.canquery_lock_public_resource($1) AS present', [resourceId]);
        if (!resource.rows[0]?.present) throw new AppError('Resource not found', 404);

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
            // Complete only redundant legacy work. A preparation refresh can
            // legitimately remain pending while this older snapshot serves.
            const completed = await client.query(
                `UPDATE ingest_jobs
                 SET status = 'done', error = NULL, finished_at = coalesce(finished_at, now())
                 WHERE resource_id = $1 AND status = 'pending' AND NOT preparation
                 RETURNING id`,
                [resourceId]
            );
            for (const job of completed.rows) await settlePreparationOn(client, job.id);
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

        if (commercial) {
            const existing = await client.query("SELECT * FROM ingest_jobs WHERE resource_id=$1 AND status IN ('pending','running')",[resourceId]);
            if (existing.rows[0]) {
                await client.query('COMMIT');
                return existing.rows[0];
            }
            await client.query("SELECT pg_advisory_xact_lock(hashtext('canquery-prepare-admission'))");
            const active = await client.query("SELECT count(*)::int AS active FROM ingest_jobs WHERE status IN ('pending','running')");
            const ceiling = Number(process.env.AUTO_PREPARE_MAX_ACTIVE) || 10;
            if (active.rows[0].active >= ceiling) throw new AppError('Preparation queue is busy',429);
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
        await chargePreparation(client, commercial, queuedResult.rows[0].id);
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
            `SELECT id, resource_id, status, attempts, error, failure_code, retry_at, claimed_at, finished_at, created_at, EXTRACT(EPOCH FROM (now() - created_at))::int AS age_seconds FROM ingest_jobs WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    } finally {
        client.release();
    }
}

module.exports = { enqueueJob, getJobById };
