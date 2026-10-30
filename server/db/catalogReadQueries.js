const { searchExpression, literalPatterns } = require('../services/localSearch');
const pool = require('./pool');
const catalogReadCache = require('../services/catalogReadCache');
const { listParam, upper, selectedPlaceCte, HAS_TABLE, HAS_MAP, match, dataBearingResource } = require('./catalogSqlFragments');
const { ingestLimits } = require('../config/ingest');

function cachedRows(name, sql, values, db) {
    const read = async () => (await db.query(sql, values)).rows;
    // Transactional callers must read their own snapshot and uncommitted data.
    if (db !== pool) return read();
    return catalogReadCache.get(JSON.stringify([name, values]), read);
}

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

const PLACE_CTES = `WITH RECURSIVE ${selectedPlaceCte('$5')}, place_matches AS (
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

const RELEVANCE_ORDER = {
    inner: `pm.depth ASC NULLS LAST, literal_rank DESC, search_rank DESC NULLS LAST,
                 d.metadata_modified DESC NULLS LAST, d.id ASC`,
    outer: `pm.depth ASC NULLS LAST,
                 pm.literal_rank DESC,
                 pm.search_rank DESC NULLS LAST,
                 d.metadata_modified DESC NULLS LAST,
                 d.id ASC`
};

// Allowlisted orders. Each ends in d.id so OFFSET pages never overlap.
function datasetOrder(sort, lang) {
    if (sort === 'updated') {
        const order = 'd.metadata_modified DESC NULLS LAST, d.id ASC';
        return { name: 'datasets:updated', select: '', inner: order, outer: order };
    }
    if (sort === 'title' || sort === 'title_desc') {
        const [first, second] = lang === 'fr' ? ['fr', 'en'] : ['en', 'fr'];
        const title = `coalesce(nullif(btrim(d.title_${first}), ''), nullif(btrim(d.title_${second}), ''), d.name)`;
        const direction = sort === 'title' ? 'ASC' : 'DESC';
        return { name: `datasets:${sort}:${first}`, select: `,\n               ${title} AS sort_title`,
            inner: `${title} ${direction}, d.id ASC`, outer: `pm.sort_title ${direction}, d.id ASC` };
    }
    return { name: 'datasets', select: '', ...RELEVANCE_ORDER };
}

async function searchDatasets({ q, org, format, keyword, place, source, mappable, level, queryable, sort, lang, limit, offset }, db = pool) {
    const order = datasetOrder(sort, lang);
    // Select the requested identities before evaluating resource/provenance
    // subqueries. Otherwise OFFSET enriches every skipped dataset as well.
    return cachedRows(order.name, `${PLACE_CTES}, dataset_page AS MATERIALIZED (
        SELECT d.id AS dataset_id, pm.depth,
               pm.matched_place_id, pm.matched_place_slug,
               pm.matched_place_name_en, pm.matched_place_name_fr, pm.place_relationship,
               CASE WHEN $1::text IS NULL THEN 0 ELSE (SELECT coalesce(sum(
                    CASE WHEN concat_ws(' ', d.title_en, d.title_fr) ~* pattern THEN 8 ELSE 0 END +
                    CASE WHEN concat_ws(' ', array_to_string(d.keywords_en, ' '), array_to_string(d.keywords_fr, ' ')) ~* pattern THEN 4 ELSE 0 END +
                    CASE WHEN concat_ws(' ', d.notes_en, d.notes_fr) ~* pattern THEN 1 ELSE 0 END
                ), 0) FROM unnest($11::text[]) AS pattern) END AS literal_rank,
               CASE WHEN $1::text IS NULL THEN NULL
                    ELSE ts_rank(d.search_tsv, to_tsquery('english', $10) || to_tsquery('french', $10))
               END AS search_rank,
               d.metadata_modified${order.select}
        FROM datasets d
        LEFT JOIN organizations o ON o.id = d.org_id
        LEFT JOIN place_matches pm ON pm.dataset_id = d.id
        WHERE ($1::text IS NULL OR ${match.search('$10')})
          AND ($2::text[] IS NULL OR ${match.org('$2')})
          AND ($3::text[] IS NULL OR ${match.format('$3')})
          AND ($4::text[] IS NULL OR ${match.keyword('$4')})
          AND ($5::text IS NULL OR pm.dataset_id IS NOT NULL)
          AND ($6::text[] IS NULL OR ${match.source('$6')})
          AND ($7::boolean IS NULL OR ${HAS_MAP})
          AND ($12::text[] IS NULL OR ${match.level('$12')})
          AND ($13::boolean IS NULL OR ${HAS_TABLE})
        ORDER BY ${order.inner}
        LIMIT $8 OFFSET $9
    )
        SELECT d.id, d.name, d.title_en, d.title_fr, d.metadata_modified,
               d.notes_en, d.notes_fr,
               (SELECT r.id FROM resources r JOIN resource_maps rm ON rm.resource_id = r.id
                WHERE r.dataset_id = d.id ORDER BY r.id LIMIT 1) AS preview_map_id,
               (SELECT r.id FROM resources r LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
                WHERE r.dataset_id = d.id AND (r.datastore_active OR ir.status = 'ready')
                ORDER BY (ir.status = 'ready') DESC NULLS LAST, r.id LIMIT 1) AS preview_table_id,
               pm.literal_rank,
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
        FROM dataset_page pm
        JOIN datasets d ON d.id = pm.dataset_id
        LEFT JOIN organizations o ON o.id = d.org_id
        ORDER BY ${order.outer}
    `, [q || null, listParam(org), listParam(format, upper), listParam(keyword), place || null, listParam(source), mappable || null,
        limit, offset, searchExpression(q) || null, literalPatterns(q), listParam(level), queryable || null], db);
}

async function getDatasetByIdOrName(idOrName) {
    const result = await pool.query(`
        SELECT d.id, d.name, d.title_en, d.title_fr, d.notes_en, d.notes_fr, d.org_id,
               d.keywords_en, d.keywords_fr, d.metadata_modified, d.jurisdiction,
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

