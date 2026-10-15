const pool = require('./pool');
const { searchExpression } = require('../services/localSearch');
const { selectedPlaceCte, levelFromKinds, HAS_TABLE, HAS_MAP, match } = require('./catalogSqlFragments');

// Facet counts are shared and cached, so one slow combination must not hold a
// connection for long or compile JIT code on every miss.
const FACET_TIMEOUT_MS = 5000;
const FACET_WORK_MEM = '32MB';
const FACET_SQL_LIMITS = { organization: 500, source: 500, format: 40, keyword: 25 };
// A top-25 keyword list over most of the catalogue is generic, and unnesting
// every keyword is the costliest group. Broad searches list selected keywords only.
const KEYWORD_MAX_DATASETS = 25000;

// Counts for one group apply every active filter except that group's own, so
// a visitor can see what adding another value would match. Only active
// filters add conditions: always-true flags would distort row estimates, and
// PostgreSQL rejects parameters a statement never references.
function buildDatasetFacetQuery(filters, { keywordMaxDatasets = KEYWORD_MAX_DATASETS } = {}) {
    if (!Number.isSafeInteger(keywordMaxDatasets) || keywordMaxDatasets < 0) throw new TypeError('keywordMaxDatasets must be a non-negative integer');
    const values = [];
    const param = (value, type) => {
        values.push(value);
        return `$${values.length}::${type}`;
    };
    const lang = filters.lang === 'fr' ? 'fr' : 'en';
    const other = lang === 'fr' ? 'en' : 'fr';
    const ctes = [];
    const scope = [];
    const columns = [];
    const conditions = {};

    // Like the list query, text without search terms matches nothing.
    if (filters.q) scope.push(match.search(param(searchExpression(filters.q) || null, 'text')));
    if (filters.place) {
        ctes.push(selectedPlaceCte(param(filters.place, 'text')));
        scope.push(`d.id IN (
            SELECT dp.dataset_id FROM dataset_places dp JOIN selected_place sp ON sp.id = dp.place_id
            WHERE sp.depth = 0 OR dp.includes_descendants)`);
    }

    const org = filters.org && param(filters.org, 'text[]');
    const level = filters.level && param(filters.level, 'text[]');
    if (org) conditions.organization = (alias) => `${alias}.org_name = ANY(${org})`;
    if (filters.format) {
        columns.push(`${match.format(param(filters.format, 'text[]'))} AS m_format`);
        conditions.format = (alias) => `${alias}.m_format`;
    }
    if (filters.keyword) {
        const keywords = param(filters.keyword, 'text[]');
        columns.push(`ARRAY(SELECT k FROM unnest(${keywords}) AS k
               WHERE k = ANY(d.keywords_en) OR k = ANY(d.keywords_fr)) AS selected_keywords`);
        conditions.keyword = (alias) => `cardinality(${alias}.selected_keywords) > 0`;
    }
    if (filters.source) {
        columns.push(`${match.source(param(filters.source, 'text[]'))} AS m_source`);
        conditions.source = (alias) => `${alias}.m_source`;
    }
    if (level) conditions.level = (alias) => `${alias}.level = ANY(${level})`;
    if (filters.queryable) conditions.queryable = (alias) => `${alias}.has_table`;
    if (filters.mappable) conditions.mappable = (alias) => `${alias}.has_map`;

    const where = (except, alias = 'b') => {
        const active = Object.entries(conditions).filter(([name]) => name !== except).map(([, sql]) => sql(alias));
        return active.length ? active.join(' AND ') : 'true';
    };
    const extraColumns = columns.map(column => `,\n           ${column}`).join('');
    // A dataset failing two or more active filters counts nowhere: each group
    // drops only its own filter. With several filters, the base skips them.
    const active = Object.values(conditions);
    const pruned = active.length >= 2
        ? `\n    OFFSET 0) flagged\n    WHERE ${active.map(sql => `coalesce((${sql('flagged')})::int, 0)`).join(' + ')} >= ${active.length - 1}`
        : '';
    const selectedOrganizations = org ? `
UNION ALL
SELECT 'organization-label', o.name, 0, o.title_en, o.title_fr FROM organizations o WHERE o.name = ANY(${org})` : '';
    const selectedSources = filters.source ? `
UNION ALL
SELECT 'source-label', cs.id, 0, cs.name_en, cs.name_fr FROM catalog_sources cs WHERE cs.id = ANY(${param(filters.source, 'text[]')})` : '';
    const selectedFormats = filters.format ? `
UNION ALL
SELECT 'format', fc.format, fc.count, NULL, NULL FROM format_counts fc WHERE fc.format = ANY(${param(filters.format, 'text[]')})` : '';
    const selectedKeywords = filters.keyword ? `
UNION ALL
SELECT 'keyword-selected', k.value, count(*)::int, NULL, NULL
FROM base b CROSS JOIN LATERAL unnest(b.selected_keywords) AS k(value)
WHERE ${where('keyword')}
GROUP BY k.value` : '';

    const sql = `WITH ${ctes.length ? 'RECURSIVE ' + ctes.join(',\n') + ',\n' : ''}place_levels AS (
    SELECT dp.dataset_id, ${levelFromKinds('p.kind')} AS level
    FROM dataset_places dp JOIN places p ON p.id = dp.place_id
    WHERE dp.relationship = 'direct'
    GROUP BY dp.dataset_id
), base AS MATERIALIZED (${pruned ? '\n    SELECT * FROM (' : ''}
    SELECT d.id, o.name AS org_name,
           coalesce(d.jurisdiction, pl.level) AS level,
           ${HAS_TABLE} AS has_table,
           ${HAS_MAP} AS has_map,
           CASE WHEN cardinality(d.keywords_${lang}) > 0 THEN d.keywords_${lang} ELSE d.keywords_${other} END AS keywords${extraColumns}
    FROM datasets d
    LEFT JOIN organizations o ON o.id = d.org_id
    LEFT JOIN place_levels pl ON pl.dataset_id = d.id
    WHERE ${scope.length ? scope.join('\n      AND ') : 'true'}${pruned}
), format_counts AS (
    SELECT f.format, count(*)::int AS count
    FROM (SELECT DISTINCT r.dataset_id, r.format
          FROM base b JOIN resources r ON r.dataset_id = b.id
          WHERE r.format IS NOT NULL AND ${where('format')}) f
    GROUP BY f.format
)
SELECT 'total'::text AS facet, NULL::text AS value, count(*)::int AS count, NULL::text AS label_en, NULL::text AS label_fr
FROM base b WHERE ${where()}
UNION ALL
SELECT 'level', b.level, count(*)::int, NULL, NULL FROM base b
WHERE b.level IS NOT NULL AND ${where('level')}
GROUP BY b.level
UNION ALL
SELECT 'access', 'queryable', count(*)::int, NULL, NULL FROM base b WHERE b.has_table AND ${where('queryable')}
UNION ALL
SELECT 'access', 'mappable', count(*)::int, NULL, NULL FROM base b WHERE b.has_map AND ${where('mappable')}
UNION ALL
(SELECT 'organization', o.name, c.count, o.title_en, o.title_fr
 FROM (SELECT b.org_name, count(*)::int AS count FROM base b
       WHERE b.org_name IS NOT NULL AND ${where('organization')} GROUP BY b.org_name) c
 JOIN organizations o ON o.name = c.org_name
 ORDER BY c.count DESC, o.name LIMIT ${FACET_SQL_LIMITS.organization})
UNION ALL
(SELECT 'source', cs.id, c.count, cs.name_en, cs.name_fr
 FROM (SELECT m.source_id, count(*)::int AS count
       FROM (SELECT DISTINCT ds.source_id, ds.dataset_id
             FROM base b JOIN dataset_sources ds ON ds.dataset_id = b.id
             WHERE ${where('source')}) m
       GROUP BY m.source_id) c
 JOIN catalog_sources cs ON cs.id = c.source_id AND cs.enabled
 ORDER BY c.count DESC, cs.id LIMIT ${FACET_SQL_LIMITS.source})
UNION ALL
(SELECT 'format', fc.format, fc.count, NULL, NULL FROM format_counts fc
 ORDER BY fc.count DESC, fc.format LIMIT ${FACET_SQL_LIMITS.format})
UNION ALL
(SELECT 'keyword', k.value, count(*)::int, NULL, NULL
 FROM base b CROSS JOIN LATERAL unnest(b.keywords) WITH ORDINALITY AS k(value, n)
 WHERE (SELECT count(*) FROM base kb WHERE ${where('keyword', 'kb')}) <= ${keywordMaxDatasets}
   AND k.value <> '' AND array_position(b.keywords, k.value) = k.n AND ${where('keyword')}
 GROUP BY k.value
 ORDER BY count(*) DESC, k.value COLLATE "C" LIMIT ${FACET_SQL_LIMITS.keyword})${selectedFormats}${selectedKeywords}${selectedOrganizations}${selectedSources}`;
    return { sql, values };
}

async function readDatasetFacets(filters, db = pool, options = {}) {
    const { sql, values } = buildDatasetFacetQuery(filters, options);
    // Integration tests pass their own transaction; it must see its fixtures.
    if (db !== pool) return (await db.query(sql, values)).rows;
    const client = await pool.connect();
    let discard = false;
    try {
        await client.query(`BEGIN READ ONLY; SET LOCAL statement_timeout = ${FACET_TIMEOUT_MS}; SET LOCAL jit = off; SET LOCAL work_mem = '${FACET_WORK_MEM}'`);
        const { rows } = await client.query(sql, values);
        await client.query('COMMIT');
        return rows;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            discard = true;
        }
        throw error;
    } finally {
        client.release(discard);
    }
}

module.exports = { buildDatasetFacetQuery, readDatasetFacets, FACET_TIMEOUT_MS, FACET_SQL_LIMITS, KEYWORD_MAX_DATASETS };
