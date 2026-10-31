const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode, isIngestableFile } = require('./catalogService');
const { enqueueJob, getJobById } = require('../db/ingestQueries');
const AppError = require('../utils/AppError');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { failureReason } = require('./preparationFailure');

async function enqueueIngest(resourceId, commercial = null) {
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
        const err = new AppError('Only CSV, XLSX or XLS resources under the configured size and row caps can be ingested', 422);
        err.download_url = toAbsoluteUrl(row.url);
        throw err;
    }
    const job = commercial ? await enqueueJob(resourceId, commercial) : await enqueueJob(resourceId);
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

const PROGRESS_PHASES = new Set(['downloading', 'loading', 'finishing']);
const progressNumber = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
// The share of the file read while rows load, 0 to 1; null before rows load,
// from older workers and for anything out of range.
const progressFraction = (value) => {
    const n = progressNumber(value);
    return n === null || n < 0 || n > 1 ? null : Math.round(n * 1000) / 1000;
};
// The worker's advisory progress; absent until the first report and for jobs
// created before progress was recorded.
function shapeProgress(progress) {
    if (!progress || typeof progress !== 'object' || !PROGRESS_PHASES.has(progress.phase)) return null;
    return {
        phase: progress.phase,
        bytes: progressNumber(progress.bytes),
        content_length: progressNumber(progress.content_length),
        rows: progressNumber(progress.rows),
        read_fraction: progressFraction(progress.read_fraction),
        updated_at: typeof progress.updated_at === 'string' ? progress.updated_at : null
    };
}

function shapeJob(job) {
    return {
        id: job.id == null ? null : Number(job.id),
        resource_id: job.resource_id,
        status: job.status,
        attempts: job.attempts,
        retry_at: job.retry_at || null,
        failure_reason: job.status === 'failed' ? failureReason(job.failure_code) : null,
        // Worker messages may contain upstream URLs, filesystem paths, SQL or
        // network details. The UI only needs a safe retryable failure state.
        error: job.status === 'failed' ? 'Resource ingestion failed' : null,
        created_at: job.created_at,
        claimed_at: job.claimed_at || null,
        finished_at: job.finished_at || null,
        // Age computed in Postgres (now() - created_at) so the client timer is
        // immune to clock skew between the DB, the API and the browser.
        age_seconds: job.age_seconds != null ? Number(job.age_seconds) : null,
        progress: job.status === 'running' ? shapeProgress(job.progress) : null,
        ...(job.already_loaded && {
            already_loaded: true,
            row_count: job.row_count == null ? null : Number(job.row_count)
        })
    };
}

module.exports = { enqueueIngest, getJob };
