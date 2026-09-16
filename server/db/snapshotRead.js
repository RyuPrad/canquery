const { AsyncLocalStorage } = require('node:async_hooks');
const pool = require('./pool');
const context = new AsyncLocalStorage();
const snapshotKey = id => 'canquery-snapshot:' + id;
const snapshotDb = () => context.getStore()?.client || pool;

// A reader pins all versions of this resource until the request/stream ends.
// Publication does not need this lock; retirement and eviction take its
// exclusive counterpart without waiting, so neither interrupts a reader.
async function withSnapshot(resourceId, callback, db = pool) {
    if (context.getStore()?.resourceId === resourceId) return callback();
    const client = await db.connect();
    let locked = false;
    let broken = false;
    try {
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
    } finally {
        if (locked) {
            try { await client.query('SELECT pg_advisory_unlock_shared(hashtext($1))', [snapshotKey(resourceId)]); }
            catch { broken = true; }
        }
        client.release(broken);
    }
}

module.exports = { withSnapshot, snapshotDb, snapshotKey };
