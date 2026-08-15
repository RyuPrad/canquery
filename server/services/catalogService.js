const catalogReadQueries = require('../db/catalogReadQueries');
const queryLogQueries = require('../db/queryLogQueries');
const { packageList } = require('./ckanClient');
const AppError = require('../utils/AppError');
const { createCache } = require('../utils/cache');
const { toAbsoluteUrl } = require('../utils/resolveUrl');
const { sources: configuredSources } = require('../config/catalogSources');

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 50;
const MAX_XLSX_MB = Number(process.env.MAX_XLSX_MB) || 20;

const maxFileBytes = () => MAX_FILE_MB * 1024 * 1024;

// Excel formats get a smaller cap than CSV: conversion is isolated and bounded,
// but XLSX shared strings/styles and legacy XLS parsing still expand in memory
// inside that child process.
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

const shapeSource = (source) => ({
    id: source.id,
    kind: source.kind,
    name: { en: source.name_en, fr: source.name_fr },
    homepage_url: source.homepage_url,
    landing_url: source.landing_url || null,
    upstream: source.upstream_host,
    authoritative: source.authoritative === true,
    license: source.license_url ? {
        title: { en: source.license_title_en, fr: source.license_title_fr },
        url: source.license_url,
        attribution: { en: source.attribution_en, fr: source.attribution_fr }
    } : null
});

const shapeProvenance = (raw) => {
    const sources = Array.from(new Map(
        (Array.isArray(raw) ? raw : []).map(source => {
            const shaped = shapeSource(source);
            return [shaped.id, shaped];
        })
    ).values());
    const primary = sources.find(source => source.authoritative && source.license) || sources.find(source => source.license) || null;
    return { sources, primary_license: primary ? primary.license : null };
};

const shapePlaces = (raw) => {
    const places = new Map();
    for (const place of Array.isArray(raw) ? raw : []) {
        const shaped = {
            id: place.id,
            slug: place.slug,
            kind: place.kind,
            name: { en: place.name_en, fr: place.name_fr },
            relationship: place.relationship,
            includes_descendants: place.includes_descendants === true
        };
        const current = places.get(shaped.id);
        if (!current || (current.relationship !== 'direct' && shaped.relationship === 'direct')) {
            places.set(shaped.id, shaped);
        }
    }
    return Array.from(places.values());
};

const shapePlaceMatch = (row) => row.matched_place_id ? {
    tier: Number(row.place_depth) === 0 ? 'exact' : 'parent',
    depth: Number(row.place_depth),
    relationship: row.place_relationship,
    place: {
        id: row.matched_place_id,
        slug: row.matched_place_slug,
        name: { en: row.matched_place_name_en, fr: row.matched_place_name_fr }
    }
} : null;

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
    map: row.map_provider ? {
        available: true,
        provider: row.map_provider,
        geometry_type: row.map_geometry_type,
        extent: row.map_extent || null,
        fields: Array.isArray(row.map_fields) ? row.map_fields : []
    } : null,
    ingestion: row.ingest_status
        ? { status: row.ingest_status, row_count: toNumberOrNull(row.ingested_row_count), ingested_at: row.ingested_at }
        : null
});

const parseBooleanFilter = (value, name) => {
    if (value === undefined || value === null || value === '') return null;
    if (value === true || value === 'true' || value === '1') return true;
    throw new AppError('Invalid ' + name, 400);
};

const searchDatasets = async ({ q, org, format, keyword, place, source, mappable, limit, cursor }) => {
    const lim = clampLimit(limit, 20, 100);
    const offset = parseCursor(cursor);
    const rows = await catalogReadQueries.searchDatasets({
        q, org, format, keyword, place, source,
        mappable: parseBooleanFilter(mappable, 'mappable'),
        limit: lim + 1,
        offset
    });
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
        queryable_count: r.queryable_count,
        mappable_count: r.mappable_count || 0,
        places: shapePlaces(r.places),
        place_match: shapePlaceMatch(r),
        provenance: shapeProvenance(r.provenance_sources)
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
        places: shapePlaces(row.places),
        provenance: shapeProvenance(row.provenance_sources),
        resources: resources.map(shapeResource)
    };
};

const getResource = async (id) => {
    const row = await catalogReadQueries.getResourceById(id);
    if (!row) throw new AppError('Resource not found', 404);
    const shaped = shapeResource(row);
    shaped.dataset = { id: row.dataset_id, name: row.dataset_name, title: { en: row.dataset_title_en, fr: row.dataset_title_fr } };
    shaped.places = shapePlaces(row.places);
    shaped.provenance = shapeProvenance(row.provenance_sources);
    if (row.ingest_status) {
        shaped.ingestion.byte_size = toNumberOrNull(row.ingested_byte_size);
        shaped.ingestion.columns = row.ingested_columns;
        shaped.ingestion.last_accessed_at = row.last_accessed_at;
    }
    return shaped;
};

