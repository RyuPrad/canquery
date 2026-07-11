const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode, ingestCapBytesFor } = require('./catalogService');
const { enqueueJob, getJobById } = require('../db/ingestQueries');
const AppError = require('../utils/AppError');
const { toAbsoluteUrl } = require('../utils/resolveUrl');

function isIngestableFile(row) {
    const cap = ingestCapBytesFor(row.format);
    return cap !== null && (row.size_bytes == null || Number(row.size_bytes) <= cap);
}

async function enqueueIngest(resourceId) {
    const row = await getResourceById(resourceId);
    if (!row) {
        throw new AppError('Resource not found', 404);
    }
    const mode = computeQueryMode(row);
    // Loaded tables are immutable through the anonymous API. Refreshing one
    // drops and rebuilds it under DDL locks, so that belongs behind a future
    // operator-only endpoint rather than another public queue submission.
    if (mode === 'ingested') {
        return shapeJob({
            id: null,
            resource_id: resourceId,
            status: 'done',
            attempts: 0,
            error: null,
            created_at: row.ingested_at,
            finished_at: row.ingested_at,
            age_seconds: null,
            row_count: row.ingested_row_count,
            already_loaded: true
        });
    }
    // Datastore (proxied) resources can be upgraded into local storage so that
    // per-column substring/range filters work - the upstream datastore only
    // supports equality. Allow it, but only when the underlying file is one we
    // can actually load (CSV/XLSX/XLS under the size cap); otherwise it is a
    // plain download, same as a file-only resource.
    if (mode === 'file-only' || (mode === 'datastore' && !isIngestableFile(row))) {
        const err = new AppError('Only CSV, XLSX or XLS resources under the size cap can be ingested', 422);
        err.download_url = toAbsoluteUrl(row.url);
        throw err;
    }
    const job = await enqueueJob(resourceId);
    if (!job) {
        throw new AppError('Could not enqueue ingest job', 500);
    }
    return shapeJob(job);
}

async function getJob(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) {
        throw new AppError('Invalid job id', 400);
    }
    const job = await getJobById(n);
    if (!job) {
        throw new AppError('Job not found', 404);
    }
    return shapeJob(job);
}

function shapeJob(job) {
    return {
        id: job.id == null ? null : Number(job.id),
        resource_id: job.resource_id,
        status: job.status,
        attempts: job.attempts,
        // Worker messages may contain upstream URLs, filesystem paths, SQL or
        // network details. The UI only needs a safe retryable failure state.
        error: job.status === 'failed' ? 'Resource ingestion failed' : null,
        created_at: job.created_at,
        claimed_at: job.claimed_at || null,
        finished_at: job.finished_at || null,
        // Age computed in Postgres (now() - created_at) so the client timer is
        // immune to clock skew between the DB, the API and the browser.
        age_seconds: job.age_seconds != null ? Number(job.age_seconds) : null,
        ...(job.already_loaded && {
            already_loaded: true,
            row_count: job.row_count == null ? null : Number(job.row_count)
        })
    };
}

module.exports = { enqueueIngest, getJob };
