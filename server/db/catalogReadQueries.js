const pool = require('./pool');

const PROVENANCE_SELECT = `COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'id', cs.id,
        'kind', cs.kind,
        'name_en', cs.name_en,
        'name_fr', cs.name_fr,
        'homepage_url', cs.homepage_url,
        'landing_url', ds.landing_url,
        'upstream_host', cs.upstream_host,
        'authoritative', ds.is_authoritative,
        'license_title_en', coalesce(ds.license_title_en, cs.default_license_title_en),
        'license_title_fr', coalesce(ds.license_title_fr, cs.default_license_title_fr),
        'license_url', coalesce(ds.license_url, cs.default_license_url),
        'attribution_en', coalesce(ds.attribution_en, cs.default_attribution_en),
        'attribution_fr', coalesce(ds.attribution_fr, cs.default_attribution_fr)
    ) ORDER BY ds.is_authoritative DESC, cs.id)
    FROM dataset_sources ds
    JOIN catalog_sources cs ON cs.id = ds.source_id
    WHERE ds.dataset_id = d.id AND cs.enabled
), '[]'::jsonb) AS provenance_sources`;

const PLACES_SELECT = `COALESCE((
    SELECT jsonb_agg(place_row ORDER BY place_row->>'kind', place_row->>'name_en')
    FROM (
        SELECT DISTINCT jsonb_build_object(
            'id', p.id,
            'slug', p.slug,
            'kind', p.kind,
            'name_en', p.name_en,
            'name_fr', p.name_fr,
            'relationship', dp.relationship,
            'includes_descendants', dp.includes_descendants
        ) AS place_row
        FROM dataset_places dp
        JOIN places p ON p.id = dp.place_id
        WHERE dp.dataset_id = d.id
    ) distinct_places
), '[]'::jsonb) AS places`;

const PLACE_CTES = `WITH RECURSIVE selected_place AS (
    SELECT p.id, p.parent_id, 0 AS depth
    FROM places p
    WHERE $5::text IS NOT NULL
      AND (p.id = $5 OR p.slug = $5 OR EXISTS (
          SELECT 1 FROM place_aliases pa WHERE pa.place_id = p.id AND pa.slug = $5
      ))
    UNION ALL
    SELECT parent.id, parent.parent_id, selected_place.depth + 1
    FROM places parent
    JOIN selected_place ON selected_place.parent_id = parent.id
), place_matches AS (
    SELECT DISTINCT ON (dp.dataset_id)
           dp.dataset_id, selected_place.depth,
           p.id AS matched_place_id, p.slug AS matched_place_slug,
           p.name_en AS matched_place_name_en, p.name_fr AS matched_place_name_fr,
           dp.relationship AS place_relationship
    FROM dataset_places dp
    JOIN selected_place ON selected_place.id = dp.place_id
    JOIN places p ON p.id = dp.place_id
    WHERE selected_place.depth = 0 OR dp.includes_descendants
    ORDER BY dp.dataset_id, selected_place.depth ASC,
             CASE dp.relationship WHEN 'direct' THEN 0 ELSE 1 END
)`;

