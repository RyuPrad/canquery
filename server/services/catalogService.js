const catalogReadQueries = require('../db/catalogReadQueries');
const queryLogQueries = require('../db/queryLogQueries');
const { packageList } = require('./ckanClient');
const AppError = require('../utils/AppError');
const { createCache } = require('../utils/cache');
const { toAbsoluteUrl } = require('../utils/resolveUrl');

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 50;
const MAX_XLSX_MB = Number(process.env.MAX_XLSX_MB) || 20;

const maxFileBytes = () => MAX_FILE_MB * 1024 * 1024;

// Excel formats get a smaller cap than CSV: they decompress/parse in memory
// (XLSX sharedStrings load fully into RAM; XLS is read whole).
const ingestCapBytesFor = (format) => {
    if (format === 'CSV') return maxFileBytes();
    if (format === 'XLSX' || format === 'XLS') return MAX_XLSX_MB * 1024 * 1024;
    return null;
};

const clampLimit = (limit, def, max) => {
    if (limit === undefined || limit === null) return def;
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) throw new AppError('Invalid limit', 400);
    return Math.min(n, max);
};

const parseCursor = (cursor) => {
    if (cursor === undefined || cursor === null) return 0;
    const n = Number(cursor);
    if (!Number.isInteger(n) || n < 0) throw new AppError('Invalid cursor', 400);
    return n;
};

const toNumberOrNull = (v) => v === null || v === undefined ? null : Number(v);

const computeQueryMode = (row) => {
    if (row.ingest_status === 'ready') return 'ingested';
    if (row.datastore_active) return 'datastore';
    const cap = ingestCapBytesFor(row.format);
    if (cap !== null && (row.size_bytes == null || Number(row.size_bytes) <= cap)) return 'ingestable';
    return 'file-only';
};

const shapeResource = (row) => ({
    id: row.id,
    dataset_id: row.dataset_id,
    name: { en: row.name_en, fr: row.name_fr },
    format: row.format,
    url: toAbsoluteUrl(row.url),
    size_bytes: toNumberOrNull(row.size_bytes),
    datastore_active: row.datastore_active,
    language: row.language,
    last_modified: row.last_modified,
    query_mode: computeQueryMode(row),
    ingestion: row.ingest_status
        ? { status: row.ingest_status, row_count: toNumberOrNull(row.ingested_row_count), ingested_at: row.ingested_at }
        : null
});

const searchDatasets = async ({ q, org, format, keyword, limit, cursor }) => {
    const lim = clampLimit(limit, 20, 100);
    const offset = parseCursor(cursor);
    const rows = await catalogReadQueries.searchDatasets({ q, org, format, keyword, limit: lim + 1, offset });
    const hasMore = rows.length > lim;
    const page = rows.slice(0, lim);
    const items = page.map((r) => ({
        id: r.id,
        name: r.name,
        title: { en: r.title_en, fr: r.title_fr },
        organization: r.org_name
            ? { name: r.org_name, title: { en: r.org_title_en, fr: r.org_title_fr } }
            : null,
        metadata_modified: r.metadata_modified,
        resource_count: r.resource_count,
        queryable_count: r.queryable_count
    }));
    return { items, nextCursor: hasMore ? String(offset + lim) : null };
};

const getDataset = async (idOrName) => {
    const row = await catalogReadQueries.getDatasetByIdOrName(idOrName);
    if (!row) throw new AppError('Dataset not found', 404);
    const resources = await catalogReadQueries.listResourcesForDataset(row.id);
    return {
        id: row.id,
        name: row.name,
        title: { en: row.title_en, fr: row.title_fr },
        notes: { en: row.notes_en, fr: row.notes_fr },
        keywords: { en: row.keywords_en, fr: row.keywords_fr },
        metadata_modified: row.metadata_modified,
        organization: row.org_name
            ? { name: row.org_name, title: { en: row.org_title_en, fr: row.org_title_fr } }
            : null,
        resources: resources.map(shapeResource)
    };
};

const getResource = async (id) => {
    const row = await catalogReadQueries.getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);
    const shaped = shapeResource(row);
    shaped.dataset = { id: row.dataset_id, name: row.dataset_name, title: { en: row.dataset_title_en, fr: row.dataset_title_fr } };
    if (row.ingest_status) {
        shaped.ingestion.byte_size = toNumberOrNull(row.ingested_byte_size);
        shaped.ingestion.columns = row.ingested_columns;
        shaped.ingestion.last_accessed_at = row.last_accessed_at;
    }
    return shaped;
};

