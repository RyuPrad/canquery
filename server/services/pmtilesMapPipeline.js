const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { PMTiles, SharedPromiseCache, TileType } = require('pmtiles');
const metadataPool = require('../db/pool');
const { fetchPublicJson } = require('./publicJson');
const { assertDiskHeadroom } = require('./ingestPipeline');
const { getSource } = require('../config/catalogSources');
const {
    viewUrl,
    csvUrl,
    geoJsonBaseUrl,
    geoJsonPageUrl,
    directMapVersion
} = require('./socrataAdapter');
const {
    MapSkipError,
    mapCaps,
    validateCandidate,
    geometryVertexCount,
    normalizedGeometryType,
    validWgs84Extent
} = require('./mapIndexPipeline');
const {
    storageConfig,
    objectKeyFor,
    sha256File,
    headObject,
    uploadArchive
} = require('./r2MapStorage');

const GB = 1024 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 10_000;
const TILE_LAYER = 'features';
const MIN_ZOOM = 0;
const MAX_ZOOM = 16;
const MAX_TILE_BYTES = 500_000;
const MAX_FIELDS = 20;
const FIELD_PRIORITY = /^(?:name|title|address|street|location|type|status|category|ward|year|date)/i;

function finiteCap(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function pmtilesCaps(overrides = {}) {
    return {
        ...mapCaps(overrides),
        pageSize: Math.min(50_000, Math.floor(finiteCap(overrides.pageSize,
            finiteCap(process.env.MAP_SOCRATA_PAGE_SIZE, DEFAULT_PAGE_SIZE)))),
        archiveMaxBytes: finiteCap(overrides.archiveMaxBytes,
            finiteCap(process.env.MAP_PMTILES_MAX_GB, 2) * GB),
        buildTimeoutMs: finiteCap(overrides.buildTimeoutMs,
            finiteCap(process.env.MAP_PMTILES_TIMEOUT_MS, 30 * 60_000)),
        tippecanoePath: overrides.tippecanoePath || process.env.TIPPECANOE_PATH || 'tippecanoe',
        fetchJson: overrides.fetchJson || fetchPublicJson,
        storage: overrides.storage || null
    };
}

function scalar(value) {
    if (value == null || typeof value === 'object') return null;
    if (typeof value === 'string') return value.slice(0, 500);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    return String(value).slice(0, 500);
}

function selectFields(view, geometryNames) {
    const geometry = new Set(geometryNames);
    const columns = (Array.isArray(view && view.columns) ? view.columns : [])
        .filter(column => column && typeof column.fieldName === 'string' &&
            column.fieldName.length > 0 && column.fieldName.length <= 200 &&
            !geometry.has(column.fieldName))
        .map((column, index) => ({
            name: column.fieldName,
            alias: String(column.name || column.fieldName).slice(0, 200),
            type: String(column.dataTypeName || 'text').slice(0, 60),
            priority: FIELD_PRIORITY.test(column.fieldName) || FIELD_PRIORITY.test(column.name || '') ? 0 : 1,
            index
        }));
    columns.sort((a, b) => a.priority - b.priority || a.index - b.index);
    return columns.slice(0, MAX_FIELDS).map(({ name, alias, type }) => ({ name, alias, type }));
}

function inspectCoordinates(value, bounds) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        const lon = Number(value[0]);
        const lat = Number(value[1]);
        bounds[0] = Math.min(bounds[0], lon);
        bounds[1] = Math.min(bounds[1], lat);
        bounds[2] = Math.max(bounds[2], lon);
        bounds[3] = Math.max(bounds[3], lat);
        return;
    }
    for (const child of value) inspectCoordinates(child, bounds);
}

function validateSocrataCandidate(resource, candidate) {
    const raw = resource && resource.raw && typeof resource.raw === 'object' ? resource.raw : {};
    const candidateRaw = candidate && candidate.raw && typeof candidate.raw === 'object' ? candidate.raw : {};
    const source = getSource(raw.source_id);
    const datasetId = raw.upstream_dataset_id;
    if (!source || source.kind !== 'socrata' || raw.provider !== 'socrata' || !datasetId ||
        candidate.mode !== 'socrata-geojson-pmtiles' || candidateRaw.provider !== 'socrata' ||
        candidateRaw.source_id !== source.id || candidateRaw.upstream_dataset_id !== datasetId) {
        throw new MapSkipError('PMTiles candidate does not belong to a configured Socrata source', 'MAP_SOURCE');
    }
    const expectedCsv = csvUrl(source, datasetId);
    const expectedGeoJson = geoJsonBaseUrl(source, datasetId);
    if (resource.url !== expectedCsv || candidate.sourceUrl !== expectedGeoJson) {
        throw new MapSkipError('Socrata map candidate differs from its catalogued exports', 'MAP_SOURCE');
    }
    return { source, datasetId, expectedGeoJson };
}

