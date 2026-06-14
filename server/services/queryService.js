const { getResourceById } = require('../db/catalogReadQueries');
const { computeQueryMode } = require('./catalogService');
const { datastoreSearch } = require('./ckanClient');
const { parseFilters, validateSort, validateAggregation } = require('../utils/filterGrammar');
const { queryStoreTable, aggregateStoreTable, touchLastAccessed, profileStoreTable } = require('../db/storeQueries');
const { logQueryHit } = require('../db/queryLogQueries');
const { createCache } = require('../utils/cache');
const AppError = require('../utils/AppError');

const proxyCache = createCache({ name: 'datastore-proxy', ttlMs: 5 * 60 * 1000, negativeTtlMs: 60 * 1000 });
// Ingested data is immutable until a re-ingest replaces it, so a profile can be
// cached hard. The key folds in ingested_at so a refresh busts a stale profile.
const profileCache = createCache({ name: 'store-profile', ttlMs: 30 * 60 * 1000, negativeTtlMs: 30 * 1000 });

const hasAggParams = (group_by, agg, agg_column, bucket) => [group_by, agg, agg_column, bucket].some(v => v !== undefined && v !== null && v !== '');

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
    return n;
}

async function queryResource(id, { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket } = {}) {
    const lim = clampLimit(limit);
    const off = clampOffset(offset);

    const row = await getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);

    const mode = computeQueryMode(row);
    const parsedFilters = parseFilters(filters);

    if (mode === 'datastore') {
        if (hasAggParams(group_by, agg, agg_column, bucket)) {
            throw new AppError('Aggregation is only supported for unlocked (ingested) resources', 400);
        }
        if (parsedFilters.some(f => f.op !== 'eq')) throw new AppError('Only equality filters are supported for datastore resources', 400);
        if (sort !== undefined && sort !== null && (typeof sort !== 'string' || sort.length > 100)) throw new AppError('invalid sort', 400);
        const ckanFilters = parsedFilters.length ? Object.fromEntries(parsedFilters.map(f => [f.column, f.value])) : undefined;
        const cacheKey = JSON.stringify([id, q || null, ckanFilters || null, sort || null, lim, off]);
        const result = await proxyCache.get(cacheKey, () => datastoreSearch({ resourceId: id, q, filters: ckanFilters, sort, limit: lim, offset: off }));
        if (!result) throw new AppError('Upstream datastore unavailable', 502);
        logQueryHit(id, 'datastore').catch(() => {});
        return { query_mode: 'datastore', fields: result.fields, records: result.records, total: result.total };
    }

    if (mode === 'ingested') {
        const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
        const knownColumns = columns.map(c => c.id);
        const knownSet = new Set(knownColumns);
        for (const f of parsedFilters) {
            if (!knownSet.has(f.column)) throw new AppError('unknown column: ' + f.column, 400);
        }
        const aggSpec = validateAggregation({ group_by, agg, agg_column, bucket }, columns);
        if (aggSpec) {
            const sortInfo = validateSort(sort, ['key', 'value']);
            const { records, total } = await aggregateStoreTable({ tableName: row.table_name, knownColumns, q, filters: parsedFilters, groupBy: aggSpec.groupBy, agg: aggSpec.agg, aggColumn: aggSpec.aggColumn, bucket: aggSpec.bucket, sortSql: sortInfo ? sortInfo.sql : null, limit: lim, offset: off });
            touchLastAccessed(id).catch(() => {});
            logQueryHit(id, 'ingested').catch(() => {});
            return { query_mode: 'ingested', fields: aggSpec.fields, records, total, aggregation: { group_by: aggSpec.groupBy, agg: aggSpec.agg, agg_column: aggSpec.aggColumn, bucket: aggSpec.bucket } };
        }
        const sortInfo = validateSort(sort, ["_id"].concat(knownColumns));
        const { records, total } = await queryStoreTable({ tableName: row.table_name, knownColumns, q, filters: parsedFilters, sortSql: sortInfo ? sortInfo.sql : null, limit: lim, offset: off });
        touchLastAccessed(id).catch(() => {});
        logQueryHit(id, 'ingested').catch(() => {});
        const fields = [{ id: '_id', type: 'int' }].concat(columns);
        return { query_mode: 'ingested', fields, records, total };
    }

    if (mode === 'ingestable') {
        const err = new AppError('Resource is not ingested yet', 409);
        err.hint = 'POST /api/v1/resources/' + id + '/ingest';
        throw err;
    }

    const err = new AppError('Resource is a file download only and cannot be queried', 422);
    err.download_url = row.url;
    throw err;
}

