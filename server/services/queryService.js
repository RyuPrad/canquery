const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode, shapeProvenance } = require('./catalogService');
const { datastoreSearch } = require('./ckanClient');
const { parseFilters, validateSort, validateAggregation } = require('../utils/filterGrammar');
const { queryStoreTable, aggregateStoreTable, touchLastAccessed, profileStoreTable } = require('../db/storeQueries');
const { logQueryHit } = require('../db/queryLogQueries');
const { createCache } = require('../utils/cache');
const AppError = require('../utils/AppError');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { getSource } = require('../config/catalogSources');
const { withSnapshot } = require('../db/snapshotRead');
const { validateSnapshot, requireSnapshot } = require('./snapshotIdentity');
const { requestSignal } = require('../utils/requestContext');
const { resolveLocalQueryColumns } = require('../utils/columnIdentifiers');

const proxyCache = createCache({ name: 'datastore-proxy', ttlMs: 5 * 60 * 1000, negativeTtlMs: 60 * 1000, maxEntries: 1000 });
// Ingested data is immutable until a re-ingest replaces it, so a profile can be
// cached hard. The key folds in ingested_at so a refresh busts a stale profile.
const profileCache = createCache({ name: 'store-profile', ttlMs: 30 * 60 * 1000, negativeTtlMs: 30 * 1000, maxEntries: 250 });
const aggregateCache = createCache({ name: 'store-aggregates', ttlMs: 300000, negativeTtlMs: 1000,
    maxEntries: 256, cacheable: value => Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024 });
const MAX_QUERY_LENGTH = 200;
const MAX_QUERY_OFFSET = (() => {
    const raw = process.env.MAX_QUERY_OFFSET;
    if (raw === undefined || raw === '') return 10000;
    const configured = Number(raw);
    return Number.isInteger(configured) && configured >= 0 ? configured : 10000;
})();

const hasAggParams = (group_by, agg, agg_column, bucket) => [group_by, agg, agg_column, bucket].some(v => v !== undefined && v !== null && v !== '');

function datastoreTarget(row) {
    const raw = row && row.raw && typeof row.raw === 'object' ? row.raw : {};
    const sourceId = raw.source_id || 'open-canada';
    const configured = sourceId === 'open-canada' ? null : getSource(sourceId);
    if (sourceId !== 'open-canada' && (!configured || configured.kind !== 'ckan')) {
        throw new AppError('Resource catalogue source is not available', 502);
    }
    return {
        sourceId,
        resourceId: raw.upstream_resource_id || row.id,
        baseUrl: configured ? configured.catalogUrl : undefined
    };
}

function clampLimit(limit) {
    if (limit === undefined || limit === null) return 20;
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) throw new AppError('Invalid limit', 400);
    return Math.min(n, 100);
}

function clampOffset(offset) {
    if (offset === undefined || offset === null) return 0;
    const n = Number(offset);
    if (!Number.isInteger(n) || n < 0) throw new AppError('Invalid offset', 400);
    if (n > MAX_QUERY_OFFSET) throw new AppError('Offset exceeds the maximum of ' + MAX_QUERY_OFFSET, 400);
    return n;
}

function validateQueryText(q) {
    if (q === undefined || q === null || q === '') return undefined;
    if (typeof q !== 'string') throw new AppError('Invalid q', 400);
    if (q.length > MAX_QUERY_LENGTH) throw new AppError('q must be 200 characters or fewer', 400);
    return q;
}

// Metadata lookup uses a short pool query. Only a local execution owns a
// snapshot lease; remote CKAN I/O never retains a PostgreSQL client.
async function withResource(id, expected, consume) {
    const signal = requestSignal();
    signal?.throwIfAborted();
    validateSnapshot(expected);
    const initial = await getResourceById(id);
    signal?.throwIfAborted();
    if (!initial) throw new AppError('Resource not found', 404);
    if (computeQueryMode(initial) !== 'ingested') {
        requireSnapshot(initial, expected);
        return consume(initial);
    }
    const result = await withSnapshot(id, async () => {
        const current = await getResourceById(id);
        if (!current) throw new AppError('Resource not found', 404);
        requireSnapshot(current, expected);
        if (computeQueryMode(current) !== 'ingested') return { fallback: current };
        return { value: await consume(current) };
    }, undefined, { signal });
    // A refresh/eviction may have changed the backend before lock acquisition.
    return result.fallback ? consume(result.fallback) : result.value;
}

