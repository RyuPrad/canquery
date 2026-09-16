const { createHash } = require('node:crypto');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { isIngestableFile } = require('./resourceCapabilities');

function instant(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resourceVersion(row) {
    const raw = row.raw || {};
    const value = [
        row.id, toAbsoluteUrl(row.url), String(row.format || '').toUpperCase(),
        instant(row.last_modified), row.size_bytes == null ? null : Number(row.size_bytes),
        raw.source_hash || raw.hash || null,
        raw.record_count == null ? null : Number(raw.record_count),
        raw.field_count == null ? null : Number(raw.field_count),
        instant(raw.data_processed), instant(raw.rows_updated_at), instant(raw.view_last_modified)
    ];
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function preparationEnabled() {
    return process.env.AUTO_PREPARE_ENABLED !== 'false';
}

function preparationInfo(row) {
    const loaded = row.ingest_status === 'ready';
    const job = row.preparation_job || null;
    const version = resourceVersion(row);
    const active = job && ['pending', 'running'].includes(job.status);
    const failed = job && job.status === 'failed' && job.source_version === version;
    return {
        supported: isIngestableFile(row),
        enabled: preparationEnabled(),
        freshness: !loaded ? 'unprepared' : !row.ingested_source_version ? 'unknown'
            : row.ingested_source_version === version ? 'current' : 'stale',
        state: active ? job.status : failed ? 'failed' : loaded ? 'ready' : 'unprepared',
        job_id: active ? Number(job.id) : null,
        retry_at: failed ? job.retry_at : null,
        prepared_at: row.ingested_at || null,
        publisher_modified_at: row.last_modified || null
    };
}

module.exports = { resourceVersion, preparationInfo, preparationEnabled };
