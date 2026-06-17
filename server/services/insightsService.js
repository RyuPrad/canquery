const topDownloadsQueries = require('../db/topDownloadsQueries');

const toNumberOrNull = (v) => (v === null || v === undefined ? null : Number(v));

// The curated Top 100 leaderboard: ranked datasets with their download history
// and the live ingest status of the representative resource the UI charts.
const topDownloads = async () => {
    const rows = await topDownloadsQueries.listTopDownloads();
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

module.exports = { topDownloads };