function queryLimits() {
    const configured = Number(process.env.EXPORT_MAX_ROWS);
    return { max_page_rows: 100, max_offset: MAX_QUERY_OFFSET,
        export_max_rows: Number.isInteger(configured) && configured > 0 ? Math.min(configured, 10000) : 10000 };
}

function resultContext(row) {
    return { provenance: shapeProvenance(row.provenance_sources), snapshot: requireSnapshot(row),
        retrieved_at: new Date().toISOString(), publisher_modified_at: row.last_modified || null,
        limits: queryLimits() };
}

// Pure validation is shared by JSON and CSV execution. Transport, caches and
// the lifetime of local readers remain outside this plan.
function planQuery(row, options = {}, exporting = false) {
    const { q, filters, sort, group_by, agg, agg_column, bucket } = options;
    const queryText = validateQueryText(q);
    const parsedFilters = parseFilters(filters);
    const mode = computeQueryMode(row);
    const limit = exporting ? queryLimits().export_max_rows : clampLimit(options.limit);
    const offset = exporting ? 0 : clampOffset(options.offset);
    if (mode === 'datastore') {
        if (hasAggParams(group_by, agg, agg_column, bucket)) {
            throw new AppError('Aggregation is only supported for unlocked (ingested) resources', 400);
        }
        if (parsedFilters.some(f => f.op !== 'eq')) {
            const error = new AppError('Only equality filters are supported for datastore resources', 400);
            error.hint = 'ingest_for_filters';
            throw error;
        }
        if (sort !== undefined && sort !== null && (typeof sort !== 'string' || sort.length > 100)) {
            throw new AppError('invalid sort', 400);
        }
        return { mode, queryText, limit, offset, sort, target: datastoreTarget(row),
            filters: parsedFilters.length ? Object.fromEntries(parsedFilters.map(f => [f.column, f.value])) : undefined };
    }
    if (mode === 'ingested') {
        const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
        const resolved = resolveLocalQueryColumns({ filters: parsedFilters,
            sort: hasAggParams(group_by, agg, agg_column, bucket) ? undefined : sort,
            group_by, agg_column }, columns);
        const knownColumns = columns.map(column => column.id);
        const knownSet = new Set(knownColumns);
        for (const filter of resolved.filters) {
            if (!knownSet.has(filter.column)) throw new AppError('unknown column: ' + filter.column, 400);
        }
        const aggregation = validateAggregation({ group_by: resolved.group_by, agg,
            agg_column: resolved.agg_column, bucket }, columns);
        const order = validateSort(aggregation ? sort : resolved.sort,
            aggregation ? ['key', 'value'] : ['_id', ...knownColumns]);
        return { mode, aggregation, fields: aggregation ? aggregation.fields : [{ id: '_id', type: 'int' }, ...columns],
            options: { tableName: row.table_name, knownColumns, q: queryText, filters: resolved.filters,
                sortSql: order ? order.sql : null, limit, offset, snapshotRowCount: row.ingested_row_count,
                ...(aggregation ? { groupBy: aggregation.groupBy, agg: aggregation.agg,
                    aggColumn: aggregation.aggColumn, bucket: aggregation.bucket } : {}) } };
    }
    if (mode === 'ingestable') {
        const error = new AppError('Resource is not ingested yet', 409);
        error.hint = 'POST /api/v1/resources/' + row.id + '/ingest';
        throw error;
    }
    const error = new AppError('Resource is a file download only and cannot be queried', 422);
    error.download_url = toAbsoluteUrl(row.url);
    throw error;
}

async function executeDatastore(plan, cached) {
    const { target, queryText, filters, sort, limit, offset } = plan;
    const read = () => datastoreSearch({ resourceId: target.resourceId, baseUrl: target.baseUrl,
        q: queryText, filters, sort, limit, offset, signal: requestSignal() });
    const key = JSON.stringify([target.sourceId, target.resourceId, queryText || null, filters || null, sort || null, limit, offset]);
    const result = cached ? await proxyCache.get(key, read, { deduplicate: !requestSignal() }) : await read();
    if (!result) throw new AppError('Upstream datastore unavailable', 502);
    return result;
}

