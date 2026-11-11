// Runs fn(client) in a transaction. A pool client passed in (an integration test's
// connection, already inside its own transaction) gets a savepoint instead, so the
// owner jobs' writes can be tested without committing anything.
async function inTransaction(db, fn, savepoint = 'canquery_job') {
    if (!/^[a-z_]{1,40}$/.test(savepoint)) throw new TypeError('inTransaction needs a plain savepoint name');
    if (typeof db.release === 'function') {
        await db.query('SAVEPOINT ' + savepoint);
        try {
            const result = await fn(db);
            await db.query('RELEASE SAVEPOINT ' + savepoint);
            return result;
        } catch (error) {
            await db.query('ROLLBACK TO SAVEPOINT ' + savepoint);
            throw error;
        }
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { inTransaction };