const listOrganizations = async ({ source, place, limit, cursor }) => {
    const lim = clampLimit(limit, 50, 100);
    const offset = parseCursor(cursor);
    const rows = await catalogReadQueries.listOrganizations({ source, place, limit: lim + 1, offset });
    const hasMore = rows.length > lim;
    const page = rows.slice(0, lim);
    const items = page.map((r) => ({
        id: r.id,
        name: r.name,
        title: { en: r.title_en, fr: r.title_fr },
        dataset_count: r.dataset_count,
        place: r.place_id ? {
            id: r.place_id,
            slug: r.place_slug,
            name: { en: r.place_name_en, fr: r.place_name_fr }
        } : null
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
        mappable_resources: row.mappable_resources || 0,
        ingested_resources: row.ingested_resources,
        store_bytes: Number(row.store_bytes),
        organizations: row.organizations,
        places: row.places || 0,
        last_synced_at: lastSyncedAt
    };
};

const listSources = async ({ place } = {}) => {
    const rows = await catalogReadQueries.listSources({ place });
    return rows.map(row => ({
        id: row.id,
        kind: row.kind,
        name: { en: row.name_en, fr: row.name_fr },
        homepage_url: row.homepage_url,
        catalog_url: row.catalog_url,
        upstream: row.upstream_host,
        dataset_count: Number(row.dataset_count) || 0,
        authoritative_dataset_count: Number(row.authoritative_dataset_count) || 0,
        last_synced_at: row.last_synced_at
    }));
};

const shapePlaceRow = (row) => ({
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: { en: row.name_en, fr: row.name_fr },
    type: { en: row.type_en, fr: row.type_fr },
    featured: row.featured === true,
    parent: row.parent_id ? {
        id: row.parent_id,
        slug: row.parent_slug,
        name: { en: row.parent_name_en, fr: row.parent_name_fr }
    } : null,
    location: row.latitude == null ? null : {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        zoom: row.default_zoom == null ? null : Number(row.default_zoom)
    },
    dataset_count: Number(row.dataset_count) || 0,
    direct_dataset_count: Number(row.direct_dataset_count) || 0,
    mappable_resource_count: Number(row.mappable_resource_count) || 0
});

const listPlaces = async ({ q, kind, parent, featured, limit, cursor }) => {
    const lim = clampLimit(limit, 50, 100);
    const offset = parseCursor(cursor);
    if (kind && !['country', 'province', 'territory', 'region', 'municipality'].includes(kind)) {
        throw new AppError('Invalid place kind', 400);
    }
    const rows = await catalogReadQueries.listPlaces({
        q,
        kind,
        parent,
        featured: parseBooleanFilter(featured, 'featured'),
        limit: lim + 1,
        offset
    });
    const hasMore = rows.length > lim;
    return {
        items: rows.slice(0, lim).map(shapePlaceRow),
        nextCursor: hasMore ? String(offset + lim) : null
    };
};

const getPlace = async (idOrSlug) => {
    const row = await catalogReadQueries.getPlaceByIdOrSlug(idOrSlug);
    if (!row) throw new AppError('Place not found', 404);
    const ancestors = (row.ancestors || []).map(place => ({
        id: place.id,
        slug: place.slug,
        kind: place.kind,
        name: { en: place.name_en, fr: place.name_fr }
    }));
    return {
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        name: { en: row.name_en, fr: row.name_fr },
        type: { en: row.type_en, fr: row.type_fr },
        featured: row.featured === true,
        parent_id: row.parent_id,
        location: row.latitude == null ? null : {
            latitude: Number(row.latitude), longitude: Number(row.longitude),
            zoom: row.default_zoom == null ? null : Number(row.default_zoom)
        },
        ancestors,
        children: (row.children || []).map(shapePlaceRow),
        dataset_count: Number(row.dataset_count) || 0,
        direct_dataset_count: Number(row.direct_dataset_count) || 0,
        mappable_dataset_count: Number(row.mappable_dataset_count) || 0
    };
};

const recentlyUnlocked = async (limit, place) => {
    const lim = clampLimit(limit, 6, 20);
    const rows = await catalogReadQueries.listRecentlyIngested(lim, place || null);
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

const popularResources = async ({ days, limit, place }) => {
    const d = clampDays(days, 7, 30);
    const lim = clampLimit(limit, 6, 20);
    const rows = await queryLogQueries.listPopularResources({ days: d, limit: lim, place: place || null });
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
    for (const source of configuredSources.filter(item => item.enabled !== false)) {
        JOB_MAX_AGE_HOURS['source:' + source.id] = Math.max(24, Number(source.syncIntervalHours) * 2 || 48);
    }
    const health = await catalogReadQueries.getJobHealth();
    const lastOkByJob = {};
    for (const row of health.syncRows) {
        const name = row.kind === 'municipal' && row.source_id ? 'source:' + row.source_id : row.kind;
        lastOkByJob[name] = row.last_ok_at;
        if (name.startsWith('source:')) JOB_MAX_AGE_HOURS[name] = 48;
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

module.exports = {
    searchDatasets,
    getDataset,
    getResource,
    listOrganizations,
    listSources,
    listPlaces,
    getPlace,
    getStats,
    healthz,
    computeQueryMode,
    ingestCapBytesFor,
    recentlyUnlocked,
    popularResources,
    opsStatus,
    shapeProvenance,
    shapePlaces
};
