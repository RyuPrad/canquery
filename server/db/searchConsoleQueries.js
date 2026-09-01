const pool = require('./pool');

async function latestSearchConsoleDate(db = pool) {
    const result = await db.query("SELECT max(data_date)::text AS data_date FROM search_console_daily WHERE search_type = 'web'");
    return result.rows[0]?.data_date || null;
}

async function insertBreakdowns(client, day) {
    const size = 500;
    for (let offset = 0; offset < day.breakdowns.length; offset += size) {
        const chunk = day.breakdowns.slice(offset, offset + size);
        const values = [];
        const tuples = chunk.map((row, index) => {
            const p = index * 8 + 1;
            values.push(
                day.dataDate, day.searchType, row.dimension, row.value,
                row.clicks, row.impressions, row.ctr, row.position
            );
            return `($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7})`;
        });
        await client.query(`
            INSERT INTO search_console_breakdowns (
                data_date, search_type, dimension, value,
                clicks, impressions, ctr, position
            ) VALUES ${tuples.join(',')}
            ON CONFLICT (data_date, search_type, dimension, value) DO UPDATE SET
                clicks = EXCLUDED.clicks,
                impressions = EXCLUDED.impressions,
                ctr = EXCLUDED.ctr,
                position = EXCLUDED.position,
                synced_at = now()
        `, values);
    }
}

async function insertQueryPages(client, day) {
    const rows = day.queryPages || [];
    const size = 500;
    for (let offset = 0; offset < rows.length; offset += size) {
        const chunk = rows.slice(offset, offset + size);
        const values = [];
        const tuples = chunk.map((row, index) => {
            const p = index * 8 + 1;
            values.push(
                day.dataDate, day.searchType, row.query, row.page,
                row.clicks, row.impressions, row.ctr, row.position
            );
            return `($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7})`;
        });
        await client.query(`
            INSERT INTO search_console_query_pages (
                data_date, search_type, query_text, page_url,
                clicks, impressions, ctr, position
            ) VALUES ${tuples.join(',')}
            ON CONFLICT (data_date, search_type, query_text, page_url) DO UPDATE SET
                clicks = EXCLUDED.clicks,
                impressions = EXCLUDED.impressions,
                ctr = EXCLUDED.ctr,
                position = EXCLUDED.position,
                synced_at = now()
        `, values);
    }
}

