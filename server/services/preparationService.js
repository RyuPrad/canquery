const pool = require('../db/pool');
const { lockIngestResource } = require('../db/ingestResourceLock');
const { resourceVersion, preparationEnabled } = require('./resourceVersion');
const { isIngestableFile } = require('./resourceCapabilities');
const AppError = require('../utils/AppError');
const { toAbsoluteUrl } = require('../utils/resolveUrl');

const buckets = new Map();
const HOUR = 3600000;
function positiveEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function unavailable(message, seconds, code = 'PREPARATION_BUSY') {
    const error = new AppError(message, 429);
    error.retryAfter = Math.max(1, Math.ceil(seconds));
    error.publicCode = code;
    return error;
}

// Only successful new admissions consume a token. No addresses are persisted.
function reserveToken(key, now = Date.now()) {
    for (const [ip, bucket] of buckets) if (bucket.until <= now) buckets.delete(ip);
    const bucket = buckets.get(key) || { count: 0, until: now + HOUR };
    if (bucket.count >= positiveEnv('AUTO_PREPARE_PER_IP_HOUR', 20)) {
        throw unavailable('Preparation limit reached; existing tables remain available', (bucket.until - now) / 1000);
    }
    if (!buckets.has(key) && buckets.size >= 10000) throw unavailable('Preparation is busy; try again shortly', 60);
    bucket.count += 1;
    buckets.set(key, bucket);
    return () => { bucket.count = Math.max(0, bucket.count - 1); };
}

async function prepareResource(resourceId, ip, db = pool) {
    if (!preparationEnabled()) throw unavailable('Automatic preparation is temporarily paused', 60);
    const client = await db.connect();
    let refund;
    try {
        await client.query('BEGIN');
        await lockIngestResource(client, resourceId);
        const result = await client.query(`
            SELECT r.*, ir.status AS ingest_status, ir.source_version AS ingested_source_version,
                   ir.ingested_at, ir.row_count AS ingested_row_count
            FROM resources r JOIN datasets d ON d.id = r.dataset_id
            LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
            WHERE r.id = $1`, [resourceId]);
        const row = result.rows[0];
        if (!row) throw new AppError('Resource not found', 404);
        const version = resourceVersion(row);
        if (row.ingest_status === 'ready' && row.ingested_source_version === version) {
            await client.query('COMMIT');
            return { id: null, resource_id: resourceId, status: 'done', already_loaded: true,
                row_count: Number(row.ingested_row_count), prepared_at: row.ingested_at };
        }
        const jobs = await client.query(`SELECT * FROM ingest_jobs WHERE resource_id = $1
            ORDER BY (status IN ('pending','running')) DESC, id DESC LIMIT 1`, [resourceId]);
        const job = jobs.rows[0];
        if (job && ['pending', 'running'].includes(job.status)) {
            await client.query('COMMIT');
            return publicJob(job, row);
        }
        if (!isIngestableFile(row)) {
            const error = new AppError('This file cannot be prepared within the supported format and size limits', 422);
            error.download_url = toAbsoluteUrl(row.url);
            throw error;
        }
        if (job?.source_version === version && job.status === 'failed' && new Date(job.retry_at).getTime() > Date.now()) {
            throw unavailable('Preparation could not finish; a retry will be available later',
                (new Date(job.retry_at).getTime() - Date.now()) / 1000, 'PREPARATION_COOLDOWN');
        }
        // Serialize admission across API processes and different resource IDs.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('canquery-prepare-admission'))");
        const count = await client.query("SELECT count(*)::int AS active FROM ingest_jobs WHERE status IN ('pending','running')");
        if (count.rows[0].active >= positiveEnv('AUTO_PREPARE_MAX_ACTIVE', 10)) {
            throw unavailable('Preparation queue is busy; try again shortly', 30);
        }
        refund = reserveToken(ip);
        const queued = await client.query(`INSERT INTO ingest_jobs (resource_id, preparation, source_version)
            VALUES ($1, true, $2) RETURNING *`, [resourceId, version]);
        await client.query('COMMIT');
        refund = null;
        return publicJob(queued.rows[0], row);
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        if (refund) refund();
        throw error;
    } finally { client.release(); }
}

function publicJob(job, row) {
    return { id: Number(job.id), resource_id: job.resource_id, status: job.status,
        created_at: job.created_at, serving_cached: row.ingest_status === 'ready',
        prepared_at: row.ingested_at || null };
}

module.exports = { prepareResource, reserveToken };
