const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode, ingestCapBytesFor } = require('./catalogService');
const { enqueueJob, getJobById } = require('../db/ingestQueries');
const AppError = require('../utils/AppError');

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
    // Datastore (proxied) resources can be upgraded into local storage so that
    // per-column substring/range filters work - the upstream datastore only
    // supports equality. Allow it, but only when the underlying file is one we
    // can actually load (CSV/XLSX/XLS under the size cap); otherwise it is a
    // plain download, same as a file-only resource.
    if (mode === 'file-only' || (mode === 'datastore' && !isIngestableFile(row))) {
        const err = new AppError('Only CSV, XLSX or XLS resources under the size cap can be ingested', 422);
        err.download_url = row.url;
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
        id: Number(job.id),
        resource_id: job.resource_id,
        status: job.status,
        attempts: job.attempts,
        error: job.error || null,
        created_at: job.created_at,
        claimed_at: job.claimed_at || null,
        finished_at: job.finished_at || null
    };
}

module.exports = { enqueueIngest, getJob };
