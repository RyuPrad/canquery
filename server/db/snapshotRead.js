const { AsyncLocalStorage } = require('node:async_hooks');
const pool = require('./pool');
const context = new AsyncLocalStorage();
const snapshotKey = id => 'canquery-snapshot:' + id;
const snapshotDb = () => context.getStore()?.client || pool;

// A reader pins all versions of this resource until the request/stream ends.
// Publication does not need this lock; retirement and eviction take its
// exclusive counterpart without waiting, so neither interrupts a reader.
async function withSnapshot(resourceId, callback, db = pool, { signal } = {}) {
    signal?.throwIfAborted();
    if (context.getStore()?.resourceId === resourceId) return callback();
    const client = await db.connect();
    let released = false;
    const abort = () => {
        if (!released) { released = true; client.release(true); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let locked = false;
    let broken = false;
    try {
        signal?.throwIfAborted();
        try {
            await client.query('SELECT pg_advisory_lock_shared(hashtext($1))', [snapshotKey(resourceId)]);
        } catch (error) {
            // A client-side timeout can race the server acquiring its session
            // lock. Discard this connection instead of returning a possible
            // lock owner to the pool.
            broken = true;
            throw error;
        }
        locked = true;
        return await context.run({ client, resourceId }, callback);
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        if (locked && !released) {
            try { await client.query('SELECT pg_advisory_unlock_shared(hashtext($1))', [snapshotKey(resourceId)]); }
            catch { broken = true; }
        }
        if (!released) client.release(broken);
    }
}

module.exports = { withSnapshot, snapshotDb, snapshotKey };
