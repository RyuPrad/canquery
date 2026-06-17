const { TABLE_NAME_RE } = require('../db/storeQueries');
const { quoteIdent } = require('../utils/filterGrammar');

async function evictUntilUnderBudget(db, { budgetBytes, dryRun = false } = {}) {
    const { rows } = await db.query('SELECT ir.resource_id, ir.table_name, coalesce(ir.byte_size, 0)::bigint AS byte_size, ir.last_accessed_at, EXISTS (SELECT 1 FROM pinned_resources p WHERE p.resource_id = ir.resource_id) AS pinned FROM ingested_resources ir ORDER BY ir.last_accessed_at ASC');
    let totalBytes = rows.reduce((sum, r) => sum + Number(r.byte_size), 0);
    let dropped = 0;
    let freedBytes = 0;
    for (const row of rows) {
        if (totalBytes <= budgetBytes) break;
        // Pinned tables (the curated Top 100 + analytics source) still count toward
        // total usage but are never dropped - skip without decrementing the total.
        if (row.pinned) continue;
        if (!TABLE_NAME_RE.test(row.table_name)) {
            console.warn('skipping suspicious table name: ' + row.table_name);
            continue;
        }
        console.log((dryRun ? '[dry-run] would drop ' : 'dropping ') + row.table_name + ' (' + row.byte_size + ' bytes)');
        if (!dryRun) {
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                await client.query('DROP TABLE IF EXISTS store.' + quoteIdent(row.table_name));
                await client.query('DELETE FROM ingested_resources WHERE resource_id = $1', [row.resource_id]);
                await client.query('COMMIT');
            } catch (err) {
                try { await client.query('ROLLBACK'); } catch {}
                throw err;
            } finally {
                client.release();
            }
        }
        totalBytes -= Number(row.byte_size);
        freedBytes += Number(row.byte_size);
        dropped += 1;
    }
    return { dropped, freedBytes, totalBytesAfter: totalBytes };
}

module.exports = { evictUntilUnderBudget };
