const WORKER_LOCK_KEYS = [1667329649, 1835102829]; // "canq" / "maps"
const SOURCE_RETRY_CODE = 'MAP_SOURCE_UNAVAILABLE';

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
                next_attempt_at = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.next_attempt_at
                    ELSE now()
                END,
                failure_code = CASE
                    WHEN map_index_jobs.desired_version = EXCLUDED.desired_version
                        THEN map_index_jobs.failure_code
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
                          WHERE rm.resource_id = r.id AND rm.provider IN ('canquery','pmtiles')))
    `, [datasetIds, candidateResourceIds || []]);
    const ids = stale.rows.map(row => row.id);
    if (ids.length === 0) return { removed: 0 };
    await db.query('DELETE FROM map_store.features WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query("DELETE FROM resource_maps WHERE provider IN ('canquery','pmtiles') AND resource_id = ANY($1::text[])", [ids]);
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

async function recoverOrphanedJobs(db, maxAttempts = 3) {
    return db.query(`
        UPDATE map_index_jobs
        SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'pending' END,
            worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL,
            finished_at = CASE WHEN attempts >= $1 THEN now() ELSE NULL END,
            error = CASE
                WHEN attempts >= $1
                    THEN 'map worker terminated during indexing after ' || attempts || ' attempts'
                ELSE 'requeued after map worker restart'
            END,
            next_attempt_at = now(),
            failure_code = NULL,
            updated_at = now()
        WHERE status = 'running'
        RETURNING resource_id, status
    `, [maxAttempts]);
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
                    next_attempt_at = now(), failure_code = NULL,
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

async function claimJob(db, workerId, resourceId = null) {
    const result = await db.query(`
        UPDATE map_index_jobs
        SET status = 'running', attempts = attempts + 1, worker_id = $1,
            claimed_at = now(), heartbeat_at = now(), finished_at = NULL,
            error = NULL, failure_code = NULL, next_attempt_at = now(), updated_at = now()
        WHERE resource_id = (
            SELECT j.resource_id FROM map_index_jobs j
            JOIN resources candidate_resource ON candidate_resource.id = j.resource_id
            WHERE j.status = 'pending'
              AND j.next_attempt_at <= now()
              AND ($2::text IS NULL OR j.resource_id = $2)
              AND (
                  j.failure_code = $3
                  OR NOT EXISTS (
                      SELECT 1
                      FROM map_index_jobs blocker
                      JOIN resources blocker_resource ON blocker_resource.id = blocker.resource_id
                      WHERE blocker.status = 'pending'
                        AND blocker.failure_code = $3
                        AND blocker_resource.raw->>'source_id' = candidate_resource.raw->>'source_id'
                  )
              )
            ORDER BY
                CASE
                    WHEN j.candidate->>'expectedBytes' ~ '^[0-9]+$'
                        THEN (j.candidate->>'expectedBytes')::numeric
                    ELSE NULL
                END NULLS LAST,
                CASE
                    WHEN j.candidate->>'expectedRows' ~ '^[0-9]+$'
                        THEN (j.candidate->>'expectedRows')::numeric
                    ELSE NULL
                END NULLS LAST,
                j.updated_at, j.resource_id
            LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING resource_id, desired_version AS claimed_version,
                  candidate, attempts
    `, [workerId, resourceId, SOURCE_RETRY_CODE]);
    return result.rows[0] || null;
}

async function heartbeatJob(db, resourceId, workerId) {
    const result = await db.query(`
        UPDATE map_index_jobs SET heartbeat_at = now(), updated_at = now()
        WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
    `, [resourceId, workerId]);
    return result.rowCount === 1;
}

async function finishJob(db, job, workerId, status, metrics = {}, error = null, failureCode = null) {
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
            next_attempt_at = now(),
            failure_code = CASE WHEN desired_version <> $3 AND $4 = 'ready' THEN NULL ELSE $9 END,
            feature_count = $6, vertex_count = $7, downloaded_bytes = $8,
            updated_at = now()
        WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
        RETURNING status
    `, [
        job.resource_id, workerId, job.claimed_version, status, error,
        metrics.featureCount == null ? null : metrics.featureCount,
        metrics.vertexCount == null ? null : metrics.vertexCount,
        metrics.downloadedBytes == null ? null : metrics.downloadedBytes,
        failureCode
    ]);
    return result.rows[0] || null;
}

