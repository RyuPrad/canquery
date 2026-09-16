const { snapshotKey } = require('../db/snapshotRead');
const { TABLE_NAME_RE } = require('../db/storeQueries');
const { quoteIdent } = require('../utils/filterGrammar');

// Caller owns the store-budget lock. Try-locks keep cleanup from waiting on
// visitors or long exports. Rows and bytes stay accounted until DROP commits.
async function cleanRetiredTables(db) {
    const { rows } = await db.query('SELECT * FROM retired_ingest_tables ORDER BY retired_at LIMIT 50');
    for (const row of rows) {
        if (!TABLE_NAME_RE.test(row.table_name)) continue;
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [snapshotKey(row.resource_id)]);
            if (!lock.rows[0].locked) { await client.query('ROLLBACK'); continue; }
            const active = await client.query('SELECT 1 FROM ingested_resources WHERE table_name = $1', [row.table_name]);
            if (active.rows.length) { await client.query('ROLLBACK'); continue; }
            await client.query("SET LOCAL lock_timeout = '1000ms'");
            await client.query('DROP TABLE IF EXISTS store.' + quoteIdent(row.table_name));
            await client.query('DELETE FROM retired_ingest_tables WHERE table_name = $1', [row.table_name]);
            await client.query('COMMIT');
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch {}
            if (error.code !== '55P03') throw error;
        } finally { client.release(); }
    }
}

module.exports = { cleanRetiredTables };
