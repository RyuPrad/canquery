const topDownloadsQueries = require('../db/topDownloadsQueries');
const { withSnapshot } = require('../db/snapshotRead');
const { getResourceById } = require('../db/catalogReadQueries');
const chartEngine = require('./charts/chartEngine');
const { toFeaturedPreview } = require('./charts/legacyPreview');
const { createCache } = require('../utils/cache');
const { startWarming } = require('../utils/warming');

const toNumberOrNull = (v) => (v === null || v === undefined ? null : Number(v));

// The curated Top 100 leaderboard: ranked datasets with their download history
// and the live ingest status of the representative resource the UI charts.
const topDownloads = async (lang = 'en') => {
    const rows = await topDownloadsQueries.listTopDownloads(lang);
    const items = rows.map((r) => ({
        rank: r.rank,
        dataset_id: r.dataset_id,
        // The canonical slug, so links land on /datasets/<name> without a redirect.
        dataset_name: r.dataset_name || null,
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

// --- Featured charts ------------------------------------------------------
// Charts of prepared Top 100 tables from the chart engine: the website's cards,
// and the public previews in their published shape. Every figure describes the
// whole snapshot. The whole payload is cached per language, and the engine
// keeps each table's charts for a day.

const FEATURED_TTL_MS = 10 * 60 * 1000;
const featuredCache = createCache({ name: 'insights-featured', ttlMs: FEATURED_TTL_MS, negativeTtlMs: 60 * 1000 });
const LABEL_LIMIT = 200;
const DATE_TYPE_RE = /date|time/i;
const PLACEHOLDER_RE = /^(?:[-_.…]+|n\/?a|n\.a\.|null|undefined|unknown|inconnu|not applicable|sans objet|non applicable)$/i;
const FOOTNOTE_RE = /^(?:for (?:further|more) information|pour (?:plus|de plus amples) (?:de |d[’'])?(?:informations?|renseignements)|notes?\s*[:：]|sources?\s*[:：]|footnotes?\b|notes? de bas de page|see (?:note|table)|voir (?:la |les )?(?:note|tableau))/i;
const NUMERIC_LABEL_RE = /^[+-]?\d+(?:[.,]\d+)?$/;
const cleanText = value => String(value).trim().replace(/\s+/g, ' ');

function snapshotAt(value) {
    if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function temporalKey(value, type) {
    if (value === null || value === undefined || cleanText(value) === '') return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : false;
    const text = cleanText(value);
    if (!DATE_TYPE_RE.test(type) && /^\d{4}$/.test(text) && Number(text) >= 1700 && Number(text) <= 2200) return text;
    if (!/^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(text)) return false;
    // Validate the calendar day independently of an optional time-zone offset.
    const day = text.slice(0, 10);
    const dayDate = new Date(day + 'T00:00:00.000Z');
    if (!Number.isFinite(dayDate.getTime()) || dayDate.toISOString().slice(0, 10) !== day) return false;
    const date = new Date(text);
    if (!Number.isFinite(date.getTime())) return false;
    return date.toISOString();
}

function metricValue(value) {
    if (value === null || value === undefined || typeof value === 'string' && value.trim() === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

// Pure output builder also powers faithful local browser fixtures. It never
// queries a table, renews a snapshot, or admits preparation work.
function buildFeaturedPreview({ candidate, current, profile, spec, aggregate, lang = 'en' }) {
    if (!spec || !['donut', 'bars', 'line'].includes(spec.kind) || !['count', 'avg'].includes(spec.agg)) return null;
    const group = profile.columns.find(column => column.id === spec.groupBy);
    const preparedAt = snapshotAt(current.ingested_at);
    const snapshotRows = Number(profile.rowCount);
    const totalGroups = Number(aggregate.total);
    const records = aggregate.records || [];
    if (!group || !preparedAt || !Number.isSafeInteger(snapshotRows) || snapshotRows < 1 ||
        !Number.isSafeInteger(totalGroups) || totalGroups < records.length) return null;

    const points = [];
    const missingPeriods = [];
    let kind = spec.kind;
    if (kind === 'line') {
        for (const record of records.slice(0, 30)) {
            const key = temporalKey(record.key, group.type);
            if (key === false) return null;
            if (key === null) continue;
            const value = metricValue(record.value);
            if (value === null) {
                missingPeriods.push(key);
                continue;
            }
            const label = /^\d{4}$/.test(key) ? key : key.slice(0, spec.bucket === 'year' ? 4 : spec.bucket === 'month' ? 7 : 10);
            points.push({ key, label, value });
        }
        points.sort((a, b) => a.key.localeCompare(b.key));
        missingPeriods.sort();
    } else {
        if (spec.agg !== 'count') return null;
        for (const record of records.slice(0, kind === 'donut' ? 7 : 5)) {
            const key = record.key === null || record.key === undefined ? null : String(record.key);
            const label = key === null ? (lang === 'fr' ? 'Non renseigné' : 'Not recorded') : cleanText(key);
            const value = metricValue(record.value);
            if (!label || label.length > LABEL_LIMIT || PLACEHOLDER_RE.test(label) || FOOTNOTE_RE.test(label) ||
                key !== null && label.toLowerCase() === cleanText(spec.groupBy).toLowerCase() || value === null) return null;
            points.push({ key, label, value });
        }
        const namedPoints = points.filter(point => point.key !== null);
        if (!namedPoints.length || namedPoints.some(point => NUMERIC_LABEL_RE.test(point.label)) ||
            new Set(points.map(point => point.label.toLowerCase())).size !== points.length) return null;
        if (kind === 'donut' && (points.length > 6 || totalGroups !== points.length)) {
            kind = 'bars';
            points.splice(5);
        }
    }
    if (points.length < 2 || new Set(points.map(point => point.value)).size < 2) return null;
    if (new Set(points.map(point => point.key)).size !== points.length) return null;
    if (spec.agg === 'count') {
        const representedRows = points.reduce((sum, point) => sum + point.value, 0);
        if (points.some(point => !Number.isSafeInteger(point.value) || point.value < 1) || representedRows > snapshotRows ||
            totalGroups === points.length && representedRows !== snapshotRows) return null;
    }

    return {
        dataset_id: candidate.dataset_id,
        title: { en: candidate.title_en, fr: candidate.title_fr },
        kind,
        points,
        context: {
            resource_id: candidate.resource_id,
            group_by: spec.groupBy,
            agg: spec.agg,
            agg_column: spec.aggColumn || null,
            bucket: spec.bucket || null,
            group_type: group.type,
            snapshot_at: preparedAt,
            snapshot_rows: snapshotRows,
            total_groups: totalGroups,
            displayed_groups: points.length,
            limited: totalGroups > points.length,
            missing_periods: missingPeriods
        }
    };
}

// How many top prepared datasets to consider, and how many charts to keep.
// Shared by the homepage cards, the Insights gallery and the public previews.
const FEATURED_SCAN = 24;
const FEATURED_LIMIT = 12;
// The engine's charts of one table, as many as the Chart tab could show: the
// cards take the best one that suits a card, the public previews the first one
// their shape can say.
const ANALYSIS_LIMIT = 12;
// Warming waits longer for a scan slot than a visitor would.
const WARM_WAIT_MS = 30 * 1000;

const COLD = Symbol('cold');

// The charts of one candidate's current snapshot. A scan slot is taken before
// the reader lock, as for a visitor, so waiting never holds a connection.
//
// The work belongs to no visitor. A request that happens to start it (a cold
// cache) must not cut it short with its own deadline or departure, so no
// abort signal is passed: otherwise the shortened result would be cached for
// everyone.
async function analyzeCandidate(candidate, lang) {
    const options = { lang, limit: ANALYSIS_LIMIT };
    // A table replaced or evicted between the first look and the lock needs a
    // scan after all: then the lock is let go, a slot taken, and the lock taken again.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const first = await getResourceById(candidate.resource_id);
        if (!first || first.ingest_status !== 'ready' || !first.table_name) return null;
        const permit = attempt === 0 && chartEngine.isWarm(chartEngine.describeTable(first), options)
            ? null : await chartEngine.acquireSlot({ waitMs: WARM_WAIT_MS, signal: null });
        try {
            const read = await withSnapshot(candidate.resource_id, async () => {
                // The table may have been replaced or evicted since: read it again under the lock.
                const current = await getResourceById(candidate.resource_id);
                if (!current || current.ingest_status !== 'ready' || !current.table_name) return null;
                const preparedAt = snapshotAt(current.ingested_at);
                if (!preparedAt) return null;
                const table = chartEngine.describeTable(current);
                if (!permit && !chartEngine.isWarm(table, options)) return COLD;
                const analysis = await chartEngine.analyzeSnapshot(table,
                    { ...options, permit: permit || undefined, waitMs: WARM_WAIT_MS, signal: null });
                return { analysis, preparedAt };
            });
            if (read !== COLD) return read;
        } finally {
            if (permit) permit();
        }
    }
    return null;
}

async function computeFeatured(lang) {
    const candidates = await topDownloadsQueries.listIngestedTop(FEATURED_SCAN, lang);
    const cards = [];
    const previews = [];
    for (const c of candidates) {
        if (cards.length >= FEATURED_LIMIT && previews.length >= FEATURED_LIMIT) break;
        let read;
        try {
            read = await analyzeCandidate(c, lang);
        } catch {
            // A dataset that cannot be charted now is simply skipped.
            continue;
        }
        if (!read) continue;
        const { analysis, preparedAt } = read;
        const title = { en: c.title_en, fr: c.title_fr };
        const card = analysis.charts.find(chart => chart.fit.card);
        if (card && cards.length < FEATURED_LIMIT) {
            cards.push({ dataset_id: c.dataset_id, title, resource_id: c.resource_id, snapshot_at: preparedAt, rows: analysis.scope.table_rows,
                kpis: analysis.kpis.slice(0, 3), chart: card });
        }
        if (previews.length < FEATURED_LIMIT) {
            for (const chart of analysis.charts) {
                const preview = toFeaturedPreview({ candidate: c, chart, model: analysis.model, snapshotAt: preparedAt, lang });
                if (preview) {
                    previews.push(preview);
                    break;
                }
            }
        }
    }
    return { cards, previews };
}

const featuredKey = lang => 'featured:' + lang;
const computed = async (lang = 'en') => featuredCache.get(featuredKey(lang), () => computeFeatured(lang));
// The public previews (GET /insights/featured), in their published shape.
const featured = async (lang = 'en') => (await computed(lang)).previews;
// The website's chart cards (GET /web-api/v1/insights/charts): engine charts, whole.
const cards = async (lang = 'en') => (await computed(lang)).cards;

// Charting two dozen tables from cold takes a while. The API builds them as
// soon as it starts and refreshes them before they expire, so no visitor waits
// for that work: a refresh keeps serving the previous charts until the new ones
// are ready, and the engine keeps each table's charts for a day.
const FEATURED_WARM_INTERVAL_MS = 8 * 60 * 1000;

// Never throws: the previews are optional for the warming loop.
async function refreshFeatured(lang = 'en') {
    try {
        return (await featuredCache.refresh(featuredKey(lang), () => computeFeatured(lang))).previews;
    } catch {
        console.warn('[insights-featured] refresh failed');
        return null;
    }
}

function startFeaturedWarming({ intervalMs = FEATURED_WARM_INTERVAL_MS } = {}) {
    return startWarming('insights-featured', ['en', 'fr'].map(lang => () => refreshFeatured(lang)), { intervalMs });
}

// analyzeCandidate: the hosted social pool charts its tables the way the cards do.
module.exports = { topDownloads, featured, cards, analyzeCandidate, refreshFeatured, startFeaturedWarming, buildFeaturedPreview, FEATURED_WARM_INTERVAL_MS };