// Files of one dataset that share a name, format and language: yearly files
// such as "Key ratios" for 2022, 2023 and 2024. The pages tell them apart by
// the year in the file name (seoMeta.resourceSubject). The name is normalized
// the way the page titles pick it: English, else French.
const RESOURCE_NAME_KEY = alias => `lower(btrim(coalesce(nullif(btrim(${alias}.name_en), ''), ${alias}.name_fr, '')))`;
const SAME_NAME_PARTITION = `${RESOURCE_NAME_KEY('r')}, upper(coalesce(r.format, '')), coalesce(r.language, '')`;

async function listResourcesForDataset(datasetId, db = pool) {
    const result = await db.query(`
        SELECT r.id, r.dataset_id, r.name_en, r.name_fr, r.format, r.url, r.size_bytes, r.raw,
               r.datastore_active, r.language, r.last_modified,
               (count(*) OVER (PARTITION BY ${SAME_NAME_PARTITION}) - 1)::int AS same_name_siblings,
               ir.status AS ingest_status, ir.row_count AS ingested_row_count, ir.ingested_at, ir.source_version AS ingested_source_version,
               rm.provider AS map_provider, rm.geometry_type AS map_geometry_type,
               rm.extent AS map_extent, rm.fields AS map_fields,
               rm.indexed_at AS map_indexed_at,
               rm.source_version AS map_source_version,
               rm.tile_min_zoom AS map_tile_min_zoom,
               rm.tile_max_zoom AS map_tile_max_zoom,
               rm.tile_layer AS map_tile_layer
        FROM resources r
        LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
        LEFT JOIN resource_maps rm ON rm.resource_id = r.id
        WHERE r.dataset_id = $1
        ORDER BY CASE
                    WHEN ir.status = 'ready' THEN 0
                    WHEN r.datastore_active THEN 1
                    WHEN rm.resource_id IS NOT NULL THEN 2
                    WHEN r.format IN ('CSV','XLSX','XLS') THEN 3
                    ELSE 4
                 END,
                 r.name_en NULLS LAST, r.id
    `, [datasetId]);
    return result.rows;
}

