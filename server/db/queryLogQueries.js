const pool = require('./pool');

async function logQueryHit(resourceId, mode) {
    await pool.query('INSERT INTO query_log (resource_id, query_mode) VALUES ($1, $2)', [resourceId, mode]);
}

async function listPopularResources({ days, limit }) {
    const result = await pool.query(
        `SELECT t.resource_id, t.hits, t.last_queried_at, r.name_en, r.name_fr, r.format, r.dataset_id, d.name AS dataset_name, d.title_en AS dataset_title_en, d.title_fr AS dataset_title_fr 
        FROM (
            SELECT resource_id, count(*)::int AS hits, max(created_at) AS last_queried_at 
            FROM query_log 
            WHERE created_at >= now() - make_interval(days => $1) 
            GROUP BY resource_id 
            ORDER BY hits DESC, last_queried_at DESC 
            LIMIT $2
        ) t 
        JOIN resources r ON r.id = t.resource_id 
        JOIN datasets d ON d.id = r.dataset_id 
        ORDER BY t.hits DESC, t.last_queried_at DESC`,
        [days, limit]
    );
    return result.rows;
}

async function countOlderThan(days) {
    const result = await pool.query(
        'SELECT count(*)::int AS n FROM query_log WHERE created_at < now() - make_interval(days => $1)',
        [days]
    );
    return Number(result.rows[0].n);
}

async function pruneOlderThan(days) {
    const result = await pool.query(
        'DELETE FROM query_log WHERE created_at < now() - make_interval(days => $1)',
        [days]
    );
    return result.rowCount;
}

module.exports = { logQueryHit, listPopularResources, countOlderThan, pruneOlderThan };
