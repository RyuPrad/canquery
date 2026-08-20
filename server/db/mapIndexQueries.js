const WORKER_LOCK_KEYS = [1667329649, 1835102829]; // "canq" / "maps"

async function upsertMapCandidates(db, candidatesRaw) {
    const candidates = Array.from(new Map((candidatesRaw || []).map(row => [row.resourceId, row])).values());
    for (let start = 0; start < candidates.length; start += 250) {
        const chunk = candidates.slice(start, start + 250);
        const values = [];
        const tuples = chunk.map((candidate, index) => {
            const p = index * 3 + 1;
            values.push(candidate.resourceId, candidate.desiredVersion, JSON.stringify(candidate));
            return `($${p},$${p + 1},$${p + 2})`;
        });
        await db.query(`
            INSERT INTO map_index_jobs (resource_id, desired_version, candidate)
            VALUES ${tuples.join(',')}
            ON CONFLICT (resource_id) DO UPDATE SET
                desired_version = EXCLUDED.desired_version,
                candidate = EXCLUDED.candidate,
                status = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.status
                    ELSE 'pending'
                END,
                attempts = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.attempts
                    ELSE 0
                END,
                worker_id = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.worker_id
                    ELSE NULL
                END,
                claimed_at = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.claimed_at
                    ELSE NULL
                END,
                heartbeat_at = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.heartbeat_at
                    ELSE NULL
                END,
                finished_at = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.finished_at
                    ELSE NULL
                END,
                error = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.error
                    ELSE NULL
                END,
                updated_at = now()
        `, values);
    }
}

