require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('node:crypto');
const pool = require('../db/pool');
const longRunningPool = require('../db/longRunningPool');
const { getResourceById } = require('../db/catalogReadQueries');
const { datastoreSearch } = require('../services/ckanClient');
const { getSource } = require('../config/catalogSources');
const {
    MapSkipError,
    indexMapResource,
    validateMapFilesystems,
    mapCaps,
    candidateMode
} = require('../services/mapIndexPipeline');
const {
    acquireWorkerLock,
    releaseWorkerLock,
    recoverOrphanedJobs,
    reconcileMissingFeatures,
    claimJob,
    heartbeatJob,
    finishJob,
    requeueJob,
    getReadyMapState
} = require('../db/mapIndexQueries');

const onceMode = process.argv.includes('--once');
const drainMode = process.argv.includes('--drain');
const POLL_MS = Number(process.env.MAP_INDEX_POLL_MS) || 3000;
const HEARTBEAT_MS = Math.max(1000, Number(process.env.MAP_INDEX_HEARTBEAT_MS) || 15000);
const MAX_ATTEMPTS = 3;
let stopRequested = false;
let wakePoll = null;

function requestStop(signal) {
    if (!stopRequested) {
        stopRequested = true;
        console.log('map-worker received ' + signal + '; stopping after the active job');
    }
    if (wakePoll) wakePoll();
}

function waitForPoll() {
    if (stopRequested) return Promise.resolve();
    return new Promise(resolve => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            wakePoll = null;
            resolve();
        };
        const timer = setTimeout(done, POLL_MS);
        wakePoll = done;
    });
}

function ckanTarget(resource) {
    const raw = resource && resource.raw && typeof resource.raw === 'object' ? resource.raw : {};
    const source = getSource(raw.source_id);
    if (!source || source.kind !== 'ckan' || !raw.upstream_resource_id) {
        throw new MapSkipError('map candidate does not belong to a configured CKAN source', 'MAP_SOURCE');
    }
    return { resourceId: raw.upstream_resource_id, baseUrl: source.catalogUrl, source };
}

function validateDirectGeoJson(resource, candidate) {
    ckanTarget(resource);
    const raw = resource && resource.raw && typeof resource.raw === 'object' ? resource.raw : {};
    if (resource.datastore_active === true || String(raw.original_format || '').toUpperCase() !== 'GEOJSON') {
        throw new MapSkipError('direct map candidate is not a catalogued GeoJSON file', 'MAP_SOURCE');
    }
    if (!resource.url || (candidate.sourceUrl && candidate.sourceUrl !== resource.url)) {
        throw new MapSkipError('direct map candidate URL differs from the catalogued resource', 'MAP_SOURCE');
    }
    return true;
}

async function probeGeometry(resource) {
    const target = ckanTarget(resource);
    const probe = await datastoreSearch({ ...target, limit: 0, offset: 0 });
    const fields = Array.isArray(probe && probe.fields) ? probe.fields : [];
    if (!fields.some(field => String(field && field.id).toLowerCase() === 'geometry')) {
        throw new MapSkipError('DataStore has no geometry column', 'MAP_GEOMETRY');
    }
    return { total: Number(probe.total) || 0, fields };
}

