const fs = require('node:fs');
const os = require('node:os');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { parse } = require('csv-parse');
const { from: copyFrom } = require('pg-copy-streams');
const metadataPool = require('../db/pool');
const indexPool = require('../db/longRunningPool');
const { downloadToTempFile, sniffCsvMeta } = require('./csvDownload');
const { escapeCsvValue } = require('./csvLoad');
const { assertDiskHeadroom } = require('./ingestPipeline');

const GB = 1024 * 1024 * 1024;
const FIELD_PRIORITY = /^(?:name|title|address|street|location|type|status|category|ward|year|date)|(?:name|title|address|type|status|category|ward|year|date)$/i;

class MapSkipError extends Error {
    constructor(message, code = 'MAP_CAP') {
        super(message);
        this.name = 'MapSkipError';
        this.code = code;
    }
}

function finiteCap(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function mapCaps(overrides = {}) {
    return {
        maxRows: finiteCap(overrides.maxRows, finiteCap(process.env.MAP_MAX_ROWS, 1_000_000)),
        maxVertices: finiteCap(overrides.maxVertices, finiteCap(process.env.MAP_MAX_VERTICES, 10_000_000)),
        maxFileBytes: finiteCap(overrides.maxFileBytes, finiteCap(process.env.MAP_MAX_FILE_MB, 1024) * 1024 * 1024),
        storeBudgetBytes: finiteCap(overrides.storeBudgetBytes, finiteCap(process.env.MAP_STORE_BUDGET_GB, 20) * GB),
        minFreeBytes: finiteCap(overrides.minFreeBytes, finiteCap(process.env.MAP_MIN_FREE_GB, 30) * GB),
        storeDataPath: overrides.storeDataPath || process.env.MAP_STORE_DATA_PATH || process.env.STORE_DATA_PATH || null,
        userAgent: overrides.userAgent || process.env.CKAN_USER_AGENT || 'canquery/1.0',
        stallTimeoutMs: finiteCap(overrides.stallTimeoutMs, finiteCap(process.env.INGEST_STALL_TIMEOUT_MS, 60_000)),
        fetchImpl: overrides.fetchImpl,
        lookupImpl: overrides.lookupImpl,
        requestImpl: overrides.requestImpl
    };
}

function validateCandidate(candidate, caps) {
    if (candidate.expectedRows != null && Number(candidate.expectedRows) > caps.maxRows) {
        throw new MapSkipError('source row count exceeds map cap ' + caps.maxRows, 'MAP_ROWS');
    }
    if (candidate.expectedVertices != null && Number(candidate.expectedVertices) > caps.maxVertices) {
        throw new MapSkipError('source vertex count exceeds map cap ' + caps.maxVertices, 'MAP_VERTICES');
    }
}

function geometryVertexCount(geometry) {
    if (!geometry || typeof geometry !== 'object') return 0;
    if (geometry.type === 'GeometryCollection') {
        return (Array.isArray(geometry.geometries) ? geometry.geometries : [])
            .reduce((sum, item) => sum + geometryVertexCount(item), 0);
    }
    let count = 0;
    const walk = value => {
        if (!Array.isArray(value)) return;
        if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
            count += 1;
            return;
        }
        for (const child of value) walk(child);
    };
    walk(geometry.coordinates);
    return count;
}

function normalizedGeometryType(type) {
    const value = String(type || '').toLowerCase();
    if (value === 'point') return 'point';
    if (value === 'multipoint') return 'multipoint';
    if (value === 'linestring' || value === 'multilinestring') return 'polyline';
    if (value === 'polygon' || value === 'multipolygon') return 'polygon';
    return 'mixed';
}

function scalarValue(value) {
    if (value == null || value === '') return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if (/^-?(?:\d+|\d*\.\d+)$/.test(text)) {
        const number = Number(text);
        if (Number.isFinite(number)) return number;
    }
    return text.slice(0, 256);
}

