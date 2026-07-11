require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');

const onceMode = process.argv.includes('--once');

const caps = {
    maxFileBytes: (Number(process.env.MAX_FILE_MB) || 50) * 1024 * 1024,
    maxXlsxBytes: (Number(process.env.MAX_XLSX_MB) || 20) * 1024 * 1024,
    maxRows: Number(process.env.MAX_ROWS) || 1000000,
    maxCols: Number(process.env.MAX_COLS) || 120,
    storeBudgetBytes: (Number(process.env.STORE_BUDGET_GB) || 15) * 1024 * 1024 * 1024,
    userAgent: process.env.CKAN_USER_AGENT || 'canquery/1.0',
    stallTimeoutMs: Number(process.env.INGEST_STALL_TIMEOUT_MS) || 60000
};

const POLL_MS = Number(process.env.INGEST_POLL_MS) || 3000;
const HEARTBEAT_MS = Math.max(1000, Number(process.env.INGEST_HEARTBEAT_MS) || 15000);
const MAX_ATTEMPTS = 3;

const pool = require('../db/pool');
const longRunningPool = require('../db/longRunningPool');
const { getResourceById } = require('../db/catalogReadQueries');
const { ingestResource, validateStorageFilesystems } = require('../services/ingestPipeline');
const {
    acquireWorkerLock,
    releaseWorkerLock,
    recoverOrphanedJobs,
    claimJob,
    heartbeatJob,
    finishJob,
    requeueJob
} = require('../db/ingestWorkerQueries');

let stopRequested = false;
let wakePoll = null;

function requestStop(signal) {
    if (!stopRequested) {
        stopRequested = true;
        console.log('ingest-worker received ' + signal + '; stopping after any active job finishes');
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

async function logRun(run) {
    try {
        await pool.query('INSERT INTO ingest_runs (resource_id, started_at, finished_at, ok, rows_loaded, bytes_loaded, error) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
            run.resourceId,
            run.startedAt,
            run.finishedAt,
            run.ok,
            run.rowsLoaded,
            run.bytesLoaded,
            run.error
        ]);
    } catch (err) {
        console.error(err);
    }
}

async function processJob(job, workerId) {
    const startedAt = new Date();
    let ok = false;
    let rowsLoaded = null;
    let bytesLoaded = null;
    let error = null;
    let heartbeatBusy = false;
    const heartbeatTimer = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            const owned = await heartbeatJob(pool, job.id, workerId);
            if (!owned) console.error('[job ' + job.id + '] worker lease was lost');
        } catch (err) {
            console.error('[job ' + job.id + '] heartbeat failed: ' + err.message);
        } finally {
            heartbeatBusy = false;
        }
    }, HEARTBEAT_MS);
    heartbeatTimer.unref();

    try {
        const resource = await getResourceById(job.resource_id);
        if (!resource) throw new Error('resource vanished from catalog');
        // A crash can happen after the store transaction commits but before the
        // queue row is marked done. Recovery requeues that row; never rebuild a
        // table that is already ready just to repair queue bookkeeping.
        if (resource.ingest_status === 'ready' && resource.table_name) {
            rowsLoaded = resource.ingested_row_count == null ? null : Number(resource.ingested_row_count);
            bytesLoaded = resource.ingested_byte_size == null ? null : Number(resource.ingested_byte_size);
            const finished = await finishJob(pool, job.id, workerId, job.resource_id, 'done', null);
            if (!finished) throw new Error('worker lease lost while reconciling loaded resource');
            ok = true;
            console.log('[job ' + job.id + '] reconciled already-loaded resource ' + job.resource_id);
            return;
        }
        console.log('[job ' + job.id + '] ingesting ' + job.resource_id + ' (attempt ' + job.attempts + ')');
        const result = await ingestResource(resource, caps);
        rowsLoaded = result.rowCount;
        bytesLoaded = result.byteSize;
        const finished = await finishJob(pool, job.id, workerId, job.resource_id, 'done', null);
        if (!finished) throw new Error('worker lease lost before job completion');
        ok = true;
        console.log('[job ' + job.id + '] done: ' + result.rowCount + ' rows, ' + result.byteSize + ' bytes in ' + result.tableName);
    } catch (err) {
        error = err.message;
        console.error('[job ' + job.id + '] failed: ' + err.message);
        if (job.attempts >= MAX_ATTEMPTS) {
            const finished = await finishJob(pool, job.id, workerId, job.resource_id, 'failed', err.message);
            if (!finished) console.error('[job ' + job.id + '] could not record failure: worker lease lost');
        } else {
            const requeued = await requeueJob(pool, job.id, workerId, err.message);
            if (!requeued) console.error('[job ' + job.id + '] could not requeue: worker lease lost');
        }
    } finally {
        clearInterval(heartbeatTimer);
        await logRun({ resourceId: job.resource_id, startedAt, finishedAt: new Date(), ok, rowsLoaded, bytesLoaded, error });
    }
}

async function main() {
    const workerId = crypto.randomUUID();
    let lockClient = null;
    let lockHeld = false;
    try {
        await validateStorageFilesystems(caps);
        lockClient = await pool.connect();
        lockClient.on('error', (err) => {
            console.error('ingest-worker lock connection failed:', err.message);
            process.exit(1);
        });
        lockHeld = await acquireWorkerLock(lockClient);
        if (!lockHeld) {
            const message = 'another ingest worker already owns the queue lock';
            if (onceMode) {
                console.log(message + '; nothing to do in once mode');
                return;
            }
            // A daemon that exits successfully is not restarted by
            // Restart=on-failure, leaving the queue unserved after the other
            // worker goes away. Fail so systemd retries until ownership is free.
            throw new Error(message);
        }

        console.log('ingest-worker started as ' + workerId + (onceMode ? ' (once mode)' : ''));
        const recovered = await recoverOrphanedJobs(pool);
        if (recovered.rowCount > 0) {
            console.log('requeued ' + recovered.rowCount + ' orphaned running job(s)');
        }

        while (!stopRequested) {
            const job = await claimJob(pool, workerId);
            if (job) {
                await processJob(job, workerId);
                if (onceMode) break;
            } else {
                if (onceMode) {
                    console.log('no pending jobs');
                    break;
                }
                await waitForPoll();
            }
        }
    } finally {
        if (lockHeld && lockClient) {
            try {
                await releaseWorkerLock(lockClient);
            } catch (err) {
                console.error('failed to release worker lock:', err.message);
            }
        }
        if (lockClient) lockClient.release();
        // ingestPipeline owns the timeout-free pool used for COPY/DDL. End both
        // pools so --once and graceful service stops do not leave idle sockets.
        await Promise.all([pool.end(), longRunningPool.end()]);
    }
}

if (require.main === module) {
    process.once('SIGTERM', () => requestStop('SIGTERM'));
    process.once('SIGINT', () => requestStop('SIGINT'));
    process.on('unhandledRejection', (err) => {
        console.error(err);
        process.exit(1);
    });
    process.on('uncaughtException', (err) => {
        console.error(err);
        process.exit(1);
    });
    main().catch(err => {
        console.error('ingest-worker failed:', err);
        process.exitCode = 1;
    });
}

module.exports = { main, processJob, requestStop, waitForPoll };
