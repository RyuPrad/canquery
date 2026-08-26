const crypto = require('node:crypto');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Writable } = require('node:stream');
const {
    S3Client,
    HeadObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const MAX_RANGE_BYTES = 16 * 1024 * 1024;
let sharedClient = null;
let sharedKey = null;

function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function storageConfig(overrides = {}) {
    const config = {
        endpoint: overrides.endpoint || process.env.MAP_R2_ENDPOINT,
        bucket: overrides.bucket || process.env.MAP_R2_BUCKET,
        accessKeyId: overrides.accessKeyId || process.env.MAP_R2_ACCESS_KEY_ID,
        secretAccessKey: overrides.secretAccessKey || process.env.MAP_R2_SECRET_ACCESS_KEY,
        region: overrides.region || process.env.MAP_R2_REGION || 'auto',
        budgetBytes: positiveNumber(overrides.budgetBytes,
            positiveNumber(process.env.MAP_R2_BUDGET_GB, 100) * 1024 * 1024 * 1024)
    };
    if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
        throw new Error('PMTiles object storage is not configured');
    }
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
        throw new Error('PMTiles object storage endpoint must use HTTPS');
    }
    config.endpoint = endpoint.href.replace(/\/$/, '');
    if (!/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(config.bucket)) {
        throw new Error('PMTiles object storage bucket is invalid');
    }
    return config;
}

function clientFor(config = storageConfig(), options = {}) {
    if (options.client) return options.client;
    const key = JSON.stringify([
        config.endpoint, config.region, config.accessKeyId,
        crypto.createHash('sha256').update(config.secretAccessKey).digest('hex')
    ]);
    if (sharedClient && sharedKey === key) return sharedClient;
    if (sharedClient) sharedClient.destroy();
    sharedClient = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        },
        maxAttempts: 3
    });
    sharedKey = key;
    return sharedClient;
}

function objectKeyFor(resourceId, version) {
    const resourceHash = crypto.createHash('sha256').update(String(resourceId)).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(String(version || ''))) {
        throw new Error('PMTiles source version is invalid');
    }
    return 'maps/' + resourceHash + '/' + version + '.pmtiles';
}

function cleanEtag(value) {
    return String(value || '').replace(/^"|"$/g, '');
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(filePath), new Writable({
        write(chunk, encoding, callback) {
            hash.update(chunk);
            callback();
        }
    }));
    return hash.digest('hex');
}

async function headObject(key, options = {}) {
    const config = options.config || storageConfig(options);
    const client = clientFor(config, options);
    try {
        const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }), {
            abortSignal: options.signal
        });
        return {
            key,
            byteSize: Number(result.ContentLength) || 0,
            etag: cleanEtag(result.ETag),
            sha256: result.Metadata && result.Metadata.sha256 || null,
            lastModified: result.LastModified || null
        };
    } catch (error) {
        const status = Number(error && error.$metadata && error.$metadata.httpStatusCode);
        if (status === 404 || error && ['NotFound', 'NoSuchKey'].includes(error.name)) return null;
        throw error;
    }
}

async function uploadArchive(filePath, key, metadata = {}, options = {}) {
    const config = options.config || storageConfig(options);
    const client = clientFor(config, options);
    const stat = await fs.promises.stat(filePath);
    const sha256 = metadata.sha256 || await sha256File(filePath);
    const upload = new (options.UploadClass || Upload)({
        client,
        params: {
            Bucket: config.bucket,
            Key: key,
            Body: fs.createReadStream(filePath),
            ContentType: 'application/vnd.pmtiles',
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: {
                sha256,
                resource: String(metadata.resourceId || '').slice(0, 256),
                version: String(metadata.version || '').slice(0, 64)
            }
        },
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false
    });
    if (options.signal) options.signal.addEventListener('abort', () => upload.abort(), { once: true });
    await upload.done();
    const head = await headObject(key, { ...options, config, client });
    if (!head || head.byteSize !== stat.size || head.sha256 !== sha256 || !head.etag) {
        throw new Error('uploaded PMTiles archive failed integrity verification');
    }
    return { ...head, sha256 };
}

async function getObjectRange(key, offset, length, options = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > MAX_RANGE_BYTES) {
        throw new Error('PMTiles byte range is invalid');
    }
    const config = options.config || storageConfig(options);
    const client = clientFor(config, options);
    const result = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Range: 'bytes=' + offset + '-' + (offset + length - 1),
        IfMatch: options.etag ? '"' + cleanEtag(options.etag) + '"' : undefined
    }), { abortSignal: options.signal });
    const bytes = await result.Body.transformToByteArray();
    if (bytes.byteLength > length || (!result.ContentRange && bytes.byteLength !== length)) {
        throw new Error('PMTiles object storage ignored the requested byte range');
    }
    return {
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        etag: cleanEtag(result.ETag) || undefined,
        cacheControl: result.CacheControl || undefined,
        expires: result.Expires || undefined
    };
}

async function deleteObject(key, options = {}) {
    const config = options.config || storageConfig(options);
    const client = clientFor(config, options);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function listObjects(prefix = 'maps/', options = {}) {
    const config = options.config || storageConfig(options);
    const client = clientFor(config, options);
    const rows = [];
    let continuationToken;
    do {
        const result = await client.send(new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken
        }));
        for (const item of result.Contents || []) {
            rows.push({
                key: item.Key,
                byteSize: Number(item.Size) || 0,
                etag: cleanEtag(item.ETag),
                lastModified: item.LastModified || null
            });
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
    } while (continuationToken);
    return rows;
}

class R2PmtilesSource {
    constructor(key, etag, options = {}) {
        this.key = key;
        this.etag = cleanEtag(etag);
        this.options = options;
    }

    getKey() {
        return this.key + '|' + this.etag;
    }

    async getBytes(offset, length, signal, etag) {
        return getObjectRange(this.key, offset, length, {
            ...this.options,
            signal,
            etag: etag || this.etag
        });
    }
}

function closeStorageClient() {
    if (sharedClient) sharedClient.destroy();
    sharedClient = null;
    sharedKey = null;
}

module.exports = {
    MAX_RANGE_BYTES,
    storageConfig,
    clientFor,
    objectKeyFor,
    cleanEtag,
    sha256File,
    headObject,
    uploadArchive,
    getObjectRange,
    deleteObject,
    listObjects,
    R2PmtilesSource,
    closeStorageClient
};
