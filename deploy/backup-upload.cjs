#!/usr/bin/env node
'use strict';

// Invoked by the root-owned backup runner after pg_restore manifest validation.
// Only a public age recipient and bucket-scoped object credentials are needed.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand,
    ListObjectsV2Command, DeleteObjectCommand } = require('../server/node_modules/@aws-sdk/client-s3');
const { Upload } = require('../server/node_modules/@aws-sdk/lib-storage');

const DAY = 86400000;
const STAMP = /^\d{8}T\d{6}Z$/;
function configuration(env = process.env) {
    const endpoint = new URL(env.CANQUERY_BACKUP_R2_ENDPOINT || '');
    const bucket = env.CANQUERY_BACKUP_R2_BUCKET;
    const recipient = env.CANQUERY_BACKUP_AGE_RECIPIENT;
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '') ||
        !/^age1[0-9a-z]{58}$/.test(recipient || '') ||
        !env.CANQUERY_BACKUP_R2_ACCESS_KEY_ID || !env.CANQUERY_BACKUP_R2_SECRET_ACCESS_KEY) {
        throw new Error('Invalid backup endpoint, bucket, recipient or credentials');
    }
    return { endpoint: endpoint.href, bucket, recipient, region: 'auto',
        credentials: { accessKeyId: env.CANQUERY_BACKUP_R2_ACCESS_KEY_ID,
            secretAccessKey: env.CANQUERY_BACKUP_R2_SECRET_ACCESS_KEY } };
}
async function fileHash(filename) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex');
}
async function verifyObject(client, bucket, key, expectedHash, expectedBytes) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.Body) { hash.update(chunk); bytes += chunk.length; }
    const sha256 = hash.digest('hex');
    if ((expectedHash && sha256 !== expectedHash) || (expectedBytes !== undefined && bytes !== expectedBytes)) {
        throw new Error('Remote backup checksum or size mismatch');
    }
    return { ciphertext_sha256: sha256, bytes };
}
async function uploadFile(client, config, filename, key) {
    const before = await fsp.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size === 0) throw new Error('Invalid backup input');
    const plaintext_sha256 = await fileHash(filename);
    let existing;
    try { existing = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key })); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NotFound') throw error; }
    if (existing) {
        if (existing.Metadata?.plaintext_sha256 !== plaintext_sha256) throw new Error('Refusing backup object collision');
        return { key, plaintext_sha256, ...(await verifyObject(client, config.bucket, key, undefined, existing.ContentLength)) };
    }
    const child = spawn('age', ['--encrypt', '--recipient', config.recipient], { stdio: ['pipe', 'pipe', 'ignore'] });
    const ended = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error('Backup encryption failed')));
    });
    // Attach a rejection handler immediately; the upload may fail before age exits.
    ended.catch(() => {});
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const digest = new Transform({ transform(chunk, _encoding, done) {
        hash.update(chunk); bytes += chunk.length; done(null, chunk);
    } });
    const uploader = new Upload({ client, queueSize: 1, partSize: 8 * 1024 * 1024,
        leavePartsOnError: false, params: { Bucket: config.bucket, Key: key,
            Body: digest, ContentType: 'application/octet-stream',
            Metadata: { plaintext_sha256 } } });
    const input = pipeline(fs.createReadStream(filename), child.stdin);
    const output = pipeline(child.stdout, digest);
    try {
        await Promise.all([input, output, uploader.done(), ended]);
    } catch (error) {
        child.kill('SIGTERM');
        digest.destroy();
        await uploader.abort().catch(() => {});
        await Promise.allSettled([input, output, ended]);
        throw error;
    }
    const after = await fsp.lstat(filename);
    if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new Error('Backup input changed during upload');
    }
    const ciphertext_sha256 = hash.digest('hex');
    await verifyObject(client, config.bucket, key, ciphertext_sha256, bytes);
    return { key, plaintext_sha256, ciphertext_sha256, bytes };
}
function validateManifest(manifest) {
    if (manifest.version !== 1 || !STAMP.test(manifest.stamp || '') ||
        !/^[0-9a-f]{40}$/.test(manifest.release || '') || !Array.isArray(manifest.files) || manifest.files.length < 3) {
        throw new Error('Invalid backup manifest');
    }
    const names = new Set();
    for (const file of manifest.files) {
        if (!['database', 'configuration'].includes(file.kind) || !path.isAbsolute(file.path) ||
            !/^[A-Za-z0-9_.-]+$/.test(file.name) || names.has(file.name)) throw new Error('Invalid backup file entry');
        names.add(file.name);
    }
    if (manifest.files.filter(file => file.kind === 'database').length !== 2 ||
        manifest.files.filter(file => file.kind === 'configuration').length !== 1) {
        throw new Error('Backup requires two databases and recovery configuration');
    }
    return manifest;
}
async function uploadSet(manifest, config, { client = new S3Client(config) } = {}) {
    validateManifest(manifest);
    const prefix = `daily/${manifest.stamp}/`;
    const files = [];
    for (const file of manifest.files) {
        files.push({ name: file.name, kind: file.kind,
            ...await uploadFile(client, config, file.path, prefix + file.name + '.age') });
    }
    const receipt = { version: 1, stamp: manifest.stamp, release: manifest.release,
        verified_at: new Date().toISOString(), files };
    const body = Buffer.from(JSON.stringify(receipt) + '\n');
    const key = prefix + 'complete.json';
    try {
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body,
            ContentType: 'application/json', IfNoneMatch: '*' }));
    } catch (error) {
        if (error.$metadata?.httpStatusCode !== 412) throw error;
        const old = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        const previous = JSON.parse(await old.Body.transformToString());
        if (previous.release !== receipt.release || JSON.stringify(previous.files) !== JSON.stringify(files)) {
            throw new Error('Refusing completed backup receipt collision');
        }
        return previous;
    }
    await verifyObject(client, config.bucket, key, crypto.createHash('sha256').update(body).digest('hex'), body.length);
    return receipt;
}
function expiredSets(receipts, now = Date.now()) {
    const valid = receipts.filter(r => validReceipt(r, now))
        .sort((a, b) => Date.parse(b.verified_at) - Date.parse(a.verified_at));
    return valid.slice(2).filter(r => now - Date.parse(r.verified_at) > 30 * DAY);
}
function validReceipt(receipt, now = Date.now()) {
    if (receipt.version !== 1 || !STAMP.test(receipt.stamp || '') ||
        !/^[0-9a-f]{40}$/.test(receipt.release || '') ||
        !Number.isFinite(Date.parse(receipt.verified_at)) || Date.parse(receipt.verified_at) > now ||
        !Array.isArray(receipt.files) || receipt.files.length !== 3) return false;
    const names = new Set();
    for (const file of receipt.files) {
        if (!/^[A-Za-z0-9_.-]+$/.test(file.name || '') || names.has(file.name) ||
            file.key !== `daily/${receipt.stamp}/${file.name}.age` ||
            !['database', 'configuration'].includes(file.kind) ||
            !/^[0-9a-f]{64}$/.test(file.plaintext_sha256 || '') ||
            !/^[0-9a-f]{64}$/.test(file.ciphertext_sha256 || '') ||
            !Number.isSafeInteger(file.bytes) || file.bytes <= 0) return false;
        names.add(file.name);
    }
    return receipt.files.filter(file => file.kind === 'database').length === 2 &&
        receipt.files.filter(file => file.kind === 'configuration').length === 1;
}
async function prune(client, config) {
    const receipts = [];
    let token;
    do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: 'daily/', ContinuationToken: token }));
        for (const object of page.Contents || []) {
            if (!/^daily\/\d{8}T\d{6}Z\/complete\.json$/.test(object.Key)) continue;
            const item = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: object.Key }));
            const receipt = JSON.parse(await item.Body.transformToString());
            if (!validReceipt(receipt) || `daily/${receipt.stamp}/complete.json` !== object.Key) {
                throw new Error('Invalid remote backup receipt');
            }
            receipts.push(receipt);
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    // A receipt alone cannot establish recoverability. Re-read and hash both
    // newest complete sets before deleting any older recovery point. If either
    // is missing or corrupt, fail closed and leave all older objects intact.
    const protectedSets = [...receipts].sort((a, b) => Date.parse(b.verified_at) - Date.parse(a.verified_at)).slice(0, 2);
    if (protectedSets.length < 2) return;
    for (const receipt of protectedSets) {
        for (const file of receipt.files) {
            await verifyObject(client, config.bucket, file.key, file.ciphertext_sha256, file.bytes);
        }
    }
    for (const receipt of expiredSets(receipts)) {
        const prefix = `daily/${receipt.stamp}/`;
        for (const file of receipt.files) {
            if (typeof file.key !== 'string' || !file.key.startsWith(prefix) || file.key.includes('..')) throw new Error('Invalid pruning key');
        }
        for (const file of receipt.files) await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: file.key }));
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: prefix + 'complete.json' }));
    }
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2 || !['--manifest', '--archive-manifest'].includes(args[0])) {
        throw new Error('Usage: backup-upload.cjs --manifest FILE | --archive-manifest FILE');
    }
    const manifest = JSON.parse(await fsp.readFile(args[1], 'utf8'));
    const config = configuration();
    const client = new S3Client(config);
    try {
        if (args[0] === '--archive-manifest') {
            if (!STAMP.test(manifest.stamp || '') || !Array.isArray(manifest.files) || !manifest.files.length) {
                throw new Error('Invalid archive manifest');
            }
            const names = new Set();
            for (const file of manifest.files) {
                if (!path.isAbsolute(file.path) || !/^[A-Za-z0-9_.-]+$/.test(file.name || '') ||
                    names.has(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') ||
                    await fileHash(file.path) !== file.sha256) throw new Error('Archive input guard failed');
                names.add(file.name);
            }
            for (const file of manifest.files) {
                const result = await uploadFile(client, config, file.path, `archive/${manifest.stamp}/${file.name}.age`);
                console.log(JSON.stringify({ version: 1, source: file.path, verified_at: new Date().toISOString(), ...result }));
            }
            return;
        }
        const receipt = await uploadSet(manifest, config, { client });
        console.log(JSON.stringify(receipt));
        await prune(client, config);
    } finally { client.destroy(); }
}
if (require.main === module) main().catch(() => { console.error('Encrypted remote backup failed; inspect private job logs'); process.exitCode = 1; });
module.exports = { configuration, validateManifest, validReceipt, fileHash, verifyObject, uploadFile, uploadSet, expiredSets, prune };