async function writeLine(stream, value) {
    if (!stream.write(value)) await once(stream, 'drain');
}

async function downloadSocrataFeatures({ candidate, inputPath, caps, view, source, datasetId }) {
    const expectedRows = Number(candidate.expectedRows);
    const geometryNames = new Set((candidate.raw && candidate.raw.geometry_fields || [])
        .map(field => field && field.name).filter(Boolean));
    const fields = selectFields(view, geometryNames);
    const fieldNames = new Set(fields.map(field => field.name));
    const output = fs.createWriteStream(inputPath, { flags: 'wx', mode: 0o600 });
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const geometryTypes = new Set();
    let rows = 0;
    let features = 0;
    let vertices = 0;
    let sourceBytes = 0;
    let writtenBytes = 0;
    try {
        for (let offset = 0; offset < expectedRows; offset += caps.pageSize) {
            const limit = Math.min(caps.pageSize, expectedRows - offset);
            const url = geoJsonPageUrl(source, datasetId, { limit, offset });
            const payload = await caps.fetchJson(url, {
                timeoutMs: 60_000,
                maxBytes: Math.min(caps.maxFileBytes, 128 * 1024 * 1024),
                maxRetries: 2,
                userAgent: caps.userAgent
            });
            if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
                throw new MapSkipError('Socrata returned an invalid GeoJSON page', 'MAP_GEOMETRY');
            }
            sourceBytes += Buffer.byteLength(JSON.stringify(payload));
            if (sourceBytes > caps.maxFileBytes) {
                throw new MapSkipError('GeoJSON download exceeds map cap ' + caps.maxFileBytes, 'CAP_FILE');
            }
            if (payload.features.length !== limit) {
                throw new MapSkipError(
                    'Socrata row count changed while the map archive was being built',
                    'MAP_SOURCE_CHANGED'
                );
            }
            for (const upstream of payload.features) {
                rows += 1;
                if (rows > caps.maxRows) {
                    throw new MapSkipError('row count exceeds map cap ' + caps.maxRows, 'MAP_ROWS');
                }
                const geometry = upstream && upstream.type === 'Feature' ? upstream.geometry : null;
                const featureVertices = geometryVertexCount(geometry);
                if (!geometry || !featureVertices) continue;
                if (featureVertices > caps.maxFeatureVertices) {
                    throw new MapSkipError('feature vertex count exceeds map cap ' + caps.maxFeatureVertices, 'MAP_VERTICES');
                }
                vertices += featureVertices;
                if (vertices > caps.maxVertices) {
                    throw new MapSkipError('vertex count exceeds map cap ' + caps.maxVertices, 'MAP_VERTICES');
                }
                inspectCoordinates(geometry.coordinates, bounds);
                geometryTypes.add(normalizedGeometryType(geometry.type));
                const properties = {};
                for (const [key, value] of Object.entries(upstream.properties || {})) {
                    if (!fieldNames.has(key)) continue;
                    const clean = scalar(value);
                    if (clean != null) properties[key] = clean;
                }
                const feature = {
                    type: 'Feature',
                    id: rows,
                    geometry,
                    properties
                };
                const line = JSON.stringify(feature) + '\n';
                writtenBytes += Buffer.byteLength(line);
                await writeLine(output, line);
                features += 1;
            }
        }
        if (rows !== expectedRows) {
            throw new MapSkipError(
                'Socrata row count changed while the map archive was being built',
                'MAP_SOURCE_CHANGED'
            );
        }
        if (!features || !validWgs84Extent(bounds)) {
            throw new MapSkipError('Socrata source contains no valid WGS84 geometry', 'MAP_GEOMETRY');
        }
        output.end();
        await once(output, 'close');
        return {
            rowCount: rows,
            featureCount: features,
            vertexCount: vertices,
            downloadedBytes: sourceBytes,
            writtenBytes,
            extent: bounds,
            geometryType: geometryTypes.size === 1 ? Array.from(geometryTypes)[0] : 'mixed',
            fields
        };
    } catch (error) {
        output.destroy();
        await once(output, 'close').catch(() => {});
        throw error;
    }
}