async function getResourceById(id, db = require('./snapshotRead').snapshotDb()) {
    const result = await db.query(`
        SELECT r.id, r.dataset_id, r.name_en, r.name_fr, r.format, r.url, r.size_bytes, r.raw,
               r.datastore_active, r.language, r.last_modified,
               (SELECT count(*)::int FROM resources s
                WHERE s.dataset_id = r.dataset_id AND s.id <> r.id AND ${RESOURCE_NAME_KEY('s')} = ${RESOURCE_NAME_KEY('r')}
                  AND upper(coalesce(s.format, '')) = upper(coalesce(r.format, ''))
                  AND coalesce(s.language, '') = coalesce(r.language, '')) AS same_name_siblings,
               d.name AS dataset_name, d.title_en AS dataset_title_en, d.title_fr AS dataset_title_fr,
               d.notes_en AS dataset_notes_en, d.notes_fr AS dataset_notes_fr,
               o.name AS org_name, o.title_en AS org_title_en, o.title_fr AS org_title_fr,
               ir.status AS ingest_status, ir.table_name, ir.row_count AS ingested_row_count,
               ir.byte_size AS ingested_byte_size, ir.columns AS ingested_columns,
               ir.ingested_at, ir.last_accessed_at, ir.source_version AS ingested_source_version,
               (SELECT jsonb_build_object('id', j.id, 'status', j.status, 'source_version', j.source_version, 'retry_at', j.retry_at, 'failure_code', j.failure_code)
                FROM ingest_jobs j WHERE j.resource_id = r.id
                ORDER BY (j.status IN ('pending','running')) DESC, j.id DESC LIMIT 1) AS preparation_job,
               rm.provider AS map_provider, rm.geometry_type AS map_geometry_type,
               rm.extent AS map_extent, rm.fields AS map_fields,
               rm.indexed_at AS map_indexed_at,
               rm.source_version AS map_source_version,
               rm.tile_min_zoom AS map_tile_min_zoom,
               rm.tile_max_zoom AS map_tile_max_zoom,
               rm.tile_layer AS map_tile_layer,
               ${PROVENANCE_SELECT},
               ${PLACES_SELECT}
        FROM resources r
        JOIN datasets d ON d.id = r.dataset_id
        LEFT JOIN organizations o ON o.id = d.org_id
        LEFT JOIN ingested_resources ir ON ir.resource_id = r.id
        LEFT JOIN resource_maps rm ON rm.resource_id = r.id
        WHERE r.id = $1
    `, [id]);
    return result.rows[0] || null;
}

async function getOrganizationByName(name, db = pool) {
    const result = await db.query(`
        SELECT o.id, o.name, o.title_en, o.title_fr,
               p.id AS place_id, p.slug AS place_slug,
               p.name_en AS place_name_en, p.name_fr AS place_name_fr,
               (SELECT count(*)::int FROM datasets d
                WHERE d.org_id = o.id) AS dataset_count,
               (SELECT count(*)::int FROM datasets d
                WHERE d.org_id = o.id AND EXISTS (
                    SELECT 1 FROM resources r
                    WHERE r.dataset_id = d.id
                      AND (r.datastore_active OR EXISTS (
                          SELECT 1 FROM ingested_resources ir
                          WHERE ir.resource_id = r.id AND ir.status = 'ready'
                      ))
                )) AS queryable_dataset_count,
               (SELECT count(*)::int FROM datasets d
                WHERE d.org_id = o.id AND EXISTS (
                    SELECT 1 FROM resources r
                    JOIN resource_maps rm ON rm.resource_id = r.id
                    WHERE r.dataset_id = d.id
                )) AS mappable_dataset_count,
               (SELECT max(d.metadata_modified) FROM datasets d
                WHERE d.org_id = o.id) AS metadata_modified,
               EXISTS (SELECT 1 FROM datasets d
                WHERE d.org_id = o.id AND d.jurisdiction IS NOT NULL) AS government
        FROM organizations o
        LEFT JOIN places p ON p.id = o.place_id
        WHERE o.name = $1
        LIMIT 1
    `, [name]);
    return result.rows[0] || null;
}

async function getResourceMapById(id) {
    const result = await pool.query(`
        SELECT r.id, r.dataset_id, rm.provider, rm.service_url, rm.geometry_type,
               rm.extent, rm.object_id_field, rm.display_field, rm.fields,
               rm.max_record_count, rm.feature_count, rm.byte_size,
               rm.indexed_at, rm.source_version, rm.updated_at,
               rm.storage_key, rm.storage_etag, rm.storage_sha256,
               rm.tile_min_zoom, rm.tile_max_zoom, rm.tile_layer,
               ${PROVENANCE_SELECT}
        FROM resources r
        JOIN datasets d ON d.id = r.dataset_id
        JOIN resource_maps rm ON rm.resource_id = r.id
        WHERE r.id = $1
    `, [id]);
    return result.rows[0] || null;
}

// A place's publishers without a source filter (the place hub and its client
// rail): the place's datasets are found once and grouped by publisher, instead
// of testing every publisher's datasets against the place, which is a pass over
// the whole catalogue. Same rows, counts and order as the general query.
const PLACE_ORGANIZATIONS_SQL = `WITH RECURSIVE selected_place AS (
        SELECT p.id, p.parent_id, 0 AS depth FROM places p
        WHERE p.id = $1 OR p.slug = $1
        UNION ALL
        SELECT p.id, p.parent_id, selected_place.depth + 1
        FROM places p JOIN selected_place ON selected_place.parent_id = p.id
    ), place_datasets AS (
        SELECT DISTINCT dp.dataset_id FROM dataset_places dp
        JOIN selected_place sp ON sp.id = dp.place_id
        WHERE sp.depth = 0 OR dp.includes_descendants
    ), counts AS (
        SELECT d.org_id, count(*)::int AS dataset_count
        FROM place_datasets pd JOIN datasets d ON d.id = pd.dataset_id
        WHERE d.org_id IS NOT NULL
        GROUP BY d.org_id
    )
        SELECT o.id, o.name, o.title_en, o.title_fr, c.dataset_count,
               p.id AS place_id, p.slug AS place_slug, p.name_en AS place_name_en, p.name_fr AS place_name_fr
        FROM counts c
        JOIN organizations o ON o.id = c.org_id
        LEFT JOIN places p ON p.id = o.place_id
        WHERE $4::text IS NULL OR position(lower($4) in lower(concat_ws(' ', o.name, o.title_en, o.title_fr))) > 0
        ORDER BY c.dataset_count DESC, o.name ASC
        LIMIT $2 OFFSET $3
    `;