async function requeueJob(db, job, workerId, error, nextAttemptAt = null, failureCode = null) {
    const result = await db.query(`
        UPDATE map_index_jobs
        SET status = 'pending', worker_id = NULL, claimed_at = NULL,
            heartbeat_at = NULL, finished_at = NULL, error = $4,
            next_attempt_at = COALESCE($5::timestamptz, now()), failure_code = $6,
            updated_at = now()
        WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
          AND desired_version = $3
    `, [job.resource_id, workerId, job.claimed_version, error, nextAttemptAt, failureCode]);
    return result.rowCount === 1;
}

async function failPendingSourceJobs(db, sourceId, error, failureCode = SOURCE_RETRY_CODE) {
    if (!sourceId) return 0;
    const result = await db.query(`
        UPDATE map_index_jobs j
        SET status = 'failed', worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL,
            finished_at = now(), error = $2, failure_code = $3,
            next_attempt_at = now(), updated_at = now()
        FROM resources r
        WHERE j.resource_id = r.id
          AND j.status = 'pending'
          AND r.raw->>'source_id' = $1
    `, [sourceId, error, failureCode]);
    return result.rowCount;
}

async function getMapQueueHealth(db) {
    const result = await db.query(`
        SELECT count(*) FILTER (WHERE j.status = 'pending')::int AS pending,
               count(*) FILTER (WHERE j.status = 'pending' AND j.next_attempt_at > now())::int AS deferred,
               count(*) FILTER (WHERE j.status = 'running')::int AS running,
               count(*) FILTER (WHERE j.status = 'ready')::int AS ready,
               count(*) FILTER (WHERE j.status = 'skipped')::int AS skipped,
               count(*) FILTER (WHERE j.status = 'failed')::int AS failed,
               count(DISTINCT r.raw->>'source_id') FILTER (
                   WHERE j.status = 'pending' AND j.failure_code = $1
               )::int AS retrying_sources,
               min(j.updated_at) FILTER (
                   WHERE j.status = 'pending' AND j.next_attempt_at <= now()
               ) AS oldest_pending_at,
               min(j.next_attempt_at) FILTER (
                   WHERE j.status = 'pending' AND j.next_attempt_at > now()
               ) AS next_retry_at,
               min(j.heartbeat_at) FILTER (WHERE j.status = 'running') AS oldest_running_at,
               max(j.finished_at) FILTER (WHERE j.status = 'ready') AS last_indexed_at
        FROM map_index_jobs j
        LEFT JOIN resources r ON r.id = j.resource_id
    `, [SOURCE_RETRY_CODE]);
    return result.rows[0];
}

async function getReadyMapState(db, resourceId, version) {
    const result = await db.query(`
        SELECT rm.provider, rm.source_version, rm.feature_count, rm.byte_size, rm.indexed_at,
               rm.storage_key, rm.storage_etag, rm.storage_sha256,
               EXISTS (SELECT 1 FROM map_store.features f WHERE f.resource_id = rm.resource_id) AS has_features
        FROM resource_maps rm
        WHERE rm.resource_id = $1 AND rm.provider IN ('canquery','pmtiles')
          AND rm.source_version = $2
    `, [resourceId, version]);
    return result.rows[0] || null;
}

async function listPmtilesMapObjects(db) {
    const result = await db.query(`
        SELECT resource_id, storage_key, storage_etag, storage_sha256, byte_size
        FROM resource_maps WHERE provider = 'pmtiles'
        ORDER BY resource_id
    `);
    return result.rows;
}

async function deletePmtilesMapMetadata(db, resourceId) {
    const result = await db.query(`
        DELETE FROM resource_maps
        WHERE resource_id = $1 AND provider = 'pmtiles'
        RETURNING storage_key
    `, [resourceId]);
    return result.rows[0] || null;
}

async function requeueMissingPmtilesMaps(db, resourceIds) {
    if (!resourceIds || resourceIds.length === 0) return [];
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const removed = await client.query(`
            DELETE FROM resource_maps
            WHERE provider = 'pmtiles' AND resource_id = ANY($1::text[])
            RETURNING resource_id
        `, [resourceIds]);
        const ids = removed.rows.map(row => row.resource_id);
        if (ids.length) {
            await client.query(`
                UPDATE map_index_jobs
                SET status = 'pending', indexed_version = NULL, attempts = 0,
                    worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL,
                    finished_at = NULL,
                    error = 'PMTiles object absent; queued for rebuild',
                    next_attempt_at = now(), failure_code = NULL, updated_at = now()
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
    SOURCE_RETRY_CODE,
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
    failPendingSourceJobs,
    getMapQueueHealth,
    getReadyMapState,
    listPmtilesMapObjects,
    deletePmtilesMapMetadata,
    requeueMissingPmtilesMaps,
    queryLocalMap
};