async function searchDatasets({ q, org, format, keyword, place, source, mappable, limit, offset }) {
    const result = await pool.query(`${PLACE_CTES}
        SELECT d.id, d.name, d.title_en, d.title_fr, d.metadata_modified,
               o.name AS org_name, o.title_en AS org_title_en, o.title_fr AS org_title_fr,
               (SELECT count(*)::int FROM resources r WHERE r.dataset_id = d.id) AS resource_count,
               (SELECT count(*)::int FROM resources r
                 WHERE r.dataset_id = d.id
                   AND (r.datastore_active OR EXISTS (
                        SELECT 1 FROM ingested_resources ir
                        WHERE ir.resource_id = r.id AND ir.status = 'ready'))) AS queryable_count,
               (SELECT count(*)::int FROM resources r
                 JOIN resource_maps rm ON rm.resource_id = r.id
                 WHERE r.dataset_id = d.id) AS mappable_count,
               ${PROVENANCE_SELECT},
               ${PLACES_SELECT},
               pm.depth AS place_depth,
               pm.matched_place_id, pm.matched_place_slug,
               pm.matched_place_name_en, pm.matched_place_name_fr,
               pm.place_relationship
        FROM datasets d
        LEFT JOIN organizations o ON o.id = d.org_id
        LEFT JOIN place_matches pm ON pm.dataset_id = d.id
        WHERE ($1::text IS NULL OR d.search_tsv @@ (plainto_tsquery('english', $1) || plainto_tsquery('french', $1)))
          AND ($2::text IS NULL OR o.name = $2)
          AND ($3::text IS NULL OR EXISTS (
               SELECT 1 FROM resources r2
               WHERE r2.dataset_id = d.id AND r2.format = upper($3)))
          AND ($4::text IS NULL OR $4 = ANY(d.keywords_en) OR $4 = ANY(d.keywords_fr))
          AND ($5::text IS NULL OR pm.dataset_id IS NOT NULL)
          AND ($6::text IS NULL OR EXISTS (
               SELECT 1 FROM dataset_sources ds2 WHERE ds2.dataset_id = d.id AND ds2.source_id = $6))
          AND ($7::boolean IS NULL OR EXISTS (
               SELECT 1 FROM resources r3 JOIN resource_maps rm3 ON rm3.resource_id = r3.id
               WHERE r3.dataset_id = d.id))
        ORDER BY pm.depth ASC NULLS LAST,
                 CASE WHEN $1::text IS NULL THEN NULL
                      ELSE ts_rank(d.search_tsv, plainto_tsquery('english', $1) || plainto_tsquery('french', $1))
                 END DESC NULLS LAST,
                 d.metadata_modified DESC NULLS LAST,
                 d.id ASC
        LIMIT $8 OFFSET $9
    `, [q || null, org || null, format || null, keyword || null, place || null, source || null, mappable || null, limit, offset]);
    return result.rows;
}

async function getDatasetByIdOrName(idOrName) {
    const result = await pool.query(`
        SELECT d.id, d.name, d.title_en, d.title_fr, d.notes_en, d.notes_fr, d.org_id,
               d.keywords_en, d.keywords_fr, d.metadata_modified,
               o.name AS org_name, o.title_en AS org_title_en, o.title_fr AS org_title_fr,
               ${PROVENANCE_SELECT},
               ${PLACES_SELECT}
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
               ir.status AS ingest_status, ir.row_count AS ingested_row_count, ir.ingested_at,
               rm.provider AS map_provider, rm.geometry_type AS map_geometry_type,
               rm.extent AS map_extent, rm.fields AS map_fields
        FROM resources r
        LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
        LEFT JOIN resource_maps rm ON rm.resource_id = r.id
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
               ir.ingested_at, ir.last_accessed_at,
               rm.provider AS map_provider, rm.geometry_type AS map_geometry_type,
               rm.extent AS map_extent, rm.fields AS map_fields,
               ${PROVENANCE_SELECT},
               ${PLACES_SELECT}
        FROM resources r
        JOIN datasets d ON d.id = r.dataset_id
        LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
        LEFT JOIN resource_maps rm ON rm.resource_id = r.id
        WHERE r.id = $1
    `, [id]);
    return result.rows[0] || null;
}

async function getResourceMapById(id) {
    const result = await pool.query(`
        SELECT r.id, r.dataset_id, rm.provider, rm.service_url, rm.geometry_type,
               rm.extent, rm.object_id_field, rm.display_field, rm.fields,
               rm.max_record_count,
               ${PROVENANCE_SELECT}
        FROM resources r
        JOIN datasets d ON d.id = r.dataset_id
        JOIN resource_maps rm ON rm.resource_id = r.id
        WHERE r.id = $1
    `, [id]);
    return result.rows[0] || null;
}

