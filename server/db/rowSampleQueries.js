const pool = require('./pool');

// Resource columns the sampler needs to classify a resource, compute its
// version (services/resourceVersion.js) and reach its live table: a narrow
// slice of `raw`, never the whole record.
const CANDIDATE_COLUMNS = `r.id, r.dataset_id, r.url, r.format, r.size_bytes, r.datastore_active, r.last_modified,
    jsonb_build_object(
        'source_id', r.raw->'source_id', 'upstream_resource_id', r.raw->'upstream_resource_id',
        'record_count', r.raw->'record_count', 'field_count', r.raw->'field_count',
        'source_hash', r.raw->'source_hash', 'hash', r.raw->'hash', 'data_processed', r.raw->'data_processed',
        'rows_updated_at', r.raw->'rows_updated_at', 'view_last_modified', r.raw->'view_last_modified') AS raw,
    ir.status AS ingest_status,
    s.checked_version AS sample_checked_version, s.next_check_at AS sample_next_check_at,
    s.attempts AS sample_attempts, s.fields IS NOT NULL AS sample_stored`;

const CANDIDATE_JOINS = `JOIN datasets d ON d.id = r.dataset_id
    LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
    LEFT JOIN resource_row_samples s ON s.resource_id = r.id`;

// Only live tables can be sampled, and CSV files when the run samples files;
// the rest is classified in JS. The due list applies it too, and leaves out
// resources with a prepared copy, whose pages show the copy's rows: a stored
// sample that is no longer refreshed would otherwise stay due for ever, ahead
// of the live tables.
const sampleable = files => (files ? `(r.datastore_active OR r.format = 'CSV')` : 'r.datastore_active');

// The resource pages Google showed most often in the last 28 days of imported
// Search Console data, by the number of days each was shown. The limit applies
// to the pages that can be sampled, not to every page shown.
async function listShownCandidates({ pagePrefix, days = 28, limit = 200, files = false }, db = pool) {
    const { rows } = await db.query(`
        WITH shown AS (
            SELECT substr(split_part(page, '?', 1), length($1) + 1) AS id, count(DISTINCT data_date) AS days
            FROM search_console_page_dates
            WHERE data_date >= current_date - $2::int AND starts_with(page, $1)
            GROUP BY 1
        )
        SELECT ${CANDIDATE_COLUMNS}
        FROM shown
        JOIN resources r ON r.id = shown.id
        ${CANDIDATE_JOINS}
        WHERE ${sampleable(files)}
        ORDER BY shown.days DESC, r.id
        LIMIT $3
    `, [pagePrefix, days, limit]);
    return rows;
}

async function listDueCandidates({ limit, files = false }, db = pool) {
    const { rows } = await db.query(`
        SELECT ${CANDIDATE_COLUMNS}
        FROM resource_row_samples due
        JOIN resources r ON r.id = due.resource_id
        ${CANDIDATE_JOINS}
        WHERE due.next_check_at <= now() AND ${sampleable(files)}
          AND ir.status IS DISTINCT FROM 'ready'
        ORDER BY due.next_check_at, r.id
        LIMIT $1
    `, [limit]);
    return rows;
}

// One step of a sweep over every resource in id order, so unsampled resources
// and changed versions are found without scanning the catalogue in one go.
async function listSweepCandidates({ after = '', limit, files = false }, db = pool) {
    const { rows } = await db.query(`
        SELECT ${CANDIDATE_COLUMNS}
        FROM resources r
        ${CANDIDATE_JOINS}
        WHERE r.id > $1 AND ${sampleable(files)}
        ORDER BY r.id
        LIMIT $2
    `, [after, limit]);
    return rows;
}

// A failed or unsupported check keeps the last good sample (and its origin and
// version); a successful one replaces it.
async function saveSample(result, db = pool) {
    const ok = result.status === 'ok';
    await db.query(`
        INSERT INTO resource_row_samples AS s (
            resource_id, origin, status, checked_version, checked_at, next_check_at, attempts, failure_code,
            source_version, sampled_at, fields, records, columns_total, upstream_total, bytes_read)
        VALUES ($1, $2, $3, $4, now(), $5, $6, $7,
            CASE WHEN $8 THEN $4 END, CASE WHEN $8 THEN now() END, $9, $10, $11, $12, $13)
        ON CONFLICT (resource_id) DO UPDATE SET
            origin = CASE WHEN EXCLUDED.status = 'ok' OR s.fields IS NULL THEN EXCLUDED.origin ELSE s.origin END,
            status = EXCLUDED.status,
            checked_version = EXCLUDED.checked_version,
            checked_at = EXCLUDED.checked_at,
            next_check_at = EXCLUDED.next_check_at,
            attempts = EXCLUDED.attempts,
            failure_code = EXCLUDED.failure_code,
            source_version = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.source_version ELSE s.source_version END,
            sampled_at = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.sampled_at ELSE s.sampled_at END,
            fields = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.fields ELSE s.fields END,
            records = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.records ELSE s.records END,
            columns_total = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.columns_total ELSE s.columns_total END,
            upstream_total = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.upstream_total ELSE s.upstream_total END,
            bytes_read = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.bytes_read ELSE s.bytes_read END
    `, [result.resourceId, result.origin, result.status, result.version, result.nextCheckAt, result.attempts,
        ok ? null : result.failureCode, ok,
        ok ? JSON.stringify(result.sample.fields) : null, ok ? JSON.stringify(result.sample.records) : null,
        ok ? result.sample.columns_total : null, ok ? result.sample.upstream_total : null,
        ok && Number.isInteger(result.bytesRead) ? result.bytesRead : null]);
}

// The stored sample a resource page may show; null without one.
async function getResourceRowSample(resourceId, db = pool) {
    const { rows } = await db.query(`
        SELECT origin, source_version, sampled_at, fields, records, columns_total, upstream_total
        FROM resource_row_samples
        WHERE resource_id = $1 AND fields IS NOT NULL
    `, [resourceId]);
    return rows[0] || null;
}

module.exports = { listShownCandidates, listDueCandidates, listSweepCandidates, saveSample, getResourceRowSample };
