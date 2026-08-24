const fs = require('node:fs');
const os = require('node:os');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { parse } = require('csv-parse');
const { from: copyFrom } = require('pg-copy-streams');
const streamJson = require('stream-json');
const streamPick = require('stream-json/filters/pick.js');
const streamArray = require('stream-json/streamers/stream-array.js');
const metadataPool = require('../db/pool');
const indexPool = require('../db/longRunningPool');
const { downloadToTempFile, sniffCsvMeta } = require('./csvDownload');
const { escapeCsvValue, csvParseOptions } = require('./csvLoad');
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
    if (candidate.expectedBytes != null && Number(candidate.expectedBytes) > caps.maxFileBytes) {
        throw new MapSkipError('source file size exceeds map cap ' + caps.maxFileBytes, 'CAP_FILE');
    }
}

function candidateMode(candidate = {}) {
    const mode = candidate.mode || 'ckan-datastore-csv';
    if (!['ckan-datastore-csv', 'geojson-file'].includes(mode)) {
        throw new MapSkipError('unsupported map candidate mode', 'MAP_SOURCE');
    }
    return mode;
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

function scalarPropertyValue(value) {
    if (value != null && typeof value === 'object') return null;
    return scalarValue(value);
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

function selectGeoJsonPropertyFields(properties) {
    const sample = properties && typeof properties === 'object' && !Array.isArray(properties)
        ? properties : {};
    const headers = Object.keys(sample).filter(name => scalarPropertyValue(sample[name]) != null);
    return selectPropertyFields(headers, sample, null);
}

function sourceSridFromCrs({ present, type, name, isNull }) {
    if (!present || isNull) return 4326;
    if (String(type || '').toLowerCase() !== 'name' || typeof name !== 'string') {
        throw new MapSkipError('GeoJSON uses an unsupported CRS declaration', 'MAP_CRS');
    }
    const normalized = name.trim();
    if (/CRS84$/i.test(normalized)) return 4326;
    if (!/EPSG/i.test(normalized)) {
        throw new MapSkipError('GeoJSON CRS is not an EPSG or CRS84 name', 'MAP_CRS');
    }
    const match = normalized.match(/(\d+)\s*$/);
    const srid = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(srid) || srid < 1 || srid > 998999) {
        throw new MapSkipError('GeoJSON CRS has an invalid EPSG identifier', 'MAP_CRS');
    }
    return srid;
}

async function inspectGeoJsonFile(filePath) {
    let depth = 0;
    let rootKind = null;
    let rootType = null;
    let rootKey = null;
    let featuresArray = false;
    let crsPresent = false;
    let crsObject = false;
    let crsNull = false;
    let crsType = null;
    let crsName = null;
    let expectedCrsValue = null;
    const sink = new Writable({
        objectMode: true,
        write(token, encoding, callback) {
            try {
                if (token.name === 'startObject' || token.name === 'startArray') {
                    if (depth === 0) rootKind = token.name;
                    if (depth === 1 && rootKey === 'features') {
                        featuresArray = token.name === 'startArray';
                    }
                    if (depth === 1 && rootKey === 'crs') {
                        crsPresent = true;
                        crsObject = token.name === 'startObject';
                    }
                    depth += 1;
                } else if (token.name === 'endObject' || token.name === 'endArray') {
                    depth -= 1;
                } else if (token.name === 'keyValue') {
                    if (depth === 1) {
                        rootKey = token.value;
                    } else if (rootKey === 'crs' && token.value === 'type') {
                        expectedCrsValue = 'type';
                    } else if (rootKey === 'crs' && token.value === 'name') {
                        expectedCrsValue = 'name';
                    } else {
                        expectedCrsValue = null;
                    }
                } else if (token.name === 'stringValue') {
                    if (depth === 1 && rootKey === 'type') rootType = token.value;
                    if (rootKey === 'crs' && expectedCrsValue === 'type') crsType = token.value;
                    if (rootKey === 'crs' && expectedCrsValue === 'name') crsName = token.value;
                    expectedCrsValue = null;
                } else if (depth === 1 && rootKey === 'crs' && token.name === 'nullValue') {
                    crsPresent = true;
                    crsNull = true;
                }
                callback();
            } catch (error) {
                callback(error);
            }
        }
    });
    try {
        await pipeline(fs.createReadStream(filePath), streamJson.parser.asStream(), sink);
    } catch (error) {
        if (error instanceof MapSkipError) throw error;
        throw new MapSkipError('source is not valid JSON: ' + error.message, 'MAP_GEOMETRY');
    }
    if (rootKind !== 'startObject' || rootType !== 'FeatureCollection' || !featuresArray) {
        throw new MapSkipError('source is not a GeoJSON FeatureCollection', 'MAP_GEOMETRY');
    }
    if (crsPresent && !crsNull && !crsObject) {
        throw new MapSkipError('GeoJSON uses an unsupported CRS declaration', 'MAP_CRS');
    }
    return {
        sourceSrid: sourceSridFromCrs({
            present: crsPresent, type: crsType, name: crsName, isNull: crsNull
        }),
        crsName: crsName || null
    };
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

function geoJsonStagingTransform({ caps, onMetadata }) {
    let rowCount = 0;
    let featureCount = 0;
    let vertexCount = 0;
    let invalidCount = 0;
    let fields = null;
    const geometryTypes = new Set();
    const transform = new Transform({
        writableObjectMode: true,
        transform(entry, encoding, callback) {
            try {
                rowCount += 1;
                if (rowCount > caps.maxRows) {
                    throw new MapSkipError('row count exceeds map cap ' + caps.maxRows, 'MAP_ROWS');
                }
                const feature = entry && entry.value;
                const geometry = feature && feature.type === 'Feature' ? feature.geometry : null;
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
                const properties = feature.properties && typeof feature.properties === 'object' &&
                    !Array.isArray(feature.properties) ? feature.properties : {};
                if (!fields) {
                    fields = selectGeoJsonPropertyFields(properties);
                    onMetadata({ geometryColumn: 'geometry', fields });
                }
                const selected = {};
                for (const field of fields) selected[field.name] = scalarPropertyValue(properties[field.name]);
                geometryTypes.add(normalizedGeometryType(geometry.type));
                featureCount += 1;
                callback(null, [
                    escapeCsvValue(rowCount),
                    escapeCsvValue(JSON.stringify(geometry)),
                    escapeCsvValue(JSON.stringify(selected))
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

function validWgs84Extent(extent) {
    if (!Array.isArray(extent) || extent.length !== 4) return false;
    const values = extent.map(Number);
    return values.every(Number.isFinite) &&
        values[0] >= -180 && values[0] <= 180 &&
        values[2] >= -180 && values[2] <= 180 &&
        values[1] >= -90 && values[1] <= 90 &&
        values[3] >= -90 && values[3] <= 90 &&
        values[0] <= values[2] && values[1] <= values[3];
}

async function assertKnownSrid(client, srid) {
    const result = await client.query('SELECT 1 FROM spatial_ref_sys WHERE srid = $1', [srid]);
    if (result.rowCount !== 1) {
        throw new MapSkipError('PostGIS does not recognize source EPSG:' + srid, 'MAP_CRS');
    }
}

async function copyCandidateToStage({ mode, filePath, csvMeta, caps, client }) {
    let metadata = null;
    let transform;
    if (mode === 'geojson-file') {
        transform = geoJsonStagingTransform({ caps, onMetadata: value => { metadata = value; } });
        await pipeline(
            fs.createReadStream(filePath),
            streamJson.parser.asStream(),
            streamPick.asStream({ filter: 'features' }),
            streamArray.asStream(),
            transform,
            client.query(copyFrom('COPY map_stage (feature_id, geom_json, properties) FROM STDIN WITH (FORMAT csv)'))
        );
    } else {
        transform = stagingTransform({ caps, onMetadata: value => { metadata = value; } });
        await pipeline(
            fs.createReadStream(filePath, { encoding: csvMeta.encoding }),
            parse(csvParseOptions({ columns: true, delimiter: csvMeta.delimiter })),
            transform,
            client.query(copyFrom('COPY map_stage (feature_id, geom_json, properties) FROM STDIN WITH (FORMAT csv)'))
        );
    }
    const result = transform.result();
    if (!metadata || result.featureCount === 0) {
        throw new MapSkipError('source contains no valid GeoJSON geometry', 'MAP_GEOMETRY');
    }
    return { metadata, result };
}

async function indexMapResource(resource, job, workerId, capsRaw = {}, options = {}) {
    const caps = mapCaps(capsRaw);
    const candidate = { ...(job.candidate || {}) };
    const mode = candidateMode(candidate);
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
        const geoJsonMeta = mode === 'geojson-file' ? await inspectGeoJsonFile(filePath) : null;
        const csvMeta = mode === 'ckan-datastore-csv' ? await sniffCsvMeta(filePath) : null;
        const sourceSrid = geoJsonMeta ? geoJsonMeta.sourceSrid : 4326;
        const db = options.indexPool || indexPool;
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await assertKnownSrid(client, sourceSrid);
            await client.query(`
                CREATE TEMP TABLE map_stage (
                    feature_id bigint NOT NULL,
                    geom_json text NOT NULL,
                    properties jsonb NOT NULL,
                    geom geometry
                ) ON COMMIT DROP
            `);
            const { metadata, result } = await copyCandidateToStage({
                mode, filePath, csvMeta, caps, client
            });

            await client.query(`
                CREATE OR REPLACE FUNCTION pg_temp.canquery_safe_map_geometry(
                    input text, input_srid integer
                ) RETURNS geometry LANGUAGE plpgsql AS $function$
                DECLARE parsed geometry;
                BEGIN
                    parsed := ST_GeomFromGeoJSON(input);
                    IF parsed IS NULL THEN RETURN NULL; END IF;
                    parsed := ST_SetSRID(parsed, input_srid);
                    IF NOT ST_IsValid(parsed) THEN parsed := ST_MakeValid(parsed); END IF;
                    IF input_srid <> 4326 THEN parsed := ST_Transform(parsed, 4326); END IF;
                    parsed := ST_Force2D(parsed);
                    IF ST_IsEmpty(parsed) THEN RETURN NULL; END IF;
                    RETURN parsed;
                EXCEPTION WHEN OTHERS THEN
                    RETURN NULL;
                END
                $function$
            `);
            await client.query(`
                UPDATE map_stage
                SET geom = pg_temp.canquery_safe_map_geometry(geom_json, $1)
            `, [sourceSrid]);
            const converted = await client.query(`
                SELECT count(*) FILTER (WHERE geom IS NOT NULL)::int AS valid,
                       count(*) FILTER (WHERE geom IS NULL)::int AS invalid
                FROM map_stage
            `);
            const validFeatures = Number(converted.rows[0].valid) || 0;
            result.invalidCount += Number(converted.rows[0].invalid) || 0;
            result.featureCount = validFeatures;
            if (validFeatures === 0) {
                throw new MapSkipError('source contains no transformable GeoJSON geometry', 'MAP_GEOMETRY');
            }

            await client.query('DELETE FROM map_store.features WHERE resource_id = $1', [resource.id]);
            await client.query(`
                INSERT INTO map_store.features (resource_id, feature_id, geom, properties)
                SELECT $1, feature_id, geom, properties
                FROM map_stage WHERE geom IS NOT NULL
            `, [resource.id]);
            const spatial = await client.query(`
                WITH bounds AS (
                    SELECT ST_Extent(geom) AS extent,
                           coalesce(sum(pg_column_size(f)), 0)::bigint AS data_bytes,
                           count(*)::int AS feature_count
                    FROM map_store.features f WHERE resource_id = $1
                )
                SELECT CASE WHEN extent IS NULL THEN NULL ELSE jsonb_build_array(
                           ST_XMin(extent::box3d), ST_YMin(extent::box3d),
                           ST_XMax(extent::box3d), ST_YMax(extent::box3d)
                       ) END AS extent,
                       data_bytes, feature_count
                FROM bounds
            `, [resource.id]);
            const extent = spatial.rows[0].extent;
            if (!validWgs84Extent(extent)) {
                throw new MapSkipError('transformed GeoJSON extent is outside WGS84 bounds', 'MAP_CRS');
            }
            result.featureCount = Number(spatial.rows[0].feature_count) || 0;
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
                JSON.stringify(extent), metadata.geometryColumn,
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
    candidateMode,
    geometryVertexCount,
    normalizedGeometryType,
    selectPropertyFields,
    selectGeoJsonPropertyFields,
    stagingTransform,
    geoJsonStagingTransform,
    sourceSridFromCrs,
    inspectGeoJsonFile,
    validWgs84Extent,
    assertKnownSrid,
    copyCandidateToStage,
    currentMapBytes,
    validateMapFilesystems,
    indexMapResource
};