async function listOrganizations({ q, source, place, limit, offset }, db = pool) {
    if (place && !source) {
        return cachedRows('place-organizations', PLACE_ORGANIZATIONS_SQL, [place, limit, offset, q || null], db);
    }
    return cachedRows('organizations', `WITH RECURSIVE selected_place AS (
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
        WHERE EXISTS (SELECT 1 FROM datasets d_any WHERE d_any.org_id = o.id)
          AND ($1::text IS NULL OR EXISTS (
            SELECT 1 FROM datasets d JOIN dataset_sources ds ON ds.dataset_id = d.id
            WHERE d.org_id = o.id AND ds.source_id = $1
        ))
          AND ($2::text IS NULL OR EXISTS (
            SELECT 1 FROM datasets d
            JOIN dataset_places dp ON dp.dataset_id = d.id
            JOIN selected_place sp ON sp.id = dp.place_id
            WHERE d.org_id = o.id AND (sp.depth = 0 OR dp.includes_descendants)
        ))
        AND ($5::text IS NULL OR position(lower($5) in lower(concat_ws(' ', o.name, o.title_en, o.title_fr))) > 0)
        ORDER BY dataset_count DESC, o.name ASC
        LIMIT $3 OFFSET $4
    `, [source || null, place || null, limit, offset, q || null], db);
}

async function listSources({ place } = {}, db = pool) {
    return cachedRows('sources', `WITH RECURSIVE selected_place AS (
        SELECT p.id, p.parent_id, 0 AS depth FROM places p
        WHERE $1::text IS NOT NULL AND (p.id = $1 OR p.slug = $1 OR EXISTS (
            SELECT 1 FROM place_aliases pa WHERE pa.place_id = p.id AND pa.slug = $1
        ))
        UNION ALL
        SELECT p.id, p.parent_id, selected_place.depth + 1
        FROM places p JOIN selected_place ON selected_place.parent_id = p.id
    ), applicable_datasets AS (
        SELECT DISTINCT dp.dataset_id
        FROM dataset_places dp
        JOIN selected_place sp ON sp.id = dp.place_id
        WHERE sp.depth = 0 OR dp.includes_descendants
    ), source_counts AS (
        SELECT ds.source_id,
               count(DISTINCT ds.dataset_id) FILTER (
                   WHERE $1::text IS NULL OR ad.dataset_id IS NOT NULL
               )::int AS dataset_count,
               count(DISTINCT ds.dataset_id) FILTER (
                   WHERE ds.is_authoritative AND ($1::text IS NULL OR ad.dataset_id IS NOT NULL)
               )::int AS authoritative_dataset_count
        FROM dataset_sources ds
        LEFT JOIN applicable_datasets ad ON ad.dataset_id = ds.dataset_id
        GROUP BY ds.source_id
    )
        SELECT cs.id, cs.kind, cs.name_en, cs.name_fr, cs.homepage_url, cs.catalog_url,
               cs.upstream_host,
               coalesce(sc.dataset_count, 0)::int AS dataset_count,
               coalesce(sc.authoritative_dataset_count, 0)::int AS authoritative_dataset_count,
               (SELECT max(sr.finished_at) FROM sync_runs sr
                WHERE sr.source_id = cs.id AND sr.ok) AS last_synced_at
        FROM catalog_sources cs
        LEFT JOIN source_counts sc ON sc.source_id = cs.id
        WHERE cs.enabled
          AND ($1::text IS NULL OR coalesce(sc.authoritative_dataset_count, 0) > 0)
        ORDER BY authoritative_dataset_count DESC, dataset_count DESC, cs.name_en
    `, [place || null], db);
}

