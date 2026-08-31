// Two signed int32 keys spelling "canq" / "sync". A session-level advisory
// lock held on a dedicated client prevents the federal full and incremental
// catalogue syncs from running at the same time.
const CATALOG_SYNC_LOCK_KEYS = [1667329649, 1937337955];

/**
 * Acquire the process-wide federal catalogue sync lock.
 *
 * The returned client must remain checked out for the whole sync run. A busy
 * lock returns null and releases the client immediately so the caller can
 * treat contention as an expected, successful skip.
 */
async function acquireCatalogSyncLock(pool) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT pg_try_advisory_lock($1, $2) AS acquired',
            CATALOG_SYNC_LOCK_KEYS
        );
        if (result.rows[0]?.acquired !== true) {
            client.release();
            return null;
        }
        return client;
    } catch (error) {
        client.release();
        throw error;
    }
}

/**
 * Release a previously acquired catalogue sync lock and return its client.
 * The client is released even if PostgreSQL reports an error while unlocking.
 */
async function releaseCatalogSyncLock(client) {
    if (!client) return false;
    try {
        const result = await client.query(
            'SELECT pg_advisory_unlock($1, $2) AS released',
            CATALOG_SYNC_LOCK_KEYS
        );
        return result.rows[0]?.released === true;
    } finally {
        client.release();
    }
}

module.exports = {
    CATALOG_SYNC_LOCK_KEYS,
    acquireCatalogSyncLock,
    releaseCatalogSyncLock
};
