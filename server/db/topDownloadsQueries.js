const pool = require('./pool');

// The leaderboard for the API, joined live to ingested_resources so each row
// reflects the representative's current ingest status (a pinned table can still
// be mid-ingest, or briefly absent right after a re-ingest swap).
async function listTopDownloads() {
    const { rows } = await pool.query(`
        SELECT td.rank, td.dataset_id, td.title_en, td.title_fr, td.department, td.ministere,
               td.downloads, td.period_year, td.period_month, td.history, td.resource_id,
               ir.status AS ingest_status, ir.row_count AS ingested_row_count
        FROM top_downloads td
        LEFT JOIN ingested_resources ir ON ir.resource_id = td.resource_id
        ORDER BY td.rank ASC
    `);
    return rows;
}

// Full replace in one transaction - the table is tiny (<= 100 rows) and rebuilt
// wholesale each seed run, so swapping snapshots stays atomic for readers.
async function replaceTopDownloads(items) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM top_downloads');
        for (const it of items) {
            await client.query(
                `INSERT INTO top_downloads
                   (dataset_id, rank, title_en, title_fr, department, ministere, downloads,
                    period_year, period_month, history, resource_id, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())`,
                [it.dataset_id, it.rank, it.title_en, it.title_fr, it.department, it.ministere,
                 it.downloads, it.period_year, it.period_month, JSON.stringify(it.history || []), it.resource_id]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

async function pinResource(resourceId, reason) {
    await pool.query(
        `INSERT INTO pinned_resources (resource_id, reason) VALUES ($1, $2)
         ON CONFLICT (resource_id) DO UPDATE SET reason = EXCLUDED.reason`,
        [resourceId, reason || null]
    );
}

// Drop pins we created on a previous run that are no longer in the current set,
// so datasets that fell out of the Top 100 become evictable again.
async function prunePins(keepResourceIds, reasons = ['top100', 'top100-source']) {
    await pool.query(
        `DELETE FROM pinned_resources WHERE reason = ANY($2) AND NOT (resource_id = ANY($1))`,
        [keepResourceIds, reasons]
    );
}

// Top ingested datasets (representative status 'ready') with their store table +
// columns, for the landing-page featured hero charts. Ordered by leaderboard rank.
async function listIngestedTop(limit) {
    const { rows } = await pool.query(`
        SELECT td.dataset_id, td.rank, td.title_en, td.title_fr, td.resource_id,
               ir.table_name, ir.columns, ir.row_count
        FROM top_downloads td
        JOIN ingested_resources ir ON ir.resource_id = td.resource_id AND ir.status = 'ready'
        ORDER BY td.rank ASC
        LIMIT $1
    `, [limit]);
    return rows;
}

module.exports = { listTopDownloads, replaceTopDownloads, pinResource, prunePins, listIngestedTop };
