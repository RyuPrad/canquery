// Shared dataset search conditions. The paged list and the facet counts are
// built from these fragments, so meta.total always describes the same records
// a client can page through. Fragments receive positional parameter text
// ($n) from their caller and never interpolate request values.

const LEVELS = ['federal', 'provincial', 'municipal'];

// Request lists are deduplicated and sorted, so equivalent searches share one
// cache entry. Scalars are accepted for existing callers.
function listParam(value, transform = item => item) {
    const items = (Array.isArray(value) ? value : [value])
        .filter(item => typeof item === 'string')
        .map(item => transform(item.trim()))
        .filter(Boolean);
    return items.length ? Array.from(new Set(items)).sort() : null;
}

const upper = value => value.toUpperCase();

function selectedPlaceCte(param) {
    return `selected_place AS (
    SELECT p.id, p.parent_id, 0 AS depth
    FROM places p
    WHERE ${param}::text IS NOT NULL
      AND (p.id = ${param} OR p.slug = ${param} OR EXISTS (
          SELECT 1 FROM place_aliases pa WHERE pa.place_id = p.id AND pa.slug = ${param}
      ))
    UNION ALL
    SELECT parent.id, parent.parent_id, selected_place.depth + 1
    FROM places parent
    JOIN selected_place ON selected_place.parent_id = parent.id
)`;
}

// Federal records declare their jurisdiction. Other sources are placed by the
// kind of their direct place: a provincial or territorial portal, or a
// regional or municipal one.
function levelFromKinds(kind) {
    return `CASE WHEN bool_or(${kind} IN ('province', 'territory')) THEN 'provincial'
        WHEN bool_or(${kind} IN ('region', 'municipality')) THEN 'municipal'
        WHEN bool_or(${kind} = 'country') THEN 'federal' END`;
}

const DATASET_LEVEL = `coalesce(d.jurisdiction, (
    SELECT ${levelFromKinds('lp.kind')}
    FROM dataset_places ldp JOIN places lp ON lp.id = ldp.place_id
    WHERE ldp.dataset_id = d.id AND ldp.relationship = 'direct'))`;

// Same definition as queryable_count: a live DataStore table or a ready
// prepared copy. Uncorrelated sets are hashed once per statement.
const HAS_TABLE = `d.id IN (
    SELECT rq.dataset_id FROM resources rq WHERE rq.datastore_active
    UNION
    SELECT ri.dataset_id FROM ingested_resources iq JOIN resources ri ON ri.id = iq.resource_id
    WHERE iq.status = 'ready')`;

const HAS_MAP = `d.id IN (
    SELECT r3.dataset_id FROM resource_maps rm3 JOIN resources r3 ON r3.id = rm3.resource_id)`;

const match = {
    search: expression => `d.search_tsv @@ (to_tsquery('english', ${expression}) || to_tsquery('french', ${expression}))`,
    org: param => `o.name = ANY(${param}::text[])`,
    format: param => `EXISTS (
               SELECT 1 FROM resources r2
               WHERE r2.dataset_id = d.id AND r2.format = ANY(${param}::text[]))`,
    keyword: param => `(d.keywords_en && ${param}::text[] OR d.keywords_fr && ${param}::text[])`,
    source: param => `EXISTS (
               SELECT 1 FROM dataset_sources ds2 WHERE ds2.dataset_id = d.id AND ds2.source_id = ANY(${param}::text[]))`,
    level: param => `${DATASET_LEVEL} = ANY(${param}::text[])`
};

module.exports = { LEVELS, listParam, upper, selectedPlaceCte, levelFromKinds, DATASET_LEVEL, HAS_TABLE, HAS_MAP, match };