async function listOrganizations({ source, place, limit, offset }) {
    const result = await pool.query(`WITH RECURSIVE selected_place AS (
        SELECT p.id, p.parent_id, 0 AS depth FROM places p
        WHERE $2::text IS NOT NULL AND (p.id = $2 OR p.slug = $2)
        UNION ALL
        SELECT p.id, p.parent_id, selected_place.depth + 1
        FROM places p JOIN selected_place ON selected_place.parent_id = p.id
    )
        SELECT o.id, o.name, o.title_en, o.title_fr,
               (SELECT count(DISTINCT d_count.id)::int
                FROM datasets d_count
                WHERE d_count.org_id = o.id
                  AND ($1::text IS NULL OR EXISTS (
                      SELECT 1 FROM dataset_sources ds_count
                      WHERE ds_count.dataset_id = d_count.id AND ds_count.source_id = $1))
                  AND ($2::text IS NULL OR EXISTS (
                      SELECT 1 FROM dataset_places dp_count
                      JOIN selected_place sp_count ON sp_count.id = dp_count.place_id
                      WHERE dp_count.dataset_id = d_count.id
                        AND (sp_count.depth = 0 OR dp_count.includes_descendants)))) AS dataset_count,
               p.id AS place_id, p.slug AS place_slug, p.name_en AS place_name_en, p.name_fr AS place_name_fr
        FROM organizations o
        LEFT JOIN places p ON p.id = o.place_id
        WHERE ($1::text IS NULL OR EXISTS (
            SELECT 1 FROM datasets d JOIN dataset_sources ds ON ds.dataset_id = d.id
            WHERE d.org_id = o.id AND ds.source_id = $1
        ))
          AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM datasets d
            JOIN dataset_places dp ON dp.dataset_id = d.id
            JOIN selected_place sp ON sp.id = dp.place_id
            WHERE d.org_id = o.id AND (sp.depth = 0 OR dp.includes_descendants)
        ))
        ORDER BY dataset_count DESC, o.name ASC
        LIMIT $3 OFFSET $4
    `, [source || null, place || null, limit, offset]);
    return result.rows;
}

async function listSources({ place } = {}) {
    const result = await pool.query(`WITH RECURSIVE selected_place AS (
        SELECT p.id, p.parent_id, 0 AS depth FROM places p
        WHERE $1::text IS NOT NULL AND (p.id = $1 OR p.slug = $1)
        UNION ALL
        SELECT p.id, p.parent_id, selected_place.depth + 1
        FROM places p JOIN selected_place ON selected_place.parent_id = p.id
    )
        SELECT cs.id, cs.kind, cs.name_en, cs.name_fr, cs.homepage_url, cs.catalog_url,
               cs.upstream_host,
               count(DISTINCT ds.dataset_id)::int AS dataset_count,
               (SELECT max(sr.finished_at) FROM sync_runs sr
                WHERE sr.source_id = cs.id AND sr.ok) AS last_synced_at
        FROM catalog_sources cs
        LEFT JOIN dataset_sources ds ON ds.source_id = cs.id
        WHERE cs.enabled AND ($1::text IS NULL OR EXISTS (
            SELECT 1 FROM dataset_places dp
            JOIN selected_place sp ON sp.id = dp.place_id
            WHERE dp.dataset_id = ds.dataset_id AND (sp.depth = 0 OR dp.includes_descendants)
        ))
        GROUP BY cs.id
        ORDER BY dataset_count DESC, cs.name_en
    `, [place || null]);
    return result.rows;
}

