require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error(err);
    process.exit(1);
});

const onceMode = process.argv.includes('--once');

const caps = {
    maxFileBytes: (Number(process.env.MAX_FILE_MB) || 50) * 1024 * 1024,
    maxRows: Number(process.env.MAX_ROWS) || 1000000,
    maxCols: Number(process.env.MAX_COLS) || 120,
    storeBudgetBytes: (Number(process.env.STORE_BUDGET_GB) || 15) * 1024 * 1024 * 1024,
    userAgent: process.env.CKAN_USER_AGENT || 'opencanada/1.0'
};

const POLL_MS = Number(process.env.INGEST_POLL_MS) || 3000;
const MAX_ATTEMPTS = 3;

const pool = require('../db/pool');
const { getResourceById } = require('../db/catalogReadQueries');
const { ingestResource } = require('../services/ingestPipeline');

async function claimJob() {
    const result = await pool.query(`UPDATE ingest_jobs SET status = 'running', claimed_at = now(), attempts = attempts + 1 WHERE id = (SELECT id FROM ingest_jobs WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, resource_id, attempts`);
    return result.rows[0] || null;
}

async function finishJob(id, status, error) {
    await pool.query('UPDATE ingest_jobs SET status = $2, error = $3, finished_at = now() WHERE id = $1', [id, status, error]);
}

async function requeueJob(id, error) {
    await pool.query(`UPDATE ingest_jobs SET status = 'pending', error = $2 WHERE id = $1`, [id, error]);
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

async function processJob(job) {
    const startedAt = new Date();
    let ok = false;
    let rowsLoaded = null;
    let bytesLoaded = null;
    let error = null;
    try {
        const resource = await getResourceById(job.resource_id);
        if (!resource) throw new Error('resource vanished from catalog');
        console.log('[job ' + job.id + '] ingesting ' + job.resource_id + ' (attempt ' + job.attempts + ')');
        const result = await ingestResource(resource, caps);
        rowsLoaded = result.rowCount;
        bytesLoaded = result.byteSize;
        ok = true;
        await finishJob(job.id, 'done', null);
        console.log('[job ' + job.id + '] done: ' + result.rowCount + ' rows, ' + result.byteSize + ' bytes in ' + result.tableName);
    } catch (err) {
        error = err.message;
        console.error('[job ' + job.id + '] failed: ' + err.message);
        if (job.attempts >= MAX_ATTEMPTS) {
            await finishJob(job.id, 'failed', err.message);
        } else {
            await requeueJob(job.id, err.message);
        }
    } finally {
        await logRun({ resourceId: job.resource_id, startedAt, finishedAt: new Date(), ok, rowsLoaded, bytesLoaded, error });
    }
}

async function main() {
    console.log('ingest-worker started' + (onceMode ? ' (once mode)' : ''));
    loop: while (true) {
        const job = await claimJob();
        if (job) {
            await processJob(job);
            if (onceMode) break;
        } else {
            if (onceMode) {
                console.log('no pending jobs');
                break;
            }
            await new Promise(r => setTimeout(r, POLL_MS));
        }
    }
    await pool.end();
    process.exit(0);
}

main();
