const { parse } = require('csv-parse');
const pool = require('../db/pool');
const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode, shapeProvenance } = require('./catalogService');
const { downloadHead, sniffCsvMetaFromBytes } = require('./csvDownload');
const { decodeCsvSample } = require('./csvRead');
const { csvParseOptions } = require('./csvLoad');
const { datastoreSearch } = require('./ckanClient');
const queryService = require('./queryService');
const csvPreview = require('./csvPreview');
const { inferColumns, detectHeaderIndex, mergeTwoRowHeader, hasLeadingZeroInteger, pgTypeFor } = require('../utils/csvTypes');
const { createCache } = require('../utils/cache');
const { envelope } = require('../utils/envelope');
const { queryProvenanceMeta } = require('./resourceEnvelopes');
const { requestSignal } = require('../utils/requestContext');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const AppError = require('../utils/AppError');

// The website's in-browser table: as much of a table as fits, in one response,
// so sorting, filtering, searching and paging can answer without the server.
// A prepared copy is read from its snapshot; a live CKAN table in one
// datastore_search; a CSV CanQuery can prepare but has not prepared yet from
// the start of the publisher's file, typed exactly as the loader will type it,
// so the prepared copy can replace it without a visible change.
const CELL_CAP = 200000;
const COLUMN_CAP = 120;
const COPY_ROW_CAP = 50000;
const LIVE_ROW_CAP = 10000;
const FILE_BYTES = 2 * 1024 * 1024;
const FILE_TIMEOUT_MS = 8000;
const LIVE_TIMEOUT_MS = 10000;
// The loader's windows: encoding from the first 64 KiB (csvDownload.sniffCsvMeta)
// and header detection and type inference from the first 1,011 records
// (csvLoad.readSample).
const SNIFF_BYTES = 65536;
const SAMPLE_RECORDS = 1011;
const PARSE_CHUNK = 256 * 1024;
const MAX_BUILDS = 2;
const FILE_BODY_CAP = 4 * 1024 * 1024;
const LIVE_BODY_CAP = 2 * 1024 * 1024;

// Serialised bodies, so a response is encoded once. At most 8 × 4 MiB plus
// 8 × 2 MiB stay in memory; most bodies are a few kilobytes.
const fileCache = createCache({ name: 'table-rows-file', ttlMs: 10 * 60 * 1000, negativeTtlMs: 60 * 1000,
    maxEntries: 8, cacheable: value => value == null || value.body.length <= FILE_BODY_CAP });
const liveCache = createCache({ name: 'table-rows-live', ttlMs: 5 * 60 * 1000, negativeTtlMs: 60 * 1000,
    maxEntries: 8, cacheable: value => value == null || value.body.length <= LIVE_BODY_CAP });
// The size of a live table, checked with a one-row read before any bulk read.
// A table found too large stays refused from this cache for five minutes.
const liveSizes = createCache({ name: 'table-rows-live-size', ttlMs: 5 * 60 * 1000, negativeTtlMs: 60 * 1000, maxEntries: 1000 });

// Each value is cast by PostgreSQL to the type the loader will give it and
// returned as that type, so node-pg turns it into exactly what it returns for
// the prepared copy: bigint and numeric as text, dates and timestamps as
// JavaScript Dates (serialised the same way, in any process time zone).
const CANONICAL = {
    INTEGER: "nullif(x, '')::bigint",
    NUMERIC: "nullif(x, '')::numeric",
    DATE: "nullif(x, '')::date",
    TIMESTAMPTZ: "nullif(x, '')::timestamptz"
};

let builds = 0;

function tableError(message, status, code) {
    const error = new AppError(message, status);
    error.publicCode = code;
    return error;
}

const tooLarge = () => tableError('This table is too large to load whole; page through it instead', 413, 'TABLE_TOO_LARGE');

async function withBuildSlot(build) {
    if (builds >= MAX_BUILDS) {
        const error = tableError('Another table is being loaded; try again shortly', 503, 'ROWS_BUSY');
        error.retryAfter = 5;
        throw error;
    }
    builds += 1;
    try {
        return await build();
    } finally {
        builds -= 1;
    }
}

function body({ fields, rows, complete, mode, origin, snapshot, row, provenance }) {
    const meta = {
        query_mode: mode,
        origin,
        ...(snapshot ? { snapshot } : {}),
        publisher_modified_at: row.last_modified || null,
        ...queryProvenanceMeta(provenance)
    };
    return Buffer.from(JSON.stringify(envelope({ fields, rows, total: complete ? rows.length : null, complete }, { meta })));
}

const asRows = (fields, records) => records.map(record => fields.map(field => {
    const value = record[field.id];
    return value === undefined ? null : value;
}));

