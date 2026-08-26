require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');
const { listObjects, deleteObject, closeStorageClient, storageConfig } = require('../services/r2MapStorage');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const GRACE_MS = Math.max(60 * 60_000, Number(process.env.MAP_R2_ORPHAN_GRACE_HOURS || 24) * 60 * 60_000);
const MAX_DELETES = Math.max(1, Math.min(10_000, Number(process.env.MAP_R2_PRUNE_MAX || 1000)));

async function referencedKeys(db) {
    const result = await db.query(`
        SELECT storage_key FROM resource_maps
        WHERE provider = 'pmtiles' AND storage_key IS NOT NULL
    `);
    return new Set(result.rows.map(row => row.storage_key));
}

async function prune(options = {}) {
    const db = options.db || pool;
    const config = options.config || storageConfig();
    const referenced = await referencedKeys(db);
    const objects = await (options.listObjects || listObjects)('maps/', { config, client: options.client });
    const cutoff = Date.now() - (options.graceMs == null ? GRACE_MS : options.graceMs);
    const orphans = objects.filter(object => !referenced.has(object.key) &&
        object.lastModified && new Date(object.lastModified).getTime() <= cutoff);
    if (!dryRun && !options.dryRun) {
        for (const object of orphans.slice(0, MAX_DELETES)) {
            await (options.deleteObject || deleteObject)(object.key, { config, client: options.client });
        }
    }
    return {
        referenced: referenced.size,
        objects: objects.length,
        bytes: objects.reduce((sum, object) => sum + object.byteSize, 0),
        orphans: orphans.length,
        deleted: dryRun || options.dryRun ? 0 : Math.min(orphans.length, MAX_DELETES)
    };
}

if (require.main === module) {
    prune()
        .then(result => console.log(JSON.stringify(result)))
        .then(() => pool.end())
        .then(() => closeStorageClient())
        .catch(async error => {
            console.error(error);
            try { await pool.end(); } catch {}
            closeStorageClient();
            process.exitCode = 1;
        });
}

module.exports = { referencedKeys, prune };