async function runTippecanoe(inputPath, outputPath, caps, options = {}) {
    const args = [
        '--output=' + outputPath,
        '--minimum-zoom=' + MIN_ZOOM,
        '--maximum-zoom=' + MAX_ZOOM,
        '--layer=' + TILE_LAYER,
        '--drop-densest-as-needed',
        '--maximum-tile-bytes=' + MAX_TILE_BYTES,
        '--force',
        inputPath
    ];
    const child = (options.spawnImpl || spawn)(caps.tippecanoePath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, TMPDIR: path.dirname(outputPath) }
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384); });
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, caps.buildTimeoutMs);
    timer.unref();
    let exit;
    try {
        exit = await once(child, 'exit');
    } finally {
        clearTimeout(timer);
    }
    if (timedOut) throw new Error('Tippecanoe exceeded the map build timeout');
    if (exit[0] !== 0) {
        const error = new MapSkipError('Tippecanoe rejected the source: ' + stderr.trim(), 'MAP_TILES');
        error.exitCode = exit[0];
        throw error;
    }
}

class NodeFileSource {
    constructor(filePath) { this.filePath = filePath; }
    getKey() { return this.filePath; }
    async getBytes(offset, length) {
        const handle = await fs.promises.open(this.filePath, 'r');
        try {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) };
        } finally {
            await handle.close();
        }
    }
}

async function inspectArchive(filePath) {
    const archive = new PMTiles(new NodeFileSource(filePath), new SharedPromiseCache());
    const header = await archive.getHeader();
    if (header.specVersion !== 3 || header.tileType !== TileType.Mvt ||
        header.minZoom < 0 || header.maxZoom > 22 || header.minZoom > header.maxZoom) {
        throw new MapSkipError('Tippecanoe produced an unsupported PMTiles archive', 'MAP_TILES');
    }
    const extent = [header.minLon, header.minLat, header.maxLon, header.maxLat];
    if (!validWgs84Extent(extent)) {
        throw new MapSkipError('PMTiles archive extent is outside WGS84 bounds', 'MAP_TILES');
    }
    return { header, extent };
}

async function currentPmtilesBytes(db, excludeResourceId) {
    const result = await db.query(`
        SELECT coalesce(sum(byte_size), 0)::bigint AS bytes
        FROM resource_maps WHERE provider = 'pmtiles' AND resource_id <> $1
    `, [excludeResourceId]);
    return Number(result.rows[0].bytes) || 0;
}

