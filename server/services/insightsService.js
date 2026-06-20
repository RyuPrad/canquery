const topDownloadsQueries = require('../db/topDownloadsQueries');
const { profileStoreTable, aggregateStoreTable } = require('../db/storeQueries');
const { pickChartSpec } = require('./featuredChart');
const { createCache } = require('../utils/cache');

const toNumberOrNull = (v) => (v === null || v === undefined ? null : Number(v));

// The curated Top 100 leaderboard: ranked datasets with their download history
// and the live ingest status of the representative resource the UI charts.
const topDownloads = async (lang = 'en') => {
    const rows = await topDownloadsQueries.listTopDownloads(lang);
    const items = rows.map((r) => ({
        rank: r.rank,
        dataset_id: r.dataset_id,
        title: { en: r.title_en, fr: r.title_fr },
        department: r.department,
        ministere: r.ministere,
        downloads: Number(r.downloads),
        history: Array.isArray(r.history) ? r.history : [],
        resource_id: r.resource_id || null,
        ingest_status: r.ingest_status || null,
        row_count: toNumberOrNull(r.ingested_row_count)
    }));
    const period = items.length
        ? { year: rows[0].period_year, month: rows[0].period_month }
        : null;
    return { period, items };
};

// --- Featured hero charts -------------------------------------------------
// Compact chart specs for the landing-page hero teasers: the top ingested
// datasets, each reduced to one chart (kind + a handful of points) so the
// landing page can animate them in plain SVG without loading Recharts. The
// whole payload is cached, so the per-dataset profile/aggregate runs rarely.

const featuredCache = createCache({ name: 'insights-featured', ttlMs: 10 * 60 * 1000, negativeTtlMs: 60 * 1000 });

function cleanLabel(key, bucket) {
    if (key === null || key === undefined || key === '') return null;
    if (bucket) {
        const d = new Date(key);
        if (!Number.isNaN(d.getTime())) return bucket === 'year' ? String(d.getUTCFullYear()) : d.toISOString().slice(0, 7);
    }
    const s = String(key);
    return s.length > 24 ? s.slice(0, 23) + '…' : s;
}

// How many top ingested datasets to consider, and how many chart specs to keep.
// Shared by the landing-hero teasers and the /insights "Featured" carousel.
const FEATURED_SCAN = 24;
const FEATURED_LIMIT = 12;

async function computeFeatured(lang) {
    const candidates = await topDownloadsQueries.listIngestedTop(FEATURED_SCAN, lang);
    const out = [];
    for (const c of candidates) {
        if (out.length >= FEATURED_LIMIT) break;
        try {
            const columns = Array.isArray(c.columns) ? c.columns : [];
            const profile = await profileStoreTable({ tableName: c.table_name, columns });
            const spec = pickChartSpec({ row_count: profile.rowCount, columns: profile.columns });
            if (!spec) continue;
            const agg = await aggregateStoreTable({
                tableName: c.table_name,
                knownColumns: columns.map((x) => x.id),
                q: undefined, filters: [],
                groupBy: spec.groupBy, agg: spec.agg, aggColumn: spec.aggColumn || null, bucket: spec.bucket || null,
                sortSql: spec.sort === 'value' ? '"value" DESC' : '"key" ASC',
                limit: spec.limit, offset: 0
            });
            const points = (agg.records || [])
                .map((r) => ({ label: cleanLabel(r.key, spec.bucket), value: Number(r.value) }))
                .filter((p) => p.label !== null && Number.isFinite(p.value));
            if (points.length < 2) continue;
            out.push({
                dataset_id: c.dataset_id,
                title: { en: c.title_en, fr: c.title_fr },
                kind: spec.kind,
                points
            });
        } catch {
            // A dataset that fails to profile/aggregate is simply skipped.
        }
    }
    return out;
}

const featured = async (lang = 'en') => featuredCache.get('featured:' + lang, () => computeFeatured(lang));

module.exports = { topDownloads, featured };
