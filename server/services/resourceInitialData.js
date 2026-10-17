const catalogService = require('./catalogService');
const queryService = require('./queryService');
const { resourceEnvelope, queryEnvelope } = require('./resourceEnvelopes');
const { snapshotInfo } = require('./snapshotIdentity');

// A direct visit to /resources/:id receives, inside its HTML, the same two
// envelopes the browser would otherwise fetch one after the other: the
// resource metadata and the first page of rows. The page then draws its table
// on the first application paint. The HTML path stays bounded: only the
// unfiltered table view is embedded (an index scan with the stored row count,
// cheap for every table size), the payload is capped, and a slow or failing
// read simply leaves the rows out so the browser fetches them as before.
const INLINE_ROWS_LIMIT = 50;
const INLINE_MAX_BYTES = 256 * 1024;
const INLINE_ROWS_TIMEOUT_MS = 2000;
const PAYLOAD_VERSION = 1;

// The browser explorer reads q, cf, sort, page and view from the URL
// (client/src/utils/resourceExplorerState.js). Search, column filters and
// sorting are left to the client, which first reconciles them against the
// recorded schema.
function rowsRequested(params) {
    const view = params.get('view');
    return !params.get('q') && !params.get('cf') && !params.get('sort') && (!view || view === 'table');
}

// Mirrors readResourceUrl: integers above zero, capped at the offset ceiling.
function pageIndex(params, maxOffset) {
    const page = Number(params.get('page'));
    const maxPage = Math.floor(maxOffset / INLINE_ROWS_LIMIT);
    return Number.isInteger(page) && page > 0 ? Math.min(page, maxPage) : 0;
}

const { withinBudget } = require('../utils/timeBudget');

const defaultDeps = {
    resourceDetail: row => catalogService.resourceDetail(row),
    computeQueryMode: row => catalogService.computeQueryMode(row),
    resourceEnvelope,
    queryEnvelope,
    snapshotInfo,
    queryRows: (id, options, execution) => queryService.queryResource(id, options, execution),
    maxOffset: () => queryService.queryLimits().max_offset,
    timeoutMs: INLINE_ROWS_TIMEOUT_MS,
    warn: message => console.warn(message)
};

async function resourceInitialData(row, { path, params, signal, log = false } = {}, overrides = {}) {
    const deps = { ...defaultDeps, ...overrides };
    const payload = { version: PAYLOAD_VERSION, path, page: null,
        resource: deps.resourceEnvelope(deps.resourceDetail(row)), rows: null };
    const snapshot = deps.snapshotInfo(row);
    if (deps.computeQueryMode(row) !== 'ingested' || !snapshot || !rowsRequested(params)) return payload;
    const page = pageIndex(params, deps.maxOffset());
    let result;
    try {
        result = await withinBudget(deps.queryRows(row.id,
            { limit: INLINE_ROWS_LIMIT, offset: page * INLINE_ROWS_LIMIT, snapshot: snapshot.id },
            { initial: row, signal, touch: false, log }), deps.timeoutMs);
    } catch (err) {
        deps.warn('Initial rows skipped for ' + row.id + ': ' + err.message);
        return payload;
    }
    if (!result) {
        deps.warn('Initial rows skipped for ' + row.id + ': read exceeded ' + deps.timeoutMs + ' ms');
        return payload;
    }
    const rows = deps.queryEnvelope(result);
    if (Buffer.byteLength(JSON.stringify(rows)) > INLINE_MAX_BYTES) return payload;
    return { ...payload, page, rows };
}

module.exports = { resourceInitialData, rowsRequested, pageIndex, withinBudget,
    INLINE_ROWS_LIMIT, INLINE_MAX_BYTES, INLINE_ROWS_TIMEOUT_MS, PAYLOAD_VERSION };