async function replaceSearchConsoleDay(day, db = pool) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            INSERT INTO search_console_daily (
                data_date, search_type, clicks, impressions, ctr, position
            ) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (data_date, search_type) DO UPDATE SET
                clicks = EXCLUDED.clicks,
                impressions = EXCLUDED.impressions,
                ctr = EXCLUDED.ctr,
                position = EXCLUDED.position,
                synced_at = now()
        `, [
            day.dataDate, day.searchType, day.total.clicks, day.total.impressions,
            day.total.ctr, day.total.position
        ]);
        await client.query(
            'DELETE FROM search_console_breakdowns WHERE data_date = $1 AND search_type = $2',
            [day.dataDate, day.searchType]
        );
        await insertBreakdowns(client, day);
        await client.query(
            'DELETE FROM search_console_query_pages WHERE data_date = $1 AND search_type = $2',
            [day.dataDate, day.searchType]
        );
        await insertQueryPages(client, day);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function aggregateBreakdown(db, dimension, { zeroClick = false, limit = 25 } = {}) {
    const result = await db.query(`
        WITH latest AS (
            SELECT max(data_date) AS d FROM search_console_daily WHERE search_type = 'web'
        )
        SELECT value,
               sum(clicks)::float8 AS clicks,
               sum(impressions)::float8 AS impressions,
               CASE WHEN sum(impressions) = 0 THEN 0 ELSE sum(clicks) / sum(impressions) END::float8 AS ctr,
               CASE WHEN sum(impressions) = 0 THEN 0
                    ELSE sum(position * impressions) / sum(impressions) END::float8 AS position
        FROM search_console_breakdowns, latest
        WHERE search_type = 'web' AND dimension = $1
          AND data_date BETWEEN latest.d - 27 AND latest.d
        GROUP BY value
        ${zeroClick ? 'HAVING sum(clicks) = 0 AND sum(impressions) > 0' : ''}
        ORDER BY ${zeroClick ? 'impressions' : 'clicks'} DESC, impressions DESC, value
        LIMIT $2
    `, [dimension, limit]);
    return result.rows;
}

async function getSearchGrowthReportData(db = pool) {
    const latestResult = await db.query(`
        SELECT max(data_date)::text AS latest_date, max(synced_at) AS last_synced_at
        FROM search_console_daily WHERE search_type = 'web'
    `);
    const latestDate = latestResult.rows[0]?.latest_date || null;
    if (!latestDate) {
        return {
            latestDate: null, lastSyncedAt: null, daily: [], summary: null,
            topQueries: [], topPages: [], zeroClickQueries: [], pageOpportunities: [],
            queryPageOpportunities: [], countries: [], devices: [], routes: []
        };
    }
    const [
        dailyResult, summaryResult, topQueries, topPages, zeroClickQueries,
        pageOpportunitiesResult, queryPageOpportunitiesResult,
        countries, devices, routesResult
    ] = await Promise.all([
        db.query(`
            SELECT data_date::text, clicks, impressions, ctr, position
            FROM search_console_daily
            WHERE search_type = 'web' AND data_date >= $1::date - 89
            ORDER BY data_date
        `, [latestDate]),
        db.query(`
            SELECT
                coalesce(sum(clicks) FILTER (WHERE data_date BETWEEN $1::date - 27 AND $1::date), 0)::float8 AS current_clicks,
                coalesce(sum(impressions) FILTER (WHERE data_date BETWEEN $1::date - 27 AND $1::date), 0)::float8 AS current_impressions,
                coalesce(sum(clicks) FILTER (WHERE data_date BETWEEN $1::date - 55 AND $1::date - 28), 0)::float8 AS prior_clicks,
                coalesce(sum(impressions) FILTER (WHERE data_date BETWEEN $1::date - 55 AND $1::date - 28), 0)::float8 AS prior_impressions,
                coalesce(sum(position * impressions) FILTER (WHERE data_date BETWEEN $1::date - 27 AND $1::date) /
                    nullif(sum(impressions) FILTER (WHERE data_date BETWEEN $1::date - 27 AND $1::date), 0), 0)::float8 AS current_position,
                coalesce(sum(position * impressions) FILTER (WHERE data_date BETWEEN $1::date - 55 AND $1::date - 28) /
                    nullif(sum(impressions) FILTER (WHERE data_date BETWEEN $1::date - 55 AND $1::date - 28), 0), 0)::float8 AS prior_position
            FROM search_console_daily WHERE search_type = 'web'
        `, [latestDate]),
        aggregateBreakdown(db, 'query'),
        aggregateBreakdown(db, 'page'),
        aggregateBreakdown(db, 'query', { zeroClick: true }),
        db.query(`
            WITH latest AS (SELECT $1::date AS d)
            SELECT value,
                   sum(clicks)::float8 AS clicks,
                   sum(impressions)::float8 AS impressions,
                   CASE WHEN sum(impressions) = 0 THEN 0
                        ELSE sum(clicks) / sum(impressions) END::float8 AS ctr,
                   CASE WHEN sum(impressions) = 0 THEN 0
                        ELSE sum(position * impressions) / sum(impressions) END::float8 AS position
            FROM search_console_breakdowns, latest
            WHERE search_type = 'web' AND dimension = 'page'
              AND data_date BETWEEN latest.d - 27 AND latest.d
              AND (value ~ '/datasets/[^/?#]+' OR value ~ '/resources/[^/?#]+')
            GROUP BY value
            HAVING sum(impressions) >= 50
               AND CASE WHEN sum(impressions) = 0 THEN 0
                        ELSE sum(clicks) / sum(impressions) END < 0.01
            ORDER BY impressions DESC, clicks, value
            LIMIT 50
        `, [latestDate]),
        db.query(`
            WITH latest AS (SELECT $1::date AS d)
            SELECT query_text AS query, page_url AS page,
                   sum(clicks)::float8 AS clicks,
                   sum(impressions)::float8 AS impressions,
                   CASE WHEN sum(impressions) = 0 THEN 0
                        ELSE sum(clicks) / sum(impressions) END::float8 AS ctr,
                   CASE WHEN sum(impressions) = 0 THEN 0
                        ELSE sum(position * impressions) / sum(impressions) END::float8 AS position
            FROM search_console_query_pages, latest
            WHERE search_type = 'web'
              AND data_date BETWEEN latest.d - 27 AND latest.d
            GROUP BY query_text, page_url
            HAVING sum(impressions) >= 5
               AND sum(position * impressions) / nullif(sum(impressions), 0) BETWEEN 1 AND 20
               AND sum(clicks) / nullif(sum(impressions), 0) < 0.01
            ORDER BY impressions DESC, clicks, query_text, page_url
            LIMIT 100
        `, [latestDate]),
        aggregateBreakdown(db, 'country', { limit: 15 }),
        aggregateBreakdown(db, 'device', { limit: 10 }),
        db.query(`
            WITH latest AS (SELECT $1::date AS d), page_totals AS (
                SELECT CASE
                    WHEN scb.value ~ '/places/[^/?#]+' THEN 'Place pages'
                    WHEN scb.value ~ '/datasets/[^/?#]+' THEN 'Dataset pages'
                    WHEN scb.value ~ '/resources/[^/?#]+' THEN 'Resource pages'
                    WHEN scb.value ~ '/insights/?([?#].*)?$' THEN 'Insights'
                    ELSE 'Other pages' END AS family,
                    scb.value AS page,
                    sum(scb.clicks)::float8 AS clicks,
                    sum(scb.impressions)::float8 AS impressions,
                    sum(scb.position * scb.impressions)::float8 AS position_weight
                FROM search_console_breakdowns scb, latest
                WHERE scb.search_type = 'web' AND scb.dimension = 'page'
                  AND scb.data_date BETWEEN latest.d - 27 AND latest.d
                GROUP BY 1, scb.value
            )
            SELECT family AS value,
                   count(*)::int AS pages_with_impressions,
                   count(*) FILTER (WHERE clicks > 0)::int AS pages_with_clicks,
                   sum(clicks)::float8 AS clicks,
                   sum(impressions)::float8 AS impressions,
                   CASE WHEN sum(impressions) = 0 THEN 0 ELSE sum(clicks) / sum(impressions) END::float8 AS ctr,
                   CASE WHEN sum(impressions) = 0 THEN 0 ELSE sum(position_weight) / sum(impressions) END::float8 AS position
            FROM page_totals GROUP BY family ORDER BY impressions DESC, clicks DESC
        `, [latestDate])
    ]);
    const summary = summaryResult.rows[0];
    summary.current_ctr = summary.current_impressions ? summary.current_clicks / summary.current_impressions : 0;
    summary.prior_ctr = summary.prior_impressions ? summary.prior_clicks / summary.prior_impressions : 0;
    return {
        latestDate,
        lastSyncedAt: latestResult.rows[0].last_synced_at,
        daily: dailyResult.rows,
        summary,
        topQueries,
        topPages,
        zeroClickQueries,
        pageOpportunities: pageOpportunitiesResult.rows,
        queryPageOpportunities: queryPageOpportunitiesResult.rows,
        countries,
        devices,
        routes: routesResult.rows
    };
}

module.exports = {
    latestSearchConsoleDate,
    insertBreakdowns,
    insertQueryPages,
    replaceSearchConsoleDay,
    aggregateBreakdown,
    getSearchGrowthReportData
};