// The directory lists every place with open data: a place with its own
// dataset rows, or a featured place whose datasets come from a broader area.
// `within` restricts the list to the descendants of one place (a province's
// hub lists the places inside it). Rows carry their province or territory
// (the hierarchy is municipality -> region -> province -> country) and are
// ordered by it, so the directory groups by province across pages.
const KIND_ORDER = `CASE p.kind WHEN 'region' THEN 0 WHEN 'municipality' THEN 1
                     WHEN 'province' THEN 2 WHEN 'territory' THEN 2 ELSE 3 END`;

async function listPlaces({ q, kind, parent, featured, within = null, limit, offset }, db = pool) {
    return cachedRows('places', `WITH RECURSIVE within_places AS (
        SELECT p.id FROM places p
        WHERE $7::text IS NOT NULL AND (p.id = $7 OR p.slug = $7)
        UNION ALL
        SELECT child.id FROM places child JOIN within_places w ON child.parent_id = w.id
    ), candidate_places AS MATERIALIZED (
        SELECT p.*, province.slug AS province_slug, province.name_en AS province_name_en, province.name_fr AS province_name_fr
        FROM places p
        LEFT JOIN places parent_place ON parent_place.id = p.parent_id
        LEFT JOIN places grand_place ON grand_place.id = parent_place.parent_id
        LEFT JOIN places province ON province.id = CASE
            WHEN p.kind IN ('province', 'territory') THEN p.id
            WHEN parent_place.kind IN ('province', 'territory') THEN parent_place.id
            WHEN grand_place.kind IN ('province', 'territory') THEN grand_place.id END
        WHERE p.enabled
          AND ($1::text IS NULL OR p.name_en ILIKE '%' || $1 || '%' OR p.name_fr ILIKE '%' || $1 || '%' OR p.slug ILIKE '%' || $1 || '%' OR EXISTS (
              SELECT 1 FROM place_aliases pa WHERE pa.place_id = p.id AND pa.slug ILIKE '%' || $1 || '%'
          ))
          AND ($2::text IS NULL OR p.kind = $2)
          AND ($3::text IS NULL OR p.parent_id = $3 OR parent_place.slug = $3)
          AND ($4::boolean IS NULL OR p.featured = $4)
          AND ($7::text IS NULL OR (p.id IN (SELECT id FROM within_places) AND p.id <> $7 AND p.slug <> $7))
          AND ($1::text IS NOT NULL OR $4::boolean IS TRUE OR p.featured OR EXISTS (
              SELECT 1 FROM dataset_places dp WHERE dp.place_id = p.id
          ))
        ORDER BY province.name_en NULLS FIRST, ${KIND_ORDER}, p.name_en, p.id
        LIMIT $5 OFFSET $6
    ), ancestry AS (
        SELECT p.id AS selected_id, p.id AS ancestor_id, 0 AS depth
        FROM candidate_places p
        UNION ALL
        SELECT ancestry.selected_id, parent.id, ancestry.depth + 1
        FROM ancestry
        JOIN places current_place ON current_place.id = ancestry.ancestor_id
        JOIN places parent ON parent.id = current_place.parent_id
    ), applicable_datasets AS (
        SELECT DISTINCT ancestry.selected_id, dp.dataset_id
        FROM ancestry
        JOIN dataset_places dp ON dp.place_id = ancestry.ancestor_id
        WHERE ancestry.depth = 0 OR dp.includes_descendants
    ), direct_datasets AS (
        SELECT DISTINCT dp.place_id AS selected_id, dp.dataset_id
        FROM dataset_places dp
        JOIN candidate_places p ON p.id = dp.place_id
        WHERE dp.relationship = 'direct'
    ), dataset_counts AS (
        SELECT selected_id, count(*)::int AS dataset_count
        FROM applicable_datasets GROUP BY selected_id
    ), direct_counts AS (
        SELECT selected_id, count(*)::int AS direct_dataset_count
        FROM direct_datasets GROUP BY selected_id
    ), map_counts AS (
        SELECT ad.selected_id, count(DISTINCT rm.resource_id)::int AS mappable_resource_count
        FROM applicable_datasets ad
        JOIN resources r ON r.dataset_id = ad.dataset_id
        JOIN resource_maps rm ON rm.resource_id = r.id
        GROUP BY ad.selected_id
    )
        SELECT p.id, p.slug, p.kind, p.name_en, p.name_fr, p.type_en, p.type_fr,
               p.parent_id, p.latitude, p.longitude, p.default_zoom, p.featured,
               parent_place.slug AS parent_slug,
               parent_place.name_en AS parent_name_en, parent_place.name_fr AS parent_name_fr,
               p.province_slug, p.province_name_en, p.province_name_fr,
               coalesce(dc.dataset_count, 0)::int AS dataset_count,
               coalesce(ddc.direct_dataset_count, 0)::int AS direct_dataset_count,
               coalesce(mc.mappable_resource_count, 0)::int AS mappable_resource_count
        FROM candidate_places p
        LEFT JOIN places parent_place ON parent_place.id = p.parent_id
        LEFT JOIN dataset_counts dc ON dc.selected_id = p.id
        LEFT JOIN direct_counts ddc ON ddc.selected_id = p.id
        LEFT JOIN map_counts mc ON mc.selected_id = p.id
        ORDER BY p.province_name_en NULLS FIRST, ${KIND_ORDER}, p.name_en, p.id
    `, [q || null, kind || null, parent || null, featured ?? null, limit, offset, within || null], db);
}

