const pool = require('./pool');

async function logQueryHit(resourceId, mode) {
    await pool.query('INSERT INTO query_log (resource_id, query_mode) VALUES ($1, $2)', [resourceId, mode]);
}

async function listPopularResources({ days, limit, place = null }) {
    const result = await pool.query(
        `WITH RECURSIVE selected_place AS (
            SELECT p.id, p.parent_id, 0 AS depth FROM places p
            WHERE $3::text IS NOT NULL AND (p.id = $3 OR p.slug = $3)
            UNION ALL
            SELECT p.id, p.parent_id, selected_place.depth + 1
            FROM places p JOIN selected_place ON selected_place.parent_id = p.id
        )
        SELECT ql.resource_id, count(*)::int AS hits, max(ql.created_at) AS last_queried_at,
               r.name_en, r.name_fr, r.format, r.dataset_id, d.name AS dataset_name,
               d.title_en AS dataset_title_en, d.title_fr AS dataset_title_fr
        FROM query_log ql
        JOIN resources r ON r.id = ql.resource_id
        JOIN datasets d ON d.id = r.dataset_id
        WHERE ql.created_at >= now() - make_interval(days => $1)
          AND ($3::text IS NULL OR EXISTS (
            SELECT 1 FROM dataset_places dp JOIN selected_place sp ON sp.id = dp.place_id
            WHERE dp.dataset_id = d.id AND (sp.depth = 0 OR dp.includes_descendants)
        ))
        GROUP BY ql.resource_id, r.name_en, r.name_fr, r.format, r.dataset_id,
                 d.name, d.title_en, d.title_fr
        ORDER BY hits DESC, last_queried_at DESC
        LIMIT $2`,
        [days, limit, place]
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