async function queryResource(id, options = {}) {
    // Preserve validation before database access for invalid paging/search.
    clampLimit(options.limit);
    clampOffset(options.offset);
    validateQueryText(options.q);
    return withResource(id, options.snapshot, async row => {
        const plan = planQuery(row, options);
        const context = resultContext(row);
        let result;
        if (plan.mode === 'datastore') result = await executeDatastore(plan, true);
        else {
            const read = () => plan.aggregation ? aggregateStoreTable(plan.options) : queryStoreTable(plan.options);
            result = plan.aggregation && row.ingested_at
                ? await aggregateCache.get(JSON.stringify([row.table_name, row.ingested_at, plan.options]), read, { deduplicate: !requestSignal() })
                : await read();
            await touchLastAccessed(id, row.table_name);
        }
        logQueryHit(id, plan.mode).catch(() => {});
        return { ...context, query_mode: plan.mode, fields: plan.fields || result.fields, ...result,
            ...(plan.aggregation ? { aggregation: { group_by: plan.aggregation.groupBy, agg: plan.aggregation.agg,
                agg_column: plan.aggregation.aggColumn, bucket: plan.aggregation.bucket } } : {}) };
    });
}

// The consumer MUST finish consuming (or close) records before returning. The
// callback, including socket backpressure, runs inside the local reader lease.
async function queryResourceForExport(id, options = {}, consume) {
    if (typeof consume !== 'function') throw new TypeError('Export requires a consumer callback');
    validateQueryText(options.q);
    return withResource(id, options.snapshot, async row => {
        const plan = planQuery(row, options, true);
        const context = resultContext(row);
        if (plan.mode === 'datastore') {
            const result = await executeDatastore(plan, false);
            logQueryHit(id, 'datastore').catch(() => {});
            return consume({ ...context, fields: result.fields, records: result.records });
        }
        const cap = plan.options.limit;
        const records = trackExportActivity((async function *pages() {
            for (let offset = 0; offset < cap;) {
                const limit = Math.min(500, cap - offset);
                const read = plan.aggregation ? aggregateStoreTable : queryStoreTable;
                const page = await read({ ...plan.options, offset, limit, includeTotal: false });
                for (const record of page.records) yield record;
                if (page.records.length < limit) return;
                offset += page.records.length;
            }
        })(), id, row.table_name);
        logQueryHit(id, 'ingested').catch(() => {});
        try { return await consume({ ...context, fields: plan.fields, records }); }
        finally { await records.return(); }
    });
}

async function profileResource(id, options = {}) {
    return withResource(id, options.snapshot, async row => {
        const mode = computeQueryMode(row);
        if (mode === 'ingested') {
            const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
            const cacheKey = JSON.stringify([row.table_name, row.ingested_at || null]);
            const profile = await profileCache.get(cacheKey, () => profileStoreTable({ tableName: row.table_name, columns }), { deduplicate: !requestSignal() });
            await touchLastAccessed(id, row.table_name);
            return { ...resultContext(row), query_mode: mode, row_count: profile.rowCount, columns: profile.columns };
        }
        if (mode === 'datastore') throw new AppError('Profiling is only supported for unlocked (ingested) resources', 400);
        planQuery(row); // Shared missing-copy/download-only errors.
    });
}

async function *trackExportActivity(records, id, tableName) {
    let read = false;
    try {
        for await (const record of records) {
            read = true;
            yield record;
        }
        read = true;
    } finally {
        if (read) await touchLastAccessed(id, tableName);
    }
}

async function recordResourceActivity(id) {
    return withSnapshot(id, async () => {
        const row = await getResourceById(id);
        if (!row) throw new AppError('Resource not found', 404);
        if (row.ingest_status !== 'ready' || !row.table_name || !await touchLastAccessed(id, row.table_name)) {
            throw new AppError('Resource has no prepared copy', 409);
        }
    });
}

module.exports = { queryResource, queryResourceForExport, profileResource, datastoreTarget,
    recordResourceActivity, planQuery, queryLimits };