const listOrganizations = async ({ limit, cursor }) => {
    const lim = clampLimit(limit, 50, 100);
    const offset = parseCursor(cursor);
    const rows = await catalogReadQueries.listOrganizations({ limit: lim + 1, offset });
    const hasMore = rows.length > lim;
    const page = rows.slice(0, lim);
    const items = page.map((r) => ({
        id: r.id,
        name: r.name,
        title: { en: r.title_en, fr: r.title_fr },
        dataset_count: r.dataset_count
    }));
    return { items, nextCursor: hasMore ? String(offset + lim) : null };
};

const getStats = async () => {
    const row = await catalogReadQueries.getStats();
    const lastSyncedAt = await catalogReadQueries.getLastSyncTime();
    return {
        datasets: row.datasets,
        resources: row.resources,
        datastore_active_resources: row.datastore_active_resources,
        ingested_resources: row.ingested_resources,
        store_bytes: Number(row.store_bytes),
        organizations: row.organizations,
        last_synced_at: lastSyncedAt
    };
};

const recentlyUnlocked = async (limit) => {
    const lim = clampLimit(limit, 6, 20);
    const rows = await catalogReadQueries.listRecentlyIngested(lim);
    return rows.map((r) => ({
        resource_id: r.resource_id,
        ingested_at: r.ingested_at,
        row_count: r.row_count === null || r.row_count === undefined ? null : Number(r.row_count),
        name: { en: r.name_en, fr: r.name_fr },
        format: r.format,
        dataset: {
            id: r.dataset_id,
            name: r.dataset_name,
            title: { en: r.dataset_title_en, fr: r.dataset_title_fr }
        }
    }));
};

const clampDays = (days, def, max) => {
    if (days === undefined || days === null) return def;
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) throw new AppError('Invalid days', 400);
    return Math.min(n, max);
};

const popularResources = async ({ days, limit }) => {
    const d = clampDays(days, 7, 30);
    const lim = clampLimit(limit, 6, 20);
    const rows = await queryLogQueries.listPopularResources({ days: d, limit: lim });
    return rows.map((r) => ({
        resource_id: r.resource_id,
        hits: Number(r.hits),
        last_queried_at: r.last_queried_at,
        name: { en: r.name_en, fr: r.name_fr },
        format: r.format,
        dataset: {
            id: r.dataset_id,
            name: r.dataset_name,
            title: { en: r.dataset_title_en, fr: r.dataset_title_fr }
        }
    }));
};

const upstreamCache = createCache({ name: 'upstream-health', ttlMs: 60000, negativeTtlMs: 15000 });

const healthz = async () => {
    let db = true;
    try {
        await catalogReadQueries.pingDb();
    } catch {
        db = false;
    }
    let upstream;
    try {
        // The probe resolves null on failure (never throws): the cache only
        // negative-caches a resolved null, so a down CKAN is re-probed at most
        // once per negative window instead of on every health check.
        upstream = await upstreamCache.get('ping', async () => {
            try {
                await packageList({ limit: 1 });
                return true;
            } catch {
                return null;
            }
        });
    } catch {
        upstream = false;
    }
    upstream = upstream === true;
    return { ok: db && upstream, db, upstream };
};

const opsStatus = async () => {
    const JOB_MAX_AGE_HOURS = { full: 48, incremental: 2, 'query-log-prune': 48, evict: 48 };
    const health = await catalogReadQueries.getJobHealth();
    const lastOkByJob = {};
    for (const row of health.syncRows) {
        lastOkByJob[row.kind] = row.last_ok_at;
    }
    lastOkByJob.evict = health.evictLastOkAt;
    const jobs = {};
    const now = Date.now();
    for (const [name, maxAgeHours] of Object.entries(JOB_MAX_AGE_HOURS)) {
        const lastOkAt = lastOkByJob[name];
        if (lastOkAt === null || lastOkAt === undefined) {
            jobs[name] = { last_ok_at: null, status: 'pending' };
        } else {
            const lastOkTime = new Date(lastOkAt).getTime();
            const maxAgeMs = maxAgeHours * 3600 * 1000;
            if (now - lastOkTime > maxAgeMs) {
                jobs[name] = { last_ok_at: lastOkAt, status: 'stale' };
            } else {
                jobs[name] = { last_ok_at: lastOkAt, status: 'ok' };
            }
        }
    }
    const anyStale = Object.values(jobs).some(j => j.status === 'stale');
    return { ok: !anyStale, jobs };
};

module.exports = { searchDatasets, getDataset, getResource, listOrganizations, getStats, healthz, computeQueryMode, ingestCapBytesFor, recentlyUnlocked, popularResources, opsStatus };