async function getPlaceByIdOrSlug(idOrSlug) {
    const placeResult = await pool.query(`
        SELECT p.id, p.slug, p.kind, p.name_en, p.name_fr, p.type_en, p.type_fr,
               p.parent_id, p.latitude, p.longitude, p.default_zoom, p.featured, p.enabled
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
             (SELECT count(DISTINCT dp.dataset_id)::int
              FROM dataset_places dp
              WHERE dp.place_id = $1 AND dp.relationship = 'direct') AS direct_dataset_count,
             count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM resources r JOIN resource_maps rm ON rm.resource_id = r.id
                 WHERE r.dataset_id = relevant.dataset_id
             ))::int AS mappable_dataset_count,
             (SELECT max(d.metadata_modified) FROM datasets d
              WHERE d.id IN (SELECT dataset_id FROM relevant)) AS last_modified
      FROM relevant`, [place.id]);
    // A province or territory lists every place inside it that has open
    // data; a region lists its municipalities (featured or with their own
    // datasets); a municipality has no children of its own.
    const children = ['province', 'territory'].includes(place.kind)
        ? await listPlaces({ q: null, kind: null, parent: null, featured: null, within: place.id, limit: 100, offset: 0 })
        : place.kind === 'region'
            ? await listPlaces({ q: null, kind: 'municipality', parent: place.id, featured: null, limit: 100, offset: 0 })
            : [];
    return { ...place, ancestors: ancestorsResult.rows, children, ...countResult.rows[0] };
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

// Every dataset page is eligible, including metadata-only records. Resource
// pages are listed only when they offer more than their dataset page does: a
// live table, a prepared copy, a map, or a file CanQuery can prepare. The
// predicate shares its caps with the capability classifier through config/ingest.
async function countSitemapDatasets(db = pool) {
    const result = await db.query('SELECT count(*)::int AS n FROM datasets');
    return result.rows[0].n;
}

async function listDatasetSitemap({ limit, offset }, db = pool) {
    const result = await db.query(`
        SELECT d.id, d.name, d.metadata_modified FROM datasets d
        ORDER BY d.id LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return result.rows;
}

const DATA_BEARING_RESOURCE = dataBearingResource({ csvCap: '$1', xlsxCap: '$2', maxRows: '$3', maxCols: '$4' });
function dataBearingParams() {
    const limits = ingestLimits();
    return [limits.maxFileBytes, limits.maxXlsxBytes, limits.maxRows, limits.maxCols];
}

async function countSitemapResources(db = pool) {
    const result = await db.query(`
        SELECT count(*)::int AS n FROM resources r JOIN datasets d ON d.id = r.dataset_id
        WHERE ${DATA_BEARING_RESOURCE}
    `, dataBearingParams());
    return result.rows[0].n;
}

// lastmod is the file's own publisher-reported change when recorded, else the
// dataset record's; a future-dated value is clamped to now.
async function listResourceSitemap({ limit, offset }, db = pool) {
    const result = await db.query(`
        SELECT r.id, LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) AS lastmod FROM resources r
        JOIN datasets d ON d.id = r.dataset_id
        WHERE ${DATA_BEARING_RESOURCE}
        ORDER BY r.id LIMIT $5 OFFSET $6
    `, [...dataBearingParams(), limit, offset]);
    return result.rows;
}

// Download-only resource pages that Google still showed in the last `days` of
// imported Search Console data. They carry noindex, which Google applies only
// once it crawls a page again, so a sitemap entry dated by that change brings
// the crawler back. A page Google has dropped stops appearing in the data and
// leaves this list `days` later. Undated files and files dated before `since`,
// when their pages turned noindex, carry `since`.
async function listNoindexResourceSitemap({ pagePrefix, days, since, limit }, db = pool) {
    const result = await db.query(`
        WITH latest AS (
            SELECT max(data_date) AS data_date FROM search_console_breakdowns
            WHERE search_type = 'web' AND dimension = 'page'
        ), shown AS (
            SELECT DISTINCT substr(b.value, length($5) + 1) AS id
            FROM search_console_breakdowns b, latest
            WHERE b.search_type = 'web' AND b.dimension = 'page' AND b.impressions > 0
              AND b.data_date > latest.data_date - $6::int AND starts_with(b.value, $5)
        )
        SELECT r.id, GREATEST(LEAST(COALESCE(r.last_modified, d.metadata_modified, $7::timestamptz), now()), $7::timestamptz) AS lastmod
        FROM resources r
        JOIN datasets d ON d.id = r.dataset_id
        JOIN shown ON shown.id = r.id
        WHERE ${DATA_BEARING_RESOURCE} IS NOT TRUE
        ORDER BY r.id LIMIT $8
    `, [...dataBearingParams(), pagePrefix, days, since, limit]);
    return result.rows;
}

// The newest change each sitemap chunk holds, numbered like the chunk files
// (1-based, in id order, pageSize URLs each) and dated like their entries.
async function listDatasetSitemapChunkLastmods(pageSize, db = pool) {
    const result = await db.query(`
        SELECT chunk::int AS chunk, max(lastmod) AS lastmod FROM (
            SELECT (row_number() OVER (ORDER BY d.id) - 1) / $1 + 1 AS chunk, d.metadata_modified AS lastmod
            FROM datasets d
        ) chunks GROUP BY chunk ORDER BY chunk
    `, [pageSize]);
    return result.rows;
}

async function listResourceSitemapChunkLastmods(pageSize, db = pool) {
    const result = await db.query(`
        SELECT chunk::int AS chunk, max(lastmod) AS lastmod FROM (
            SELECT (row_number() OVER (ORDER BY r.id) - 1) / $5 + 1 AS chunk,
                   LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) AS lastmod
            FROM resources r JOIN datasets d ON d.id = r.dataset_id
            WHERE ${DATA_BEARING_RESOURCE}
        ) chunks GROUP BY chunk ORDER BY chunk
    `, [...dataBearingParams(), pageSize]);
    return result.rows;
}

// Pages whose sitemap entry changed in (since, until], for IndexNow: datasets by
// their record change and data-bearing resources by the date their sitemap
// entry carries.
async function listChangedSitemapPages({ since, until, limit }, db = pool) {
    const datasets = await db.query(`
        SELECT d.id, d.name FROM datasets d
        WHERE d.metadata_modified > $1 AND d.metadata_modified <= $2
        ORDER BY d.metadata_modified, d.id LIMIT $3
    `, [since, until, limit]);
    const resources = await db.query(`
        SELECT r.id FROM resources r JOIN datasets d ON d.id = r.dataset_id
        WHERE ${DATA_BEARING_RESOURCE}
          AND LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) > $5
          AND LEAST(COALESCE(r.last_modified, d.metadata_modified), now()) <= $6
        ORDER BY r.id LIMIT $7
    `, [...dataBearingParams(), since, until, limit]);
    return { datasets: datasets.rows, resources: resources.rows };
}

// The newest catalogue record change, for sitemap <lastmod> entries.
async function getCatalogLastModified(db = pool) {
    const result = await db.query('SELECT max(metadata_modified) AS modified FROM datasets');
    return result.rows[0].modified || null;
}

// The Top 100 leaderboard as plain links, so /insights has real content
// before JavaScript runs.
async function listTopDownloadLinks(db = pool) {
    const result = await db.query(`
        SELECT t.rank, t.dataset_id, d.name AS dataset_name, t.title_en, t.title_fr, t.downloads
        FROM top_downloads t
        LEFT JOIN datasets d ON d.id = t.dataset_id
        ORDER BY t.rank ASC
        LIMIT 100
    `);
    return result.rows;
}

async function listPlaceSitemap() {
    const result = await pool.query(`WITH RECURSIVE featured_ancestry AS (
        SELECT p.id AS selected_id, p.id AS ancestor_id, 0 AS depth
        FROM places p WHERE p.enabled AND p.featured
        UNION ALL
        SELECT ancestry.selected_id, parent.id, ancestry.depth + 1
        FROM featured_ancestry ancestry
        JOIN places current_place ON current_place.id = ancestry.ancestor_id
        JOIN places parent ON parent.id = current_place.parent_id
    ), place_datasets AS (
        SELECT dp.place_id, dp.dataset_id FROM dataset_places dp
        UNION
        SELECT ancestry.selected_id, dp.dataset_id
        FROM featured_ancestry ancestry
        JOIN dataset_places dp ON dp.place_id = ancestry.ancestor_id
        WHERE ancestry.depth = 0 OR dp.includes_descendants
    )
        SELECT p.slug, max(d.metadata_modified) AS metadata_modified
        FROM places p
        JOIN place_datasets pd ON pd.place_id = p.id
        JOIN datasets d ON d.id = pd.dataset_id
        WHERE p.enabled
        GROUP BY p.id ORDER BY p.slug
    `);
    return result.rows;
}

async function listOrganizationSitemap() {
    const result = await pool.query(`
        SELECT o.name, max(d.metadata_modified) AS metadata_modified
        FROM organizations o
        JOIN datasets d ON d.org_id = o.id
        GROUP BY o.id, o.name
        HAVING count(d.id) > 0
        ORDER BY o.name
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
        WITH completed AS (
            SELECT id, kind, source_id, finished_at, ok,
                   max(finished_at) FILTER (WHERE ok) OVER (
                       PARTITION BY kind, source_id
                   ) AS last_ok_at
            FROM sync_runs
            WHERE finished_at IS NOT NULL AND ok IS NOT NULL
        )
        SELECT DISTINCT ON (kind, source_id)
               kind, source_id, last_ok_at,
               finished_at AS latest_finished_at,
               ok AS latest_ok
        FROM completed
        ORDER BY kind, source_id, finished_at DESC, id DESC
    `);
    const evictResult = await pool.query(`
        SELECT max(finished_at) FILTER (WHERE ok) AS last_ok_at,
               (array_agg(finished_at ORDER BY finished_at DESC, id DESC))[1] AS latest_finished_at,
               (array_agg(ok ORDER BY finished_at DESC, id DESC))[1] AS latest_ok
        FROM ingest_runs
        WHERE finished_at IS NOT NULL AND ok IS NOT NULL AND error LIKE 'evict:%'
    `);
    const mapResult = await pool.query(`
        SELECT count(*) FILTER (WHERE j.status = 'pending')::int AS pending,
               count(*) FILTER (WHERE j.status = 'pending' AND j.next_attempt_at > now())::int AS deferred,
               count(*) FILTER (WHERE j.status = 'running')::int AS running,
               count(*) FILTER (WHERE j.status = 'ready')::int AS ready,
               count(*) FILTER (WHERE j.status = 'skipped')::int AS skipped,
               count(*) FILTER (WHERE j.status = 'failed')::int AS failed,
               count(DISTINCT r.raw->>'source_id') FILTER (
                   WHERE j.status = 'pending' AND j.failure_code = 'MAP_SOURCE_UNAVAILABLE'
               )::int AS retrying_sources,
               min(j.updated_at) FILTER (
                   WHERE j.status = 'pending' AND j.next_attempt_at <= now()
               ) AS oldest_pending_at,
               min(j.next_attempt_at) FILTER (
                   WHERE j.status = 'pending' AND j.next_attempt_at > now()
               ) AS next_retry_at,
               min(j.heartbeat_at) FILTER (WHERE j.status = 'running') AS oldest_running_at,
               max(j.finished_at) FILTER (WHERE j.status = 'ready') AS last_indexed_at
        FROM map_index_jobs j
        LEFT JOIN resources r ON r.id = j.resource_id
    `);
    const preparationResult = await pool.query(`
        SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
               count(*) FILTER (WHERE status = 'running')::int AS running,
               count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '24 hours')::int AS failed_last_day,
               count(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '24 hours')::int AS completed_last_day,
               min(created_at) FILTER (WHERE status = 'pending') AS oldest_pending_at
        FROM ingest_jobs WHERE preparation
    `);
    return {
        preparations: preparationResult.rows[0],
        syncRows: syncResult.rows,
        evictLastOkAt: evictResult.rows[0] ? evictResult.rows[0].last_ok_at : null,
        evictLatestFinishedAt: evictResult.rows[0] ? evictResult.rows[0].latest_finished_at : null,
        evictLatestOk: evictResult.rows[0] ? evictResult.rows[0].latest_ok : null,
        mapQueue: mapResult.rows[0]
    };
}

module.exports = {
    searchDatasets,
    getDatasetByIdOrName,
    listResourcesForDataset,
    getResourceById,
    getResourceMapById,
    listOrganizations,
    getOrganizationByName,
    listSources,
    listPlaces,
    getPlaceByIdOrSlug,
    getStats,
    countSitemapDatasets,
    listDatasetSitemap,
    countSitemapResources,
    listResourceSitemap,
    listNoindexResourceSitemap,
    listPlaceSitemap,
    listOrganizationSitemap,
    getCatalogLastModified,
    listDatasetSitemapChunkLastmods,
    listResourceSitemapChunkLastmods,
    listChangedSitemapPages,
    listTopDownloadLinks,
    pingDb,
    getLastSyncTime,
    listRecentlyIngested,
    getJobHealth
};