async function queryResourceForExport(id, { q, filters, sort, group_by, agg, agg_column, bucket } = {}) {
    const cap = Number(process.env.EXPORT_MAX_ROWS) || 10000;
    const row = await getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);

    const mode = computeQueryMode(row);
    const parsedFilters = parseFilters(filters);

    if (mode === 'datastore') {
        if (hasAggParams(group_by, agg, agg_column, bucket)) {
            throw new AppError('Aggregation is only supported for unlocked (ingested) resources', 400);
        }
        if (parsedFilters.some(f => f.op !== 'eq')) throw new AppError('Only equality filters are supported for datastore resources', 400);
        if (sort !== undefined && sort !== null && (typeof sort !== 'string' || sort.length > 100)) throw new AppError('invalid sort', 400);
        const ckanFilters = parsedFilters.length ? Object.fromEntries(parsedFilters.map(f => [f.column, f.value])) : undefined;
        const result = await datastoreSearch({ resourceId: id, q, filters: ckanFilters, sort, limit: cap, offset: 0 });
        if (!result) throw new AppError('Upstream datastore unavailable', 502);
        logQueryHit(id, 'datastore').catch(() => {});
        return { fields: result.fields, records: result.records };
    }

    if (mode === 'ingested') {
        const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
        const knownColumns = columns.map(c => c.id);
        const knownSet = new Set(knownColumns);
        for (const f of parsedFilters) {
            if (!knownSet.has(f.column)) throw new AppError('unknown column: ' + f.column, 400);
        }
        const aggSpec = validateAggregation({ group_by, agg, agg_column, bucket }, columns);
        if (aggSpec) {
            const sortInfo = validateSort(sort, ['key', 'value']);
            const { records } = await aggregateStoreTable({ tableName: row.table_name, knownColumns, q, filters: parsedFilters, groupBy: aggSpec.groupBy, agg: aggSpec.agg, aggColumn: aggSpec.aggColumn, bucket: aggSpec.bucket, sortSql: sortInfo ? sortInfo.sql : null, limit: cap, offset: 0 });
            touchLastAccessed(id).catch(() => {});
            logQueryHit(id, 'ingested').catch(() => {});
            return { fields: aggSpec.fields, records };
        }
        const sortInfo = validateSort(sort, ["_id"].concat(knownColumns));
        const { records } = await queryStoreTable({ tableName: row.table_name, knownColumns, q, filters: parsedFilters, sortSql: sortInfo ? sortInfo.sql : null, limit: cap, offset: 0 });
        touchLastAccessed(id).catch(() => {});
        logQueryHit(id, 'ingested').catch(() => {});
        const fields = [{ id: '_id', type: 'int' }].concat(columns);
        return { fields, records };
    }

    if (mode === 'ingestable') {
        const err = new AppError('Resource is not ingested yet', 409);
        err.hint = 'POST /api/v1/resources/' + id + '/ingest';
        throw err;
    }

    const err = new AppError('Resource is a file download only and cannot be queried', 422);
    err.download_url = row.url;
    throw err;
}

async function profileResource(id) {
    const row = await getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);

    const mode = computeQueryMode(row);

    if (mode === 'ingested') {
        const columns = Array.isArray(row.ingested_columns) ? row.ingested_columns : [];
        const cacheKey = JSON.stringify([row.table_name, row.ingested_at || null]);
        const profile = await profileCache.get(cacheKey, () => profileStoreTable({ tableName: row.table_name, columns }));
        return { query_mode: 'ingested', row_count: profile.rowCount, columns: profile.columns };
    }

    if (mode === 'datastore') {
        // CKAN's datastore_search has no cheap per-column distinct/range probe,
        // so the auto-dashboard is an unlocked-table feature only.
        throw new AppError('Profiling is only supported for unlocked (ingested) resources', 400);
    }

    if (mode === 'ingestable') {
        const err = new AppError('Resource is not ingested yet', 409);
        err.hint = 'POST /api/v1/resources/' + id + '/ingest';
        throw err;
    }

    const err = new AppError('Resource is a file download only and cannot be profiled', 422);
    err.download_url = row.url;
    throw err;
}

module.exports = { queryResource, queryResourceForExport, profileResource };
