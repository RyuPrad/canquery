const { PMTiles, SharedPromiseCache } = require('pmtiles');
const AppError = require('../utils/AppError');
const { R2PmtilesSource } = require('./r2MapStorage');

const MAX_BBOX_TILES = 64;
const MAX_TILE_RESPONSE_BYTES = 8 * 1024 * 1024;
const archiveCache = new Map();
const sharedCache = new SharedPromiseCache();

function integer(value, name, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new AppError(name + ' is invalid', 400);
    }
    return number;
}

function verifyRow(row) {
    if (!row || row.provider !== 'pmtiles' || !row.storage_key || !row.storage_etag ||
        !/^[0-9a-f]{64}$/.test(String(row.source_version || ''))) {
        throw new AppError('Resource has no PMTiles map archive', 422);
    }
    return row;
}

function archiveFor(row, options = {}) {
    verifyRow(row);
    const key = row.storage_key + '|' + row.storage_etag;
    if (options.archive) return options.archive;
    if (archiveCache.has(key)) return archiveCache.get(key);
    const archive = new PMTiles(
        new R2PmtilesSource(row.storage_key, row.storage_etag, options.storageOptions),
        sharedCache
    );
    archiveCache.set(key, archive);
    if (archiveCache.size > 500) archiveCache.delete(archiveCache.keys().next().value);
    return archive;
}

function boundedSignal(signal, timeoutMs = 15_000) {
    if (signal) return signal;
    return typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
}

function validateTile(row, { version, z, x, y }) {
    verifyRow(row);
    if (version !== row.source_version) throw new AppError('Map tile version not found', 404);
    const zoom = integer(z, 'z', Number(row.tile_min_zoom), Number(row.tile_max_zoom));
    const dimension = 2 ** zoom;
    return {
        z: zoom,
        x: integer(x, 'x', 0, dimension - 1),
        y: integer(y, 'y', 0, dimension - 1)
    };
}

async function getTile(row, coords, options = {}) {
    const tile = validateTile(row, coords);
    const archive = archiveFor(row, options);
    try {
        const result = await archive.getZxy(tile.z, tile.x, tile.y, boundedSignal(options.signal));
        if (!result) return null;
        const data = Buffer.from(result.data);
        if (data.byteLength > MAX_TILE_RESPONSE_BYTES) {
            throw new AppError('Map tile exceeds the response cap', 502);
        }
        return data;
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('Map tile is temporarily unavailable', 502);
    }
}

function lonTile(lon, zoom) {
    return Math.floor(((lon + 180) / 360) * (2 ** zoom));
}

function latTile(lat, zoom) {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const radians = clamped * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * (2 ** zoom));
}

function tilesForBbox(bbox, zoom) {
    const dimension = 2 ** zoom;
    const minX = Math.max(0, Math.min(dimension - 1, lonTile(bbox[0], zoom)));
    const maxX = Math.max(0, Math.min(dimension - 1, lonTile(bbox[2], zoom)));
    const minY = Math.max(0, Math.min(dimension - 1, latTile(bbox[3], zoom)));
    const maxY = Math.max(0, Math.min(dimension - 1, latTile(bbox[1], zoom)));
    const tiles = [];
    for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) tiles.push({ z: zoom, x, y });
    }
    if (tiles.length > MAX_BBOX_TILES) {
        throw new AppError('Map viewport contains too many tiles; zoom in', 413);
    }
    return tiles;
}

function geometryBounds(geometry, bounds = [Infinity, Infinity, -Infinity, -Infinity]) {
    if (!geometry) return bounds;
    if (geometry.type === 'GeometryCollection') {
        for (const item of geometry.geometries || []) geometryBounds(item, bounds);
        return bounds;
    }
    const visit = value => {
        if (!Array.isArray(value)) return;
        if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
            bounds[0] = Math.min(bounds[0], value[0]);
            bounds[1] = Math.min(bounds[1], value[1]);
            bounds[2] = Math.max(bounds[2], value[0]);
            bounds[3] = Math.max(bounds[3], value[1]);
            return;
        }
        for (const child of value) visit(child);
    };
    visit(geometry.coordinates);
    return bounds;
}

function intersects(geometry, bbox) {
    const bounds = geometryBounds(geometry);
    return Number.isFinite(bounds[0]) && bounds[0] <= bbox[2] && bounds[2] >= bbox[0] &&
        bounds[1] <= bbox[3] && bounds[3] >= bbox[1];
}

async function decodeViewport(row, { bbox, zoom, limit }, options = {}) {
    verifyRow(row);
    const effectiveZoom = Math.max(Number(row.tile_min_zoom),
        Math.min(Number(row.tile_max_zoom), Number(zoom)));
    const tiles = tilesForBbox(bbox, effectiveZoom);
    const archive = archiveFor(row, options);
    const signal = boundedSignal(options.signal, 30_000);
    const fields = new Set((Array.isArray(row.fields) ? row.fields : []).map(field => field.name));
    const features = [];
    const seen = new Set();
    let truncated = false;
    let decoder = null;
    for (const tile of tiles) {
        let raw;
        try {
            raw = await archive.getZxy(tile.z, tile.x, tile.y, signal);
        } catch {
            throw new AppError('Map data is temporarily unavailable', 502);
        }
        if (!raw) continue;
        if (Buffer.byteLength(Buffer.from(raw.data)) > MAX_TILE_RESPONSE_BYTES) {
            throw new AppError('Map tile exceeds the response cap', 502);
        }
        if (!decoder) {
            const [{ VectorTile }, pbfModule] = await Promise.all([
                import('@mapbox/vector-tile'), import('pbf')
            ]);
            decoder = { VectorTile, Pbf: pbfModule.default || pbfModule.PbfReader };
        }
        const vector = new decoder.VectorTile(new decoder.Pbf(new Uint8Array(raw.data)));
        const layer = vector.layers[row.tile_layer];
        if (!layer) continue;
        for (let index = 0; index < layer.length; index += 1) {
            const decoded = layer.feature(index).toGeoJSON(tile.x, tile.y, tile.z);
            if (!intersects(decoded.geometry, bbox)) continue;
            const identity = decoded.id == null ? tile.x + ':' + tile.y + ':' + index : String(decoded.id);
            if (seen.has(identity)) continue;
            seen.add(identity);
            const properties = {};
            for (const [key, value] of Object.entries(decoded.properties || {})) {
                if (fields.has(key) && value != null && typeof value !== 'object') properties[key] = value;
            }
            if (features.length >= limit) {
                truncated = true;
                break;
            }
            features.push({
                type: 'Feature', id: decoded.id,
                geometry: decoded.geometry, properties
            });
        }
        if (truncated) break;
    }
    return { collection: { type: 'FeatureCollection', features }, exceeded: truncated };
}

function clearArchiveCache() {
    archiveCache.clear();
}

module.exports = {
    MAX_BBOX_TILES,
    MAX_TILE_RESPONSE_BYTES,
    integer,
    verifyRow,
    archiveFor,
    boundedSignal,
    validateTile,
    getTile,
    lonTile,
    latTile,
    tilesForBbox,
    geometryBounds,
    intersects,
    decodeViewport,
    clearArchiveCache
};
