// The website's chart requests: which table, which rows of it, then the chart
// engine (services/charts/chartEngine.js). A request holds a database
// connection only while it reads: when the charts it asks for are not computed
// yet it first waits for one of the engine's scan slots, and only then takes
// the snapshot lease.
const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode } = require('./catalogService');
const { touchLastAccessed } = require('../db/storeQueries');
const { logQueryHit } = require('../db/queryLogQueries');
const { parseFilters } = require('../utils/filterGrammar');
const { resolveLocalQueryColumns } = require('../utils/columnIdentifiers');
const { requestSignal } = require('../utils/requestContext');
const AppError = require('../utils/AppError');
const { validateSnapshot } = require('./snapshotIdentity');
const { withResource, resultContext, validateQueryText, asInputError, planQuery } = require('./queryService');
const engine = require('./charts/chartEngine');

const PURPOSES = new Set(['tab', 'card']);
const MAX_CHARTS = 12;
const MAX_SPEC_LENGTH = 2000;
// Scans one client may have running at once: the engine has three in all.
const COLD_PER_CLIENT = 2;
const cold = new Map();

function invalidSpec(message) {
    const error = new AppError(message, 400);
    error.publicCode = 'INVALID_CHART_SPEC';
    return error;
}

// What can be checked before any table is looked at.
function readRequest({ q, filters, lang, purpose, limit, snapshot } = {}) {
    validateSnapshot(snapshot);
    const wanted = purpose === undefined || purpose === null || purpose === '' ? 'tab' : purpose;
    if (typeof wanted !== 'string' || !PURPOSES.has(wanted)) throw new AppError('Invalid purpose', 400);
    let count = wanted === 'card' ? 1 : engine.CHART_LIMIT;
    if (limit !== undefined && limit !== null && limit !== '') {
        count = Number(limit);
        if (!Number.isInteger(count) || count < 1) throw new AppError('Invalid limit', 400);
        count = Math.min(count, MAX_CHARTS);
    }
    return { q: validateQueryText(q), filters: parseFilters(filters), lang: lang === 'fr' ? 'fr' : 'en', purpose: wanted, limit: count };
}

// The request against one snapshot: filters by the snapshot's own column names.
function viewOf(row, request) {
    const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
    const { filters } = resolveLocalQueryColumns({ filters: request.filters }, columns);
    const known = new Set(columns.map(column => column.id));
    for (const filter of filters) {
        if (!known.has(filter.column)) throw new AppError('unknown column: ' + filter.column, 400);
    }
    return { ...request, filters };
}

function refuseOtherModes(row, mode) {
    if (mode === 'datastore') throw new AppError('Charts are only supported for unlocked (ingested) resources', 400);
    // The shared answers for a file that is not prepared yet (409) or cannot be (422).
    planQuery(row);
    throw new AppError('Resource has no prepared copy', 409);
}

function busyClient() {
    const error = new AppError('Too many charts are being computed for you at once, try again shortly', 429);
    error.publicCode = 'CHARTS_BUSY';
    error.retryAfter = 5;
    return error;
}

// Runs `read` on the resource's current snapshot. `needsScan` says, from the
// catalogue row alone, whether the engine will have to scan the table; such
// requests wait for a scan slot before they take a connection, and one client
// may have only a few of them at once. `filtered` says whether the request
// narrows the rows: only then can a database type error be the reader's.
async function onSnapshot(id, { snapshot, client, filtered }, needsScan, read) {
    const signal = requestSignal();
    const first = await getResourceById(id);
    signal?.throwIfAborted();
    if (!first) throw new AppError('Resource not found', 404);
    const scanning = computeQueryMode(first) === 'ingested' && needsScan(first);
    if (scanning && client) {
        if ((cold.get(client) || 0) >= COLD_PER_CLIENT) throw busyClient();
        cold.set(client, (cold.get(client) || 0) + 1);
    }
    try {
        const permit = scanning ? await engine.acquireSlot({ signal }) : null;
        try {
            return await withResource(id, snapshot, async row => {
                const mode = computeQueryMode(row);
                if (mode !== 'ingested') return refuseOtherModes(row, mode);
                try {
                    return { ...resultContext(row), query_mode: mode, ...await read(row, { permit, signal }) };
                } catch (error) {
                    throw filtered ? asInputError(error) : error;
                }
            }, { initial: first, signal });
        } finally {
            if (permit) permit();
        }
    } finally {
        if (scanning && client) {
            const left = (cold.get(client) || 1) - 1;
            if (left > 0) cold.set(client, left);
            else cold.delete(client);
        }
    }
}

/**
 * The charts of a resource's table for a page, on the rows a search and
 * filters leave. A person's first look renews the copy and counts towards
 * popularity; reads a visitor did not ask for pass touch and log as false.
 */
async function resourceCharts(id, options = {}, { touch = true, log = true, client } = {}) {
    const request = readRequest(options);
    const filtered = Boolean(request.q) || request.filters.length > 0;
    return onSnapshot(id, { snapshot: options.snapshot, client, filtered }, row => !engine.isWarm(engine.describeTable(row), viewOf(row, request)), async (row, slot) => {
        const analysis = await engine.analyzeSnapshot(engine.describeTable(row), { ...viewOf(row, request), ...slot });
        if (touch) await touchLastAccessed(id, row.table_name);
        if (log) logQueryHit(id, 'ingested').catch(() => {});
        return analysis;
    });
}

function parseSpec(raw) {
    if (typeof raw !== 'string' || raw === '') throw invalidSpec('A chart needs a spec');
    if (raw.length > MAX_SPEC_LENGTH) throw invalidSpec('Chart spec too large');
    try {
        return JSON.parse(raw);
    } catch {
        throw invalidSpec('Chart spec must be valid JSON');
    }
}

/**
 * One chart built by hand in the custom builder. It neither renews the copy
 * nor counts towards popularity: the page's own charts did.
 */
async function resourceCustomChart(id, options = {}, { client } = {}) {
    const request = readRequest({ ...options, purpose: 'tab', limit: undefined });
    const spec = parseSpec(options.spec);
    const filtered = Boolean(request.q) || request.filters.length > 0;
    const view = row => { const { q, filters, lang } = viewOf(row, request); return { q, filters, lang }; };
    return onSnapshot(id, { snapshot: options.snapshot, client, filtered }, row => !engine.isCustomWarm(engine.describeTable(row), spec, view(row)),
        (row, slot) => engine.customChart(engine.describeTable(row), spec, { ...view(row), ...slot }));
}

module.exports = { resourceCharts, resourceCustomChart, MAX_CHARTS };