async function listPlaces({ q, kind, parent, limit, offset }) {
    const result = await pool.query(`
        SELECT p.id, p.slug, p.kind, p.name_en, p.name_fr, p.type_en, p.type_fr,
               p.parent_id, p.latitude, p.longitude, p.default_zoom,
               parent_place.slug AS parent_slug,
               parent_place.name_en AS parent_name_en, parent_place.name_fr AS parent_name_fr,
               count(DISTINCT dp.dataset_id)::int AS dataset_count,
               count(DISTINCT rm.resource_id)::int AS mappable_resource_count
        FROM places p
        LEFT JOIN places parent_place ON parent_place.id = p.parent_id
        LEFT JOIN dataset_places dp ON dp.place_id = p.id
        LEFT JOIN resources r ON r.dataset_id = dp.dataset_id
        LEFT JOIN resource_maps rm ON rm.resource_id = r.id
        WHERE p.enabled
          AND ($1::text IS NULL OR p.name_en ILIKE '%' || $1 || '%' OR p.name_fr ILIKE '%' || $1 || '%' OR p.slug ILIKE '%' || $1 || '%' OR EXISTS (
              SELECT 1 FROM place_aliases pa WHERE pa.place_id = p.id AND pa.slug ILIKE '%' || $1 || '%'
          ))
          AND ($1::text IS NOT NULL OR dp.dataset_id IS NOT NULL)
          AND ($2::text IS NULL OR p.kind = $2)
          AND ($3::text IS NULL OR p.parent_id = $3 OR parent_place.slug = $3)
        GROUP BY p.id, parent_place.id
        ORDER BY (count(DISTINCT dp.dataset_id) > 0) DESC, p.kind, p.name_en
        LIMIT $4 OFFSET $5
    `, [q || null, kind || null, parent || null, limit, offset]);
    return result.rows;
}

async function getPlaceByIdOrSlug(idOrSlug) {
    const placeResult = await pool.query(`
        SELECT p.id, p.slug, p.kind, p.name_en, p.name_fr, p.type_en, p.type_fr,
               p.parent_id, p.latitude, p.longitude, p.default_zoom
        FROM places p
        WHERE p.id = $1 OR p.slug = $1 OR EXISTS (
            SELECT 1 FROM place_aliases pa WHERE pa.place_id = p.id AND pa.slug = $1
        )
        LIMIT 1
    `, [idOrSlug]);
    const place = placeResult.rows[0];
    if (!place) return null;
    const ancestorsResult = await pool.query(`WITH RECURSIVE ancestry AS (
        SELECT p.id, p.slug, p.kind, p.name_en, p.name_fr, p.parent_id, 0 AS depth
        FROM places p WHERE p.id = $1
        UNION ALL
        SELECT p.id, p.slug, p.kind, p.name_en, p.name_fr, p.parent_id, ancestry.depth + 1
        FROM places p JOIN ancestry ON ancestry.parent_id = p.id
    ) SELECT * FROM ancestry ORDER BY depth DESC`, [place.id]);
    const countResult = await pool.query(`WITH RECURSIVE ancestry AS (
        SELECT p.id, p.parent_id, 0 AS depth FROM places p WHERE p.id = $1
        UNION ALL
        SELECT p.id, p.parent_id, ancestry.depth + 1
        FROM places p JOIN ancestry ON ancestry.parent_id = p.id
    ), relevant AS (
        SELECT DISTINCT dp.dataset_id FROM dataset_places dp
        JOIN ancestry a ON a.id = dp.place_id
        WHERE a.depth = 0 OR dp.includes_descendants
    ) SELECT count(*)::int AS dataset_count,
             count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM resources r JOIN resource_maps rm ON rm.resource_id = r.id
                 WHERE r.dataset_id = relevant.dataset_id
             ))::int AS mappable_dataset_count
      FROM relevant`, [place.id]);
    return { ...place, ancestors: ancestorsResult.rows, ...countResult.rows[0] };
}

async function getStats() {
    const result = await pool.query(`
        SELECT (SELECT count(*)::int FROM datasets) AS datasets,
               (SELECT count(*)::int FROM resources) AS resources,
               (SELECT count(*)::int FROM resources WHERE datastore_active) AS datastore_active_resources,
               (SELECT count(*)::int FROM resource_maps) AS mappable_resources,
               (SELECT count(*)::int FROM ingested_resources WHERE status = 'ready') AS ingested_resources,
               (SELECT coalesce(sum(byte_size), 0)::bigint FROM ingested_resources WHERE status = 'ready') AS store_bytes,
               (SELECT count(*)::int FROM organizations WHERE dataset_count > 0) AS organizations,
               (SELECT count(*)::int FROM places p WHERE EXISTS (
                    SELECT 1 FROM dataset_places dp WHERE dp.place_id = p.id
               )) AS places
    `);
    return result.rows[0];
}