async function commitPmtilesMap({ db, resource, job, workerId, result, archive, object, sourceUrl }) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query(`
            SELECT desired_version FROM map_index_jobs
            WHERE resource_id = $1 AND status = 'running' AND worker_id = $2
            FOR UPDATE
        `, [resource.id, workerId]);
        if (locked.rowCount !== 1) throw new Error('map worker lease lost before PMTiles commit');
        await client.query('DELETE FROM map_store.features WHERE resource_id = $1', [resource.id]);
        await client.query(`
            INSERT INTO resource_maps (
                resource_id, provider, service_url, geometry_type, extent,
                object_id_field, display_field, fields, max_record_count,
                feature_count, byte_size, indexed_at, source_version,
                storage_key, storage_etag, storage_sha256,
                tile_min_zoom, tile_max_zoom, tile_layer, updated_at
            ) VALUES (
                $1,'pmtiles',$2,$3,$4,NULL,$5,$6,1000,
                $7,$8,now(),$9,$10,$11,$12,$13,$14,$15,now()
            ) ON CONFLICT (resource_id) DO UPDATE SET
                provider = EXCLUDED.provider, service_url = EXCLUDED.service_url,
                geometry_type = EXCLUDED.geometry_type, extent = EXCLUDED.extent,
                object_id_field = NULL, display_field = EXCLUDED.display_field,
                fields = EXCLUDED.fields, max_record_count = EXCLUDED.max_record_count,
                feature_count = EXCLUDED.feature_count, byte_size = EXCLUDED.byte_size,
                indexed_at = EXCLUDED.indexed_at, source_version = EXCLUDED.source_version,
                storage_key = EXCLUDED.storage_key, storage_etag = EXCLUDED.storage_etag,
                storage_sha256 = EXCLUDED.storage_sha256,
                tile_min_zoom = EXCLUDED.tile_min_zoom, tile_max_zoom = EXCLUDED.tile_max_zoom,
                tile_layer = EXCLUDED.tile_layer, updated_at = now()
        `, [
            resource.id, sourceUrl, result.geometryType, JSON.stringify(archive.extent),
            result.fields[0] ? result.fields[0].name : null, JSON.stringify(result.fields),
            result.featureCount, object.byteSize, job.claimed_version,
            object.key, object.etag, object.sha256,
            archive.header.minZoom, archive.header.maxZoom, TILE_LAYER
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
        `, [resource.id, workerId, job.claimed_version, result.featureCount,
            result.vertexCount, result.downloadedBytes]);
        if (queue.rowCount !== 1) throw new Error('map worker lease lost before PMTiles commit');
        await client.query('COMMIT');
        return queue.rows[0].status;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

async function buildPmtilesResource(resource, job, workerId, capsRaw = {}, options = {}) {
    const caps = pmtilesCaps(capsRaw);
    const candidate = { ...(job.candidate || {}) };
    validateCandidate(candidate, caps);
    const { source, datasetId, expectedGeoJson } = validateSocrataCandidate(resource, candidate);
    const expectedRows = Number(candidate.expectedRows);
    if (!Number.isSafeInteger(expectedRows) || expectedRows < 0) {
        throw new MapSkipError('Socrata PMTiles candidate has no stable row count', 'MAP_ROWS');
    }
    const storage = options.storageConfig || caps.storage || storageConfig();
    await assertDiskHeadroom(os.tmpdir(), caps.minFreeBytes + caps.maxFileBytes + caps.archiveMaxBytes,
        'PMTiles temporary filesystem');
    const retained = await currentPmtilesBytes(options.metadataPool || metadataPool, resource.id);
    if (retained >= storage.budgetBytes) {
        throw new MapSkipError('PMTiles storage budget has been reached', 'MAP_BUDGET');
    }
    const firstView = await caps.fetchJson(viewUrl(source, datasetId), {
        timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024, maxRetries: 2,
        userAgent: caps.userAgent
    });
    const startVersion = directMapVersion(firstView, source, expectedRows);
    if (startVersion !== job.claimed_version) {
        throw new MapSkipError(
            'Socrata source changed before PMTiles indexing began',
            'MAP_SOURCE_CHANGED'
        );
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'canquery-pmtiles-'));
    const inputPath = path.join(tempDir, 'features.geojsonseq');
    const outputPath = path.join(tempDir, 'map.pmtiles');
    try {
        const result = await downloadSocrataFeatures({
            candidate, inputPath, caps, view: firstView, source, datasetId
        });
        await runTippecanoe(inputPath, outputPath, caps, options);
        const stat = await fs.promises.stat(outputPath);
        if (!stat.size || stat.size > caps.archiveMaxBytes) {
            throw new MapSkipError('PMTiles archive exceeds its size cap', 'MAP_TILES');
        }
        if (retained + stat.size > storage.budgetBytes) {
            throw new MapSkipError('PMTiles storage budget would be exceeded', 'MAP_BUDGET');
        }
        const archive = await inspectArchive(outputPath);
        const finalView = await caps.fetchJson(viewUrl(source, datasetId), {
            timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024, maxRetries: 2,
            userAgent: caps.userAgent
        });
        if (directMapVersion(finalView, source, expectedRows) !== startVersion) {
            throw new MapSkipError(
                'Socrata source changed while the PMTiles archive was being built',
                'MAP_SOURCE_CHANGED'
            );
        }
        const key = objectKeyFor(resource.id, job.claimed_version);
        const sha256 = await sha256File(outputPath);
        const existing = await headObject(key, { config: storage, client: options.storageClient });
        let object;
        if (existing) {
            if (existing.byteSize !== stat.size || existing.sha256 !== sha256 || !existing.etag) {
                throw new Error('immutable PMTiles key already contains different data');
            }
            object = { ...existing, sha256 };
        } else {
            object = await uploadArchive(outputPath, key, {
                sha256, resourceId: resource.id, version: job.claimed_version
            }, { config: storage, client: options.storageClient, UploadClass: options.UploadClass });
        }
        const queueStatus = await commitPmtilesMap({
            db: options.metadataPool || metadataPool,
            resource,
            job,
            workerId,
            result,
            archive,
            object,
            sourceUrl: expectedGeoJson
        });
        return {
            ...result,
            byteSize: object.byteSize,
            storageKey: key,
            queueStatus,
            indexedAt: new Date()
        };
    } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
}

module.exports = {
    TILE_LAYER,
    MIN_ZOOM,
    MAX_ZOOM,
    MAX_TILE_BYTES,
    MAX_FIELDS,
    pmtilesCaps,
    scalar,
    selectFields,
    validateSocrataCandidate,
    downloadSocrataFeatures,
    runTippecanoe,
    NodeFileSource,
    inspectArchive,
    currentPmtilesBytes,
    commitPmtilesMap,
    buildPmtilesResource
};