async function copyRows(row, snapshot) {
    if (!snapshot) throw tableError('A prepared copy is read whole only with its snapshot', 400, 'SNAPSHOT_REQUIRED');
    const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
    const rowCount = Number(row.ingested_row_count);
    if (!Number.isSafeInteger(rowCount) || columns.length > COLUMN_CAP || rowCount > COPY_ROW_CAP ||
        rowCount * columns.length > CELL_CAP) throw tooLarge();
    return withBuildSlot(async () => {
        const result = await queryService.readSnapshotRows(row.id, { snapshot, cap: COPY_ROW_CAP, initial: row });
        if (result.records.length > COPY_ROW_CAP || result.records.length * (result.fields.length - 1) > CELL_CAP) throw tooLarge();
        return {
            body: body({ fields: result.fields, rows: asRows(result.fields, result.records), complete: true,
                mode: 'ingested', origin: 'copy', snapshot: result.snapshot, row, provenance: result.provenance }),
            cacheControl: 'private, max-age=86400'
        };
    });
}

const visibleLiveField = field => field && field.id !== '_full_text';

async function liveRows(row) {
    const target = queryService.datastoreTarget(row);
    const signal = requestSignal();
    const search = (limit) => datastoreSearch({ resourceId: target.resourceId, baseUrl: target.baseUrl, limit, offset: 0,
        signal, maxRetries: 0, timeoutMs: LIVE_TIMEOUT_MS });
    const key = JSON.stringify([target.sourceId, target.resourceId]);
    const size = await liveSizes.get(key, async () => {
        const first = await search(1);
        if (!first) return null;
        return { total: Number(first.total), columns: (first.fields || []).filter(visibleLiveField).length };
    }, { deduplicate: !signal });
    if (!size) throw tableError('Upstream datastore unavailable', 502, 'ROWS_UPSTREAM');
    if (!Number.isSafeInteger(size.total) || size.total > LIVE_ROW_CAP || size.columns > COLUMN_CAP ||
        size.total * size.columns > CELL_CAP) throw tooLarge();
    const value = await liveCache.get(key, () => withBuildSlot(async () => {
        const result = await search(LIVE_ROW_CAP);
        if (!result) return null;
        const fields = (result.fields || []).filter(visibleLiveField);
        const records = Array.isArray(result.records) ? result.records : [];
        // A portal can cap rows per request below what it reports in total.
        if (records.length !== Number(result.total) || records.length > LIVE_ROW_CAP) throw tooLarge();
        return {
            body: body({ fields, rows: asRows(fields, records), complete: true, mode: 'datastore', origin: 'live', row,
                provenance: shapeProvenance(row.provenance_sources) }),
            cacheControl: 'private, max-age=300'
        };
    }), { deduplicate: !signal });
    if (!value) throw tableError('Upstream datastore unavailable', 502, 'ROWS_UPSTREAM');
    return value;
}

// Records parsed from decoded text. A cut sample can end inside a record or a
// quoted field: parsing then stops at the error and the records before it are
// kept. Text is written in chunks so a large sample never holds the event loop
// for long.
function parseRecords(text, delimiter, complete) {
    return new Promise((resolve, reject) => {
        const records = [];
        let settled = false;
        const parser = parse(csvParseOptions({ delimiter }));
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error && complete) reject(error);
            else resolve({ records, cut: Boolean(error) });
        };
        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) records.push(record);
        });
        parser.on('error', finish);
        parser.on('end', () => finish(null));
        // Resolves on drain, or when the parser fails or closes, so a parse
        // error never leaves the writer waiting for a drain that won't come.
        const drained = () => new Promise(next => {
            const done = () => {
                parser.off('drain', done);
                parser.off('error', done);
                parser.off('close', done);
                next();
            };
            parser.once('drain', done);
            parser.once('error', done);
            parser.once('close', done);
        });
        (async () => {
            for (let offset = 0; offset < text.length && !settled; offset += PARSE_CHUNK) {
                if (!parser.write(text.slice(offset, offset + PARSE_CHUNK)) && !settled) await drained();
                await new Promise(next => setImmediate(next));
            }
            if (!settled) parser.end();
        })().catch(finish);
    });
}

// The rows of a CSV sample with the loader's header detection, inference
// window, leading-zero rule, empty-cell rule and column cap. Values are the
// publisher's text until typeFileColumns gives them PostgreSQL's forms.
async function parseFileRows(bytes, { complete }) {
    const { delimiter, encoding } = sniffCsvMetaFromBytes(bytes.subarray(0, SNIFF_BYTES),
        complete && bytes.length <= SNIFF_BYTES);
    let text = decodeCsvSample(bytes, encoding, complete);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const parsed = await parseRecords(text, delimiter, complete);
    const records = parsed.records;
    // A sample that stops before the end of the file can cut its last record.
    // When parsing stopped at an error (a cut inside quotes), the cut record
    // was never emitted; otherwise the last record may be a shortened one.
    if (!complete && records.length && !parsed.cut) records.pop();
    const window = records.slice(0, SAMPLE_RECORDS);
    const headerIndex = detectHeaderIndex(window);
    const headers = window[headerIndex];
    if (!headers || headers.length === 0) throw csvPreview.contentError();
    const next = window[headerIndex + 1];
    const merged = next ? mergeTwoRowHeader(headers, next) : null;
    const skip = headerIndex + (merged ? 2 : 1);
    const header = merged || headers;
    if (header.length > COLUMN_CAP) throw tooLarge();
    const columns = inferColumns(header, window.slice(skip));
    const maxRows = Math.min(COPY_ROW_CAP, Math.floor(CELL_CAP / Math.max(1, columns.length)));
    const data = records.slice(skip);
    const capped = data.length > maxRows;
    const kept = capped ? data.slice(0, maxRows) : data;
    // Column-major text, padded like the loader: a missing trailing cell is
    // NULL, a present empty cell is an empty string until typing.
    const values = columns.map((column, index) => kept.map(record => (record[index] === undefined ? null : record[index])));
    columns.forEach((column, index) => {
        if (['INTEGER', 'NUMERIC'].includes(column.type) && values[index].some(value => value !== null && hasLeadingZeroInteger(value))) {
            column.type = 'TEXT';
        }
    });
    return { columns, values, rowCount: kept.length, complete: complete && !parsed.cut && !capped };
}