const SITEMAP_DATASET_PREDICATE = `EXISTS (
        SELECT 1 FROM resources r
        WHERE r.dataset_id = d.id
          AND (r.datastore_active
               OR EXISTS (SELECT 1 FROM ingested_resources ir
                          WHERE ir.resource_id = r.id AND ir.status = 'ready')
               OR EXISTS (SELECT 1 FROM resource_maps rm WHERE rm.resource_id = r.id)))`;

async function countSitemapDatasets() {
    const result = await pool.query(`SELECT count(*)::int AS n FROM datasets d WHERE ${SITEMAP_DATASET_PREDICATE}`);
    return result.rows[0].n;
}

async function listDatasetSitemap({ limit, offset }) {
    const result = await pool.query(`
        SELECT d.id, d.name, d.metadata_modified FROM datasets d
        WHERE ${SITEMAP_DATASET_PREDICATE}
        ORDER BY d.id LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return result.rows;
}

async function listPlaceSitemap() {
    const result = await pool.query(`
        SELECT p.slug, max(d.metadata_modified) AS metadata_modified
        FROM places p
        JOIN dataset_places dp ON dp.place_id = p.id
        JOIN datasets d ON d.id = dp.dataset_id
        GROUP BY p.id ORDER BY p.slug
    `);
    return result.rows;
}

async function pingDb() {
    await pool.query('SELECT 1');
    return true;
}

async function getLastSyncTime() {
    const result = await pool.query(`
        SELECT finished_at FROM sync_runs
        WHERE ok AND (source_id IS NOT NULL OR kind IN ('full','incremental'))
        ORDER BY finished_at DESC LIMIT 1
    `);
    return result.rows[0] ? result.rows[0].finished_at : null;
}

async function listRecentlyIngested(limit, place = null) {
    const result = await pool.query(`WITH RECURSIVE selected_place AS (
        SELECT p.id, p.parent_id, 0 AS depth FROM places p
        WHERE $2::text IS NOT NULL AND (p.id = $2 OR p.slug = $2)
        UNION ALL
        SELECT p.id, p.parent_id, selected_place.depth + 1
        FROM places p JOIN selected_place ON selected_place.parent_id = p.id
    )
        SELECT ir.resource_id, ir.ingested_at, ir.row_count,
               r.name_en, r.name_fr, r.format, r.dataset_id,
               d.name AS dataset_name, d.title_en AS dataset_title_en, d.title_fr AS dataset_title_fr
        FROM ingested_resources ir
        JOIN resources r ON r.id = ir.resource_id
        JOIN datasets d ON d.id = r.dataset_id
        WHERE ir.status = 'ready'
          AND ($2::text IS NULL OR EXISTS (
              SELECT 1 FROM dataset_places dp JOIN selected_place sp ON sp.id = dp.place_id
              WHERE dp.dataset_id = d.id AND (sp.depth = 0 OR dp.includes_descendants)
          ))
        ORDER BY ir.ingested_at DESC LIMIT $1
    `, [limit, place]);
    return result.rows;
}

async function getJobHealth() {
    const syncResult = await pool.query(`
        SELECT kind, source_id, max(finished_at) AS last_ok_at
        FROM sync_runs WHERE ok GROUP BY kind, source_id
    `);
    const evictResult = await pool.query("SELECT max(finished_at) AS last_ok_at FROM ingest_runs WHERE ok AND error LIKE 'evict:%'");
    return { syncRows: syncResult.rows, evictLastOkAt: evictResult.rows[0] ? evictResult.rows[0].last_ok_at : null };
}

module.exports = {
    searchDatasets,
    getDatasetByIdOrName,
    listResourcesForDataset,
    getResourceById,
    getResourceMapById,
    listOrganizations,
    listSources,
    listPlaces,
    getPlaceByIdOrSlug,
    getStats,
    countSitemapDatasets,
    listDatasetSitemap,
    listPlaceSitemap,
    pingDb,
    getLastSyncTime,
    listRecentlyIngested,
    getJobHealth
};