async function processJob(job, workerId, options = {}) {
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            if (!await heartbeatJob(pool, job.resource_id, workerId)) {
                console.error('[map ' + job.resource_id + '] worker lease was lost');
            }
        } catch (error) {
            console.error('[map ' + job.resource_id + '] heartbeat failed: ' + error.message);
        } finally {
            heartbeatBusy = false;
        }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    try {
        const resource = await (options.getResourceById || getResourceById)(job.resource_id);
        if (!resource) throw new MapSkipError('resource vanished from catalogue', 'MAP_SOURCE');
        const ready = await (options.getReadyMapState || getReadyMapState)(pool, job.resource_id, job.claimed_version);
        if (ready && ready.has_features) {
            await finishJob(pool, job, workerId, 'ready', {
                featureCount: Number(ready.feature_count) || null
            });
            console.log('[map ' + job.resource_id + '] reconciled existing index');
            return { reconciled: true };
        }
        const mode = candidateMode(job.candidate || {});
        let expectedRows = null;
        if (mode === 'ckan-datastore-csv') {
            const probe = await (options.probeGeometry || probeGeometry)(resource);
            expectedRows = probe.total;
            if (probe.total > mapCaps(options.caps).maxRows) {
                throw new MapSkipError('DataStore row count exceeds map cap', 'MAP_ROWS');
            }
        } else {
            (options.validateDirectGeoJson || validateDirectGeoJson)(resource, job.candidate || {});
        }
        console.log('[map ' + job.resource_id + '] indexing attempt ' + job.attempts +
            ' (' + mode + (expectedRows == null ? '' : ', ' + expectedRows + ' rows') + ')');
        const result = await (options.indexMapResource || indexMapResource)(resource, job, workerId, options.caps);
        console.log('[map ' + job.resource_id + '] ' + result.queueStatus + ': ' + result.featureCount +
            ' features, ' + result.vertexCount + ' vertices');
        return result;
    } catch (error) {
        const skipped = error instanceof MapSkipError || ['CAP_FILE'].includes(error && error.code);
        const detail = error && error.code ? error.code + ': ' + error.message : error.message;
        console.error('[map ' + job.resource_id + '] ' + (skipped ? 'skipped' : 'failed') + ': ' + detail);
        if (skipped) {
            await finishJob(pool, job, workerId, 'skipped', {}, detail);
        } else if (job.attempts >= MAX_ATTEMPTS) {
            await finishJob(pool, job, workerId, 'failed', {}, detail);
        } else {
            await requeueJob(pool, job, workerId, detail);
        }
        return { error, skipped };
    } finally {
        clearInterval(heartbeat);
    }
}

async function main() {
    const workerId = crypto.randomUUID();
    let lockClient = null;
    let lockHeld = false;
    try {
        await validateMapFilesystems();
        lockClient = await pool.connect();
        lockClient.on('error', error => {
            console.error('map-worker lock connection failed:', error.message);
            process.exit(1);
        });
        lockHeld = await acquireWorkerLock(lockClient);
        if (!lockHeld) {
            const message = 'another map worker already owns the queue lock';
            if (onceMode || drainMode) {
                console.log(message + '; nothing to do');
                return;
            }
            throw new Error(message);
        }
        console.log('map-worker started as ' + workerId + (drainMode ? ' (drain mode)' : onceMode ? ' (once mode)' : ''));
        const recovered = await recoverOrphanedJobs(pool, MAX_ATTEMPTS);
        const recoveredRows = recovered.rows || [];
        const requeuedCount = recoveredRows.filter(row => row.status === 'pending').length;
        const failedCount = recoveredRows.filter(row => row.status === 'failed').length;
        if (requeuedCount) console.log('requeued ' + requeuedCount + ' interrupted map job(s)');
        if (failedCount) console.error('failed ' + failedCount + ' interrupted map job(s) at the attempt limit');
        const missing = await reconcileMissingFeatures(pool);
        if (missing.length) console.log('queued ' + missing.length + ' map index(es) absent after restore');

        while (!stopRequested) {
            const job = await claimJob(pool, workerId);
            if (job) {
                await processJob(job, workerId);
                if (onceMode) break;
            } else if (onceMode || drainMode) {
                console.log('no pending map jobs');
                break;
            } else {
                await waitForPoll();
            }
        }
    } finally {
        if (lockHeld && lockClient) {
            try { await releaseWorkerLock(lockClient); } catch (error) {
                console.error('failed to release map-worker lock:', error.message);
            }
        }
        if (lockClient) lockClient.release();
        await Promise.all([pool.end(), longRunningPool.end()]);
    }
}

if (require.main === module) {
    process.once('SIGTERM', () => requestStop('SIGTERM'));
    process.once('SIGINT', () => requestStop('SIGINT'));
    main().catch(error => {
        console.error('map-worker failed:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    main, processJob, probeGeometry, ckanTarget, validateDirectGeoJson,
    requestStop, waitForPoll
};
