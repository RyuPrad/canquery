const catalogReadQueries = require('../db/catalogReadQueries');
const { fetchPublicJson } = require('./publicJson');
const { createCache } = require('../utils/cache');
const AppError = require('../utils/AppError');
const { shapeProvenance } = require('./catalogService');

const mapCache = createCache({
    name: 'arcgis-map',
    ttlMs: 60_000,
    negativeTtlMs: 15_000,
    maxEntries: 250,
    maxInFlight: 20
});
const MAX_ACTIVE_FETCHES = 20;
let activeFetches = 0;

function parseBbox(raw) {
    if (typeof raw !== 'string') throw new AppError('bbox is required', 400);
    const values = raw.split(',').map(Number);
    if (values.length !== 4 || values.some(value => !Number.isFinite(value))) {
        throw new AppError('bbox must contain west,south,east,north', 400);
    }
    const [west, south, east, north] = values;
    if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
        throw new AppError('bbox is outside WGS84 bounds', 400);
    }
    return values;
}

function parseInteger(value, { name, fallback, min, max }) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new AppError(name + ' must be between ' + min + ' and ' + max, 400);
    }
    return number;
}

function safeFields(row) {
    const fields = Array.isArray(row.fields) ? row.fields : [];
    return fields
        .filter(field => field && /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name || ''))
        .slice(0, 20)
        .map(field => ({ name: field.name, alias: String(field.alias || field.name).slice(0, 200), type: field.type || 'text' }));
}

function simplificationForZoom(zoom) {
    return Math.max(0.000001, 360 / (256 * (2 ** zoom)));
}

function buildArcgisUrl(row, bbox, zoom, limit, fields) {
    const url = new URL(String(row.service_url).replace(/\/+$/, '') + '/query');
    const effectiveLimit = Math.min(limit, Number(row.max_record_count) || limit);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('geometry', bbox.join(','));
    url.searchParams.set('geometryType', 'esriGeometryEnvelope');
    url.searchParams.set('inSR', '4326');
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    url.searchParams.set('outFields', fields.length ? fields.map(field => field.name).join(',') : String(row.object_id_field || '*'));
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('resultRecordCount', String(effectiveLimit));
    url.searchParams.set('geometryPrecision', '6');
    url.searchParams.set('maxAllowableOffset', String(simplificationForZoom(zoom)));
    url.searchParams.set('f', 'geojson');
    return { url: url.href, effectiveLimit };
}

function cleanFeatureCollection(payload, fields, limit) {
    if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
        throw new Error('ArcGIS returned an invalid GeoJSON feature collection');
    }
    const names = new Set(fields.map(field => field.name));
    const features = payload.features.slice(0, limit).map(feature => {
        const properties = {};
        for (const [key, value] of Object.entries(feature && feature.properties || {})) {
            if (names.size === 0 || names.has(key)) properties[key] = value;
        }
        return {
            type: 'Feature',
            id: feature && feature.id,
            geometry: feature && feature.geometry || null,
            properties
        };
    });
    return {
        collection: { type: 'FeatureCollection', features },
        exceeded: payload.exceededTransferLimit === true || payload.properties && payload.properties.exceededTransferLimit === true
    };
}

async function queryMap(resourceId, { bbox, zoom, limit }, options = {}) {
    const bounds = parseBbox(bbox);
    const mapZoom = parseInteger(zoom, { name: 'zoom', fallback: 11, min: 0, max: 22 });
    const requestedLimit = parseInteger(limit, { name: 'limit', fallback: 1000, min: 1, max: 1000 });
    const row = await (options.getResourceMapById || catalogReadQueries.getResourceMapById)(resourceId);
    if (!row) throw new AppError('Resource has no live map layer', 422);
    const fields = safeFields(row);
    const normalizedBounds = bounds.map(value => Number(value.toFixed(5)));
    const { url, effectiveLimit } = buildArcgisUrl(row, normalizedBounds, mapZoom, requestedLimit, fields);
    const key = JSON.stringify([resourceId, normalizedBounds, mapZoom, effectiveLimit]);
    let result;
    try {
        result = await mapCache.get(key, async () => {
            try {
                if (activeFetches >= MAX_ACTIVE_FETCHES) {
                    throw new AppError('Map service is busy; try again shortly', 503);
                }
                activeFetches += 1;
                let payload;
                try {
                    payload = await (options.fetchJson || fetchPublicJson)(url, {
                        timeoutMs: 15_000,
                        maxBytes: 8 * 1024 * 1024,
                        maxRetries: 1
                    });
                } finally {
                    activeFetches -= 1;
                }
                if (payload && payload.error) return null;
                return cleanFeatureCollection(payload, fields, effectiveLimit);
            } catch (error) {
                if (error instanceof AppError) throw error;
                if (error && error.code === 'UPSTREAM_JSON_CAP') throw new AppError('Map viewport contains too much geometry; zoom in', 413);
                return null;
            }
        });
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('Map data is temporarily unavailable', 502);
    }
    if (!result) throw new AppError('Map data is temporarily unavailable', 502);
    const returned = result.collection.features.length;
    return {
        data: result.collection,
        map: {
            live: true,
            geometry_type: row.geometry_type,
            extent: row.extent || null,
            fields,
            returned,
            truncated: result.exceeded || returned >= effectiveLimit
        },
        provenance: shapeProvenance(row.provenance_sources)
    };
}

module.exports = {
    queryMap,
    parseBbox,
    parseInteger,
    safeFields,
    buildArcgisUrl,
    cleanFeatureCollection,
    simplificationForZoom
};