// Each typed column is checked and converted by PostgreSQL itself, with the
// loader's rule: an empty cell is NULL, and one value its type cannot read makes
// the whole column TEXT (csvLoad.loadCsvIntoStore). A partial sample is checked
// on the rows it holds, so its types are provisional.
async function typeFileColumns(columns, values, db = pool) {
    for (let index = 0; index < columns.length; index += 1) {
        const column = columns[index];
        if (column.type === 'TEXT') continue;
        const { rows: validity } = await db.query(
            "SELECT coalesce(bool_and(pg_input_is_valid(nullif(x, ''), $2)), true) AS ok FROM unnest($1::text[]) AS x",
            [values[index], pgTypeFor(column.type)]);
        if (validity[0].ok !== true) {
            column.type = 'TEXT';
            column.cast_failed = true;
            continue;
        }
        const { rows } = await db.query(
            'SELECT ' + CANONICAL[column.type] + ' AS v FROM unnest($1::text[]) WITH ORDINALITY AS t(x, n) ORDER BY n',
            [values[index]]);
        values[index] = rows.map(result => result.v);
    }
}

async function fileRows(row) {
    const key = csvPreview.previewKey(row);
    const signal = requestSignal();
    const value = await fileCache.get(key, () => withBuildSlot(async () => {
        let head = csvPreview.completeHeadFor(row);
        if (!head) {
            try {
                head = await downloadHead(toAbsoluteUrl(row.url), { maxBytes: FILE_BYTES, timeoutMs: FILE_TIMEOUT_MS,
                    userAgent: process.env.CKAN_USER_AGENT || 'canquery/1.0', signal });
            } catch (cause) {
                throw csvPreview.upstreamError(cause);
            }
        }
        let sample;
        try {
            sample = await parseFileRows(head.bytes, { complete: head.complete });
        } catch (cause) {
            if (cause instanceof AppError) throw cause;
            throw csvPreview.contentError(cause);
        }
        await typeFileColumns(sample.columns, sample.values);
        const fields = [{ id: '_id', type: 'int' }, ...sample.columns.map(column => ({
            id: column.id, type: column.type, original_label: column.original_label,
            ...(column.legacy_ids ? { legacy_ids: column.legacy_ids } : {}),
            ...(column.cast_failed ? { cast_failed: true } : {})
        }))];
        const rows = [];
        for (let rowIndex = 0; rowIndex < sample.rowCount; rowIndex += 1) {
            const cells = [String(rowIndex + 1)];
            for (let columnIndex = 0; columnIndex < sample.columns.length; columnIndex += 1) {
                cells.push(sample.values[columnIndex][rowIndex]);
            }
            rows.push(cells);
        }
        return {
            body: body({ fields, rows, complete: sample.complete, mode: 'ingestable', origin: 'file', row,
                provenance: shapeProvenance(row.provenance_sources) }),
            cacheControl: 'private, max-age=600'
        };
    }), { deduplicate: !signal });
    if (!value) throw tableError('The publisher did not serve the file', 502, 'ROWS_UPSTREAM');
    return value;
}

async function readTableRows(id, { snapshot } = {}) {
    const row = await getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);
    const mode = computeQueryMode(row);
    let result;
    if (mode === 'ingested') result = await copyRows(row, snapshot);
    else if (mode === 'datastore') result = await liveRows(row);
    else if (mode === 'ingestable' && String(row.format || '').toUpperCase() === 'CSV') result = await fileRows(row);
    else throw tableError('This file cannot be loaded as a table here', 422, 'ROWS_UNSUPPORTED');
    return { ...result, retrievedAt: new Date().toISOString() };
}

const clearCaches = () => {
    fileCache.clear();
    liveCache.clear();
    liveSizes.clear();
};

module.exports = { readTableRows, parseFileRows, typeFileColumns, clearCaches, CELL_CAP, COLUMN_CAP, COPY_ROW_CAP, LIVE_ROW_CAP,
    FILE_BYTES, MAX_BUILDS };
