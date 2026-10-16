const { parse: parseSync } = require('csv-parse/sync');
const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode, shapeProvenance } = require('./catalogService');
const { downloadHead, sniffCsvMetaFromBytes } = require('./csvDownload');
const { decodeCsvSample } = require('./csvRead');
const { csvParseOptions } = require('./csvLoad');
const { inferColumns, detectHeaderIndex, mergeTwoRowHeader } = require('../utils/csvTypes');
const { createCache } = require('../utils/cache');
const { requestSignal } = require('../utils/requestContext');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const AppError = require('../utils/AppError');

// A visitor who opens a CSV that CanQuery can prepare but has not prepared yet
// waits for the download and load. The preview reads only the start of the
// publisher's file and shows its first rows meanwhile: the same header
// detection and type inference the loader uses, on a bounded sample, with
// nothing written to disk, prepared, renewed or recorded.
const PREVIEW_BYTES = 256 * 1024;
const PREVIEW_ROWS = 50;
const PREVIEW_TIMEOUT_MS = 8000;
// Header window (10) plus two header rows plus the rows shown plus the record
// that may be cut off at the end of an incomplete sample.
const RECORD_LIMIT = 10 + 2 + PREVIEW_ROWS + 1;

const previewCache = createCache({ name: 'csv-preview', ttlMs: 10 * 60 * 1000, negativeTtlMs: 60 * 1000,
    maxEntries: 200, cacheable: value => Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024 });

function csvError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Records parsed from a text sample, at most `limit` of them. An incomplete
// sample can end inside a record or a quoted field; the text is then cut back
// to the previous line end until it parses. `lastComplete` says whether the
// final record ended on a line end (or the limit was reached), so a caller can
// drop a record the cut may have shortened.
function collectRecords(text, delimiter, limit, complete) {
    let candidate = text;
    for (let attempt = 0; attempt < 64 && candidate.length; attempt += 1) {
        try {
            const records = parseSync(candidate, csvParseOptions({ delimiter, to: limit }));
            const lastComplete = records.length >= limit || /[\r\n]$/.test(candidate);
            return { records, lastComplete };
        } catch (err) {
            if (complete) throw err;
            const cut = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('\r'));
            if (cut <= 0) return { records: [], lastComplete: true };
            candidate = candidate.slice(0, cut + 1);
        }
    }
    return { records: [], lastComplete: true };
}

async function previewRecords(bytes, { complete, maxRows = PREVIEW_ROWS } = {}) {
    const { delimiter, encoding } = sniffCsvMetaFromBytes(bytes, complete);
    let text = decodeCsvSample(bytes, encoding, complete);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const { records, lastComplete } = collectRecords(text, delimiter, RECORD_LIMIT, complete);
    if (!complete && !lastComplete && records.length) records.pop();
    const headerIndex = detectHeaderIndex(records);
    const headers = records[headerIndex];
    if (!headers || headers.length === 0) throw csvError('empty CSV', 'CSV_EMPTY');
    const next = records[headerIndex + 1];
    const merged = next ? mergeTwoRowHeader(headers, next) : null;
    const rows = records.slice(headerIndex + (merged ? 2 : 1));
    const columns = inferColumns(merged || headers, rows);
    const fields = columns.map(({ id, type, original_label }) => ({ id, type, original_label }));
    const page = rows.slice(0, maxRows).map(row => Object.fromEntries(
        columns.map((column, index) => [column.id, row[index] === undefined ? null : row[index]])
    ));
    return { fields, records: page, truncated: !complete, sampled_rows: rows.length };
}

function conflict(message, code) {
    const error = new AppError(message, 409);
    error.publicCode = code;
    return error;
}

function unsupported(message) {
    const error = new AppError(message, 422);
    error.publicCode = 'PREVIEW_UNSUPPORTED';
    return error;
}

function upstreamError(cause) {
    const code = cause && cause.code;
    if (code === 'DOWNLOAD_URL_BLOCKED' || code === 'DOWNLOAD_REDIRECT') {
        return unsupported('The publisher URL cannot be read for a preview');
    }
    const timedOut = code === 'DOWNLOAD_RESPONSE_STALL' || code === 'DOWNLOAD_BODY_STALL' || cause?.name === 'AbortError';
    const error = new AppError(timedOut ? 'The publisher did not respond in time for a preview'
        : 'The publisher did not serve the file for a preview', 502);
    error.publicCode = timedOut ? 'PREVIEW_TIMEOUT' : 'PREVIEW_UPSTREAM';
    if (cause?.retryAfterMs > 0) error.retryAfter = Math.ceil(cause.retryAfterMs / 1000);
    return error;
}

function contentError() {
    return unsupported('This file cannot be previewed as a table');
}

async function previewResource(id, options = {}) {
    const signal = requestSignal();
    const row = await getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);
    const mode = computeQueryMode(row);
    if (mode === 'ingested') throw conflict('A prepared copy is ready; query it instead of a preview', 'PREVIEW_NOT_NEEDED');
    if (mode === 'datastore') throw conflict('Live rows are available; query them instead of a preview', 'PREVIEW_NOT_NEEDED');
    if (mode !== 'ingestable' || String(row.format || '').toUpperCase() !== 'CSV') {
        throw unsupported('A preview is only available for CSV files that CanQuery can prepare');
    }
    const read = async () => {
        let head;
        try {
            head = await downloadHead(toAbsoluteUrl(row.url), { maxBytes: PREVIEW_BYTES, timeoutMs: PREVIEW_TIMEOUT_MS,
                fetchImpl: options.fetchImpl, userAgent: process.env.CKAN_USER_AGENT || 'canquery/1.0', signal });
        } catch (cause) {
            throw upstreamError(cause);
        }
        let sample;
        try {
            sample = await previewRecords(head.bytes, { complete: head.complete });
        } catch (cause) {
            throw contentError(cause);
        }
        return { ...sample, bytes_read: head.bytes.length, content_length: head.contentLength };
    };
    const key = JSON.stringify([row.id, row.url, row.last_modified || null]);
    const result = await previewCache.get(key, read, { deduplicate: !signal });
    return { ...result, provenance: shapeProvenance(row.provenance_sources), publisher_modified_at: row.last_modified || null,
        retrieved_at: new Date().toISOString() };
}

module.exports = { previewResource, previewRecords, collectRecords, previewCache, PREVIEW_BYTES, PREVIEW_ROWS, PREVIEW_TIMEOUT_MS };