async function sweepMapCandidates(db, datasetIds, candidateResourceIds) {
    if (!datasetIds || datasetIds.length === 0) return { removed: 0 };
    const stale = await db.query(`
        SELECT r.id
        FROM resources r
        WHERE r.dataset_id = ANY($1::text[])
          AND NOT (r.id = ANY($2::text[]))
          AND (EXISTS (SELECT 1 FROM map_index_jobs j WHERE j.resource_id = r.id)
               OR EXISTS (SELECT 1 FROM resource_maps rm
                          WHERE rm.resource_id = r.id AND rm.provider = 'canquery'))
    `, [datasetIds, candidateResourceIds || []]);
    const ids = stale.rows.map(row => row.id);
    if (ids.length === 0) return { removed: 0 };
    await db.query('DELETE FROM map_store.features WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query("DELETE FROM resource_maps WHERE provider = 'canquery' AND resource_id = ANY($1::text[])", [ids]);
    await db.query('DELETE FROM map_index_jobs WHERE resource_id = ANY($1::text[])', [ids]);
    return { removed: ids.length };
}

async function acquireWorkerLock(db) {
    const result = await db.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', WORKER_LOCK_KEYS);
    return result.rows[0].acquired === true;
}

async function releaseWorkerLock(db) {
    const result = await db.query('SELECT pg_advisory_unlock($1, $2) AS released', WORKER_LOCK_KEYS);
    return result.rows[0].released === true;
}

async function recoverOrphanedJobs(db) {
    return db.query(`
        UPDATE map_index_jobs
        SET status = 'pending', worker_id = NULL, claimed_at = NULL,
            heartbeat_at = NULL, finished_at = NULL,
            error = 'requeued after map worker restart', updated_at = now()
        WHERE status = 'running'
    `);
}

async function reconcileMissingFeatures(db) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const missing = await client.query(`
            DELETE FROM resource_maps rm
            WHERE rm.provider = 'canquery'
              AND NOT EXISTS (
                  SELECT 1 FROM map_store.features f WHERE f.resource_id = rm.resource_id
              )
            RETURNING rm.resource_id
        `);
        const ids = missing.rows.map(row => row.resource_id);
        if (ids.length) {
            await client.query(`
                UPDATE map_index_jobs
                SET status = 'pending', indexed_version = NULL, attempts = 0,
                    worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL,
                    finished_at = NULL, error = 'map data absent after restore; queued for rebuild',
                    updated_at = now()
                WHERE resource_id = ANY($1::text[])
            `, [ids]);
        }
        await client.query('COMMIT');
        return ids;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

async function claimJob(db, workerId) {
    const result = await db.query(`
        UPDATE map_index_jobs
        SET status = 'running', attempts = attempts + 1, worker_id = $1,
            claimed_at = now(), heartbeat_at = now(), finished_at = NULL,
            error = NULL, updated_at = now()
        WHERE resource_id = (
            SELECT resource_id FROM map_index_jobs
            WHERE status = 'pending'
            ORDER BY updated_at, resource_id
            LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING resource_id, desired_version AS claimed_version,
                  candidate, attempts
    `, [workerId]);
    return result.rows[0] || null;
}

async function heartbeatJob(db, resourceId, workerId) {
    const result = await db.query(`
        UPDATE map_index_jobs SET heartbeat_at = now(), updated_at = now()
        WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
    `, [resourceId, workerId]);
    return result.rowCount === 1;
}

async function finishJob(db, job, workerId, status, metrics = {}, error = null) {
    const result = await db.query(`
        UPDATE map_index_jobs
        SET status = CASE
                WHEN desired_version <> $3 AND $4 = 'ready' THEN 'pending'
                ELSE $4
            END,
            indexed_version = CASE WHEN $4 = 'ready' THEN $3 ELSE indexed_version END,
            worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL,
            finished_at = CASE WHEN desired_version <> $3 AND $4 = 'ready' THEN NULL ELSE now() END,
            error = CASE WHEN desired_version <> $3 AND $4 = 'ready'
                         THEN 'source changed during indexing; queued latest version'
                         ELSE $5 END,
            feature_count = $6, vertex_count = $7, downloaded_bytes = $8,
            updated_at = now()
        WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
        RETURNING status
    `, [
        job.resource_id, workerId, job.claimed_version, status, error,
        metrics.featureCount == null ? null : metrics.featureCount,
        metrics.vertexCount == null ? null : metrics.vertexCount,
        metrics.downloadedBytes == null ? null : metrics.downloadedBytes
    ]);
    return result.rows[0] || null;
}

async function requeueJob(db, job, workerId, error) {
    const result = await db.query(`
        UPDATE map_index_jobs
        SET status = 'pending', worker_id = NULL, claimed_at = NULL,
            heartbeat_at = NULL, finished_at = NULL, error = $4, updated_at = now()
        WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
          AND desired_version = $3
    `, [job.resource_id, workerId, job.claimed_version, error]);
    return result.rowCount === 1;
}

async function getMapQueueHealth(db) {
    const result = await db.query(`
        SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
               count(*) FILTER (WHERE status = 'running')::int AS running,
               count(*) FILTER (WHERE status = 'ready')::int AS ready,
               count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
               count(*) FILTER (WHERE status = 'failed')::int AS failed,
               min(updated_at) FILTER (WHERE status = 'pending') AS oldest_pending_at,
               min(heartbeat_at) FILTER (WHERE status = 'running') AS oldest_running_at,
               max(finished_at) FILTER (WHERE status = 'ready') AS last_indexed_at
        FROM map_index_jobs
    `);
    return result.rows[0];
}

async function getReadyMapState(db, resourceId, version) {
    const result = await db.query(`
        SELECT rm.source_version, rm.feature_count, rm.byte_size, rm.indexed_at,
               EXISTS (SELECT 1 FROM map_store.features f WHERE f.resource_id = rm.resource_id) AS has_features
        FROM resource_maps rm
        WHERE rm.resource_id = $1 AND rm.provider = 'canquery'
          AND rm.source_version = $2
    `, [resourceId, version]);
    return result.rows[0] || null;
}

async function queryLocalMap(db, { resourceId, bbox, tolerance, limit }) {
    const result = await db.query(`
        WITH bounds AS (
            SELECT ST_MakeEnvelope($2, $3, $4, $5, 4326) AS geom
        ), visible AS (
            SELECT f.feature_id, f.properties,
                   CASE
                       WHEN GeometryType(f.geom) IN ('POINT','MULTIPOINT') THEN f.geom
                       ELSE ST_SimplifyPreserveTopology(
                           ST_Intersection(f.geom, bounds.geom), $6
                       )
                   END AS geom
            FROM map_store.features f CROSS JOIN bounds
            WHERE f.resource_id = $1
              AND f.geom && bounds.geom
              AND ST_Intersects(f.geom, bounds.geom)
            ORDER BY f.feature_id
            LIMIT $7
        )
        SELECT feature_id, properties,
               ST_AsGeoJSON(geom, 6)::jsonb AS geometry
        FROM visible
        WHERE NOT ST_IsEmpty(geom)
    `, [resourceId, bbox[0], bbox[1], bbox[2], bbox[3], tolerance, limit + 1]);
    return result.rows;
}

module.exports = {
    WORKER_LOCK_KEYS,
    upsertMapCandidates,
    sweepMapCandidates,
    acquireWorkerLock,
    releaseWorkerLock,
    recoverOrphanedJobs,
    reconcileMissingFeatures,
    claimJob,
    heartbeatJob,
    finishJob,
    requeueJob,
    getMapQueueHealth,
    getReadyMapState,
    queryLocalMap
};
