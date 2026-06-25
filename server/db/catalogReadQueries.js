const pool = require('./pool');

async function searchDatasets({ q, org, format, keyword, limit, offset }) {
    const result = await pool.query(`
        SELECT d.id, d.name, d.title_en, d.title_fr, d.metadata_modified,
               o.name AS org_name, o.title_en AS org_title_en, o.title_fr AS org_title_fr,
               (SELECT count(*)::int FROM resources r WHERE r.dataset_id = d.id) AS resource_count,
               (SELECT count(*)::int FROM resources r
                 WHERE r.dataset_id = d.id
                   AND (r.datastore_active OR EXISTS (
                        SELECT 1 FROM ingested_resources ir
                        WHERE ir.resource_id = r.id AND ir.status = 'ready'))) AS queryable_count
        FROM datasets d
        LEFT JOIN organizations o ON o.id = d.org_id
        WHERE ($1::text IS NULL OR d.search_tsv @@ (plainto_tsquery('english', $1) || plainto_tsquery('french', $1)))
          AND ($2::text IS NULL OR o.name = $2)
          AND ($3::text IS NULL OR EXISTS (
               SELECT 1 FROM resources r2
               WHERE r2.dataset_id = d.id AND r2.format = upper($3)))
          AND ($4::text IS NULL OR $4 = ANY(d.keywords_en) OR $4 = ANY(d.keywords_fr))
        ORDER BY CASE WHEN $1::text IS NULL THEN NULL
                      ELSE ts_rank(d.search_tsv, plainto_tsquery('english', $1) || plainto_tsquery('french', $1))
                 END DESC NULLS LAST,
                 d.metadata_modified DESC NULLS LAST
        LIMIT $5 OFFSET $6
    `, [q || null, org || null, format || null, keyword || null, limit, offset]);
    return result.rows;
}

async function getDatasetByIdOrName(idOrName) {
    const result = await pool.query(`
        SELECT d.id, d.name, d.title_en, d.title_fr, d.notes_en, d.notes_fr, d.org_id,
               d.keywords_en, d.keywords_fr, d.metadata_modified,
               o.name AS org_name, o.title_en AS org_title_en, o.title_fr AS org_title_fr
        FROM datasets d
        LEFT JOIN organizations o ON o.id = d.org_id
        WHERE d.id = $1 OR d.name = $1
        LIMIT 1
    `, [idOrName]);
    return result.rows[0] || null;
}

async function listResourcesForDataset(datasetId) {
    const result = await pool.query(`
        SELECT r.id, r.dataset_id, r.name_en, r.name_fr, r.format, r.url, r.size_bytes,
               r.datastore_active, r.language, r.last_modified,
               ir.status AS ingest_status, ir.row_count AS ingested_row_count, ir.ingested_at
        FROM resources r
        LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
        WHERE r.dataset_id = $1
        ORDER BY r.id
    `, [datasetId]);
    return result.rows;
}

async function getResourceById(id) {
    const result = await pool.query(`
        SELECT r.id, r.dataset_id, r.name_en, r.name_fr, r.format, r.url, r.size_bytes,
               r.datastore_active, r.language, r.last_modified,
               d.name AS dataset_name, d.title_en AS dataset_title_en, d.title_fr AS dataset_title_fr,
               ir.status AS ingest_status, ir.table_name, ir.row_count AS ingested_row_count,
               ir.byte_size AS ingested_byte_size, ir.columns AS ingested_columns,
               ir.ingested_at, ir.last_accessed_at
        FROM resources r
        LEFT JOIN datasets d ON d.id = r.dataset_id
        LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
        WHERE r.id = $1
    `, [id]);
    return result.rows[0] || null;
}

async function listOrganizations({ limit, offset }) {
    const result = await pool.query(`
        SELECT id, name, title_en, title_fr, dataset_count
        FROM organizations
        ORDER BY dataset_count DESC, name ASC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return result.rows;
}

async function getStats() {
    const result = await pool.query(`
        SELECT (SELECT count(*)::int FROM datasets) AS datasets,
               (SELECT count(*)::int FROM resources) AS resources,
               (SELECT count(*)::int FROM resources WHERE datastore_active) AS datastore_active_resources,
               (SELECT count(*)::int FROM ingested_resources WHERE status = 'ready') AS ingested_resources,
               (SELECT coalesce(sum(byte_size), 0)::bigint FROM ingested_resources WHERE status = 'ready') AS store_bytes,
               (SELECT count(*)::int FROM organizations WHERE dataset_count > 0) AS organizations
    `);
    return result.rows[0];
}

// A dataset earns a sitemap entry only when canquery renders something the
// source does not: at least one resource that is queryable right now (live
// datastore) or already loaded into our store. The ~30k download-only datasets
// are mirrors of open.canada.ca, so submitting them would just look thin - we
// keep the sitemap tight and let the set grow as datasets get loaded.
const SITEMAP_DATASET_PREDICATE = `EXISTS (
        SELECT 1 FROM resources r
        WHERE r.dataset_id = d.id
          AND (r.datastore_active
               OR EXISTS (SELECT 1 FROM ingested_resources ir
                          WHERE ir.resource_id = r.id AND ir.status = 'ready')))`;

async function countSitemapDatasets() {
    const result = await pool.query(
        `SELECT count(*)::int AS n FROM datasets d WHERE ${SITEMAP_DATASET_PREDICATE}`
    );
    return result.rows[0].n;
}

// Stable, paginated slice for the XML sitemap (ordered by id so offsets are
// deterministic across pages). Same quality gate as the count above.
async function listDatasetSitemap({ limit, offset }) {
    const result = await pool.query(
        `SELECT d.id, d.name, d.metadata_modified
         FROM datasets d
         WHERE ${SITEMAP_DATASET_PREDICATE}
         ORDER BY d.id LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return result.rows;
}

async function pingDb() {
    await pool.query('SELECT 1');
    return true;
}

async function getLastSyncTime() {
    const result = await pool.query(`
        SELECT finished_at FROM sync_runs WHERE ok AND kind IN ('full','incremental') ORDER BY id DESC LIMIT 1
    `);
    return result.rows[0] ? result.rows[0].finished_at : null;
}

async function listRecentlyIngested(limit) {
    const result = await pool.query(`
        SELECT ir.resource_id, ir.ingested_at, ir.row_count,
               r.name_en, r.name_fr, r.format, r.dataset_id,
               d.name AS dataset_name, d.title_en AS dataset_title_en, d.title_fr AS dataset_title_fr
        FROM ingested_resources ir
        JOIN resources r ON r.id = ir.resource_id
        JOIN datasets d ON d.id = r.dataset_id
        WHERE ir.status = 'ready'
        ORDER BY ir.ingested_at DESC
        LIMIT $1
    `, [limit]);
    return result.rows;
}

async function getJobHealth() {
    const syncResult = await pool.query("SELECT kind, max(finished_at) AS last_ok_at FROM sync_runs WHERE ok GROUP BY kind");
    const evictResult = await pool.query("SELECT max(finished_at) AS last_ok_at FROM ingest_runs WHERE ok AND error LIKE 'evict:%'");
    return { syncRows: syncResult.rows, evictLastOkAt: evictResult.rows[0] ? evictResult.rows[0].last_ok_at : null };
}

module.exports = {
    searchDatasets,
    getDatasetByIdOrName,
    listResourcesForDataset,
    getResourceById,
    listOrganizations,
    getStats,
    countSitemapDatasets,
    listDatasetSitemap,
    pingDb,
    getLastSyncTime,
    listRecentlyIngested,
    getJobHealth
};