function selectPropertyFields(headers, sample, geometryColumn) {
    const candidates = headers.filter(name => {
        if (name === geometryColumn || name.toLowerCase() === '_id') return false;
        const value = sample[name];
        if (value == null) return true;
        const text = String(value).trim();
        if (text.length > 4096 || /^[{[]/.test(text)) return false;
        return true;
    });
    candidates.sort((a, b) => {
        const aPriority = FIELD_PRIORITY.test(a) ? 0 : 1;
        const bPriority = FIELD_PRIORITY.test(b) ? 0 : 1;
        return aPriority - bPriority || headers.indexOf(a) - headers.indexOf(b);
    });
    return candidates.slice(0, 6).map(name => ({ name, alias: name, type: 'text' }));
}

function stagingTransform({ caps, onMetadata }) {
    let rowCount = 0;
    let featureCount = 0;
    let vertexCount = 0;
    let invalidCount = 0;
    let geometryColumn = null;
    let fields = null;
    const geometryTypes = new Set();
    const featureIds = new Set();
    const transform = new Transform({
        writableObjectMode: true,
        transform(record, encoding, callback) {
            try {
                rowCount += 1;
                if (rowCount > caps.maxRows) {
                    throw new MapSkipError('row count exceeds map cap ' + caps.maxRows, 'MAP_ROWS');
                }
                if (!geometryColumn) {
                    const headers = Object.keys(record);
                    geometryColumn = headers.find(name => name.toLowerCase() === 'geometry') || null;
                    if (!geometryColumn) throw new MapSkipError('DataStore has no geometry column', 'MAP_GEOMETRY');
                    fields = selectPropertyFields(headers, record, geometryColumn);
                    onMetadata({ geometryColumn, fields });
                }
                let geometry;
                try {
                    geometry = JSON.parse(record[geometryColumn]);
                } catch {
                    invalidCount += 1;
                    callback();
                    return;
                }
                if (!geometry || typeof geometry.type !== 'string') {
                    invalidCount += 1;
                    callback();
                    return;
                }
                const vertices = geometryVertexCount(geometry);
                if (vertices === 0) {
                    invalidCount += 1;
                    callback();
                    return;
                }
                vertexCount += vertices;
                if (vertexCount > caps.maxVertices) {
                    throw new MapSkipError('vertex count exceeds map cap ' + caps.maxVertices, 'MAP_VERTICES');
                }
                geometryTypes.add(normalizedGeometryType(geometry.type));
                const upstreamId = Number(record._id);
                let featureId = Number.isSafeInteger(upstreamId) ? upstreamId : rowCount;
                if (featureIds.has(featureId)) featureId = -9_000_000_000_000_000 + rowCount;
                featureIds.add(featureId);
                const properties = {};
                for (const field of fields) properties[field.name] = scalarValue(record[field.name]);
                featureCount += 1;
                callback(null, [
                    escapeCsvValue(featureId),
                    escapeCsvValue(JSON.stringify(geometry)),
                    escapeCsvValue(JSON.stringify(properties))
                ].join(',') + '\n');
            } catch (error) {
                callback(error);
            }
        }
    });
    transform.result = () => ({
        rowCount, featureCount, vertexCount, invalidCount,
        fields: fields || [],
        geometryType: geometryTypes.size === 1 ? Array.from(geometryTypes)[0] : 'mixed'
    });
    return transform;
}

async function currentMapBytes(db, excludeResourceId) {
    const result = await db.query(`
        SELECT coalesce(sum(byte_size), 0)::bigint AS bytes
        FROM resource_maps
        WHERE provider = 'canquery' AND resource_id <> $1
    `, [excludeResourceId]);
    return Number(result.rows[0].bytes) || 0;
}

async function validateMapFilesystems(capsRaw = {}) {
    const caps = mapCaps(capsRaw);
    if (process.env.NODE_ENV === 'production' && !caps.storeDataPath) {
        throw new Error('MAP_STORE_DATA_PATH or STORE_DATA_PATH is required in production');
    }
    await assertDiskHeadroom(os.tmpdir(), caps.minFreeBytes + caps.maxFileBytes, 'map temporary filesystem');
    if (caps.storeDataPath) await assertDiskHeadroom(caps.storeDataPath, caps.minFreeBytes, 'PostgreSQL map filesystem');
    return caps;
}

async function indexMapResource(resource, job, workerId, capsRaw = {}, options = {}) {
    const caps = mapCaps(capsRaw);
    const candidate = { ...(job.candidate || {}) };
    validateCandidate(candidate, caps);
    await validateMapFilesystems(caps);
    const retainedBytes = await currentMapBytes(options.metadataPool || metadataPool, resource.id);
    if (retainedBytes >= caps.storeBudgetBytes) {
        throw new MapSkipError('local map store has reached its ' + caps.storeBudgetBytes + '-byte budget', 'MAP_BUDGET');
    }
    const { filePath, bytes } = await downloadToTempFile(resource.url, {
        maxFileBytes: caps.maxFileBytes,
        fetchImpl: caps.fetchImpl,
        userAgent: caps.userAgent,
        stallTimeoutMs: caps.stallTimeoutMs,
        lookupImpl: caps.lookupImpl,
        requestImpl: caps.requestImpl
    });
    try {
        const { delimiter, encoding } = await sniffCsvMeta(filePath);
        const db = options.indexPool || indexPool;
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                CREATE TEMP TABLE map_stage (
                    feature_id bigint NOT NULL,
                    geom_json text NOT NULL,
                    properties jsonb NOT NULL
                ) ON COMMIT DROP
            `);
            let metadata = null;
            const transform = stagingTransform({ caps, onMetadata: value => { metadata = value; } });
            await pipeline(
                fs.createReadStream(filePath, { encoding }),
                parse({ columns: true, bom: true, delimiter, relax_column_count: true, skip_empty_lines: true }),
                transform,
                client.query(copyFrom('COPY map_stage (feature_id, geom_json, properties) FROM STDIN WITH (FORMAT csv)'))
            );
            const result = transform.result();
            if (!metadata || result.featureCount === 0) {
                throw new MapSkipError('source contains no valid GeoJSON geometry', 'MAP_GEOMETRY');
            }

            await client.query('DELETE FROM map_store.features WHERE resource_id = $1', [resource.id]);
            await client.query(`
                INSERT INTO map_store.features (resource_id, feature_id, geom, properties)
                SELECT $1, feature_id,
                       ST_Force2D(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geom_json), 4326))),
                       properties
                FROM map_stage
            `, [resource.id]);
            const spatial = await client.query(`
                WITH bounds AS (
                    SELECT ST_Extent(geom) AS extent,
                           coalesce(sum(pg_column_size(f)), 0)::bigint AS data_bytes
                    FROM map_store.features f WHERE resource_id = $1
                )
                SELECT CASE WHEN extent IS NULL THEN NULL ELSE jsonb_build_array(
                           ST_XMin(extent::box3d), ST_YMin(extent::box3d),
                           ST_XMax(extent::box3d), ST_YMax(extent::box3d)
                       ) END AS extent,
                       data_bytes
                FROM bounds
            `, [resource.id]);
            const logicalBytes = Math.ceil((Number(spatial.rows[0].data_bytes) || 0) * 2);
            if (retainedBytes + logicalBytes > caps.storeBudgetBytes) {
                throw new MapSkipError('local map store budget would be exceeded', 'MAP_BUDGET');
            }
            const indexedAt = new Date();
            await client.query(`
                INSERT INTO resource_maps (
                    resource_id, provider, service_url, geometry_type, extent,
                    object_id_field, display_field, fields, max_record_count,
                    feature_count, byte_size, indexed_at, source_version, updated_at
                ) VALUES ($1,'canquery',$2,$3,$4,$5,$6,$7,1000,$8,$9,$10,$11,now())
                ON CONFLICT (resource_id) DO UPDATE SET
                    provider = EXCLUDED.provider,
                    service_url = EXCLUDED.service_url,
                    geometry_type = EXCLUDED.geometry_type,
                    extent = EXCLUDED.extent,
                    object_id_field = EXCLUDED.object_id_field,
                    display_field = EXCLUDED.display_field,
                    fields = EXCLUDED.fields,
                    max_record_count = EXCLUDED.max_record_count,
                    feature_count = EXCLUDED.feature_count,
                    byte_size = EXCLUDED.byte_size,
                    indexed_at = EXCLUDED.indexed_at,
                    source_version = EXCLUDED.source_version,
                    updated_at = now()
            `, [
                resource.id, candidate.sourceUrl || resource.url, result.geometryType,
                JSON.stringify(spatial.rows[0].extent), metadata.geometryColumn,
                result.fields[0] ? result.fields[0].name : null,
                JSON.stringify(result.fields), result.featureCount, logicalBytes,
                indexedAt, job.claimed_version
            ]);
            const queue = await client.query(`
                UPDATE map_index_jobs
                SET status = CASE WHEN desired_version = $3 THEN 'ready' ELSE 'pending' END,
                    indexed_version = $3, worker_id = NULL, claimed_at = NULL,
                    heartbeat_at = NULL,
                    finished_at = CASE WHEN desired_version = $3 THEN now() ELSE NULL END,
                    error = CASE WHEN desired_version = $3 THEN NULL
                                 ELSE 'source changed during indexing; queued latest version' END,
                    feature_count = $4, vertex_count = $5, downloaded_bytes = $6,
                    updated_at = now()
                WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
                RETURNING status
            `, [resource.id, workerId, job.claimed_version, result.featureCount, result.vertexCount, bytes]);
            if (queue.rowCount !== 1) throw new Error('map worker lease lost before commit');
            await client.query('COMMIT');
            return {
                ...result, downloadedBytes: bytes, byteSize: logicalBytes,
                indexedAt, queueStatus: queue.rows[0].status
            };
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch {}
            throw error;
        } finally {
            client.release();
        }
    } finally {
        await fs.promises.unlink(filePath).catch(() => {});
    }
}

module.exports = {
    MapSkipError,
    mapCaps,
    validateCandidate,
    geometryVertexCount,
    normalizedGeometryType,
    selectPropertyFields,
    stagingTransform,
    currentMapBytes,
    validateMapFilesystems,
    indexMapResource
};
