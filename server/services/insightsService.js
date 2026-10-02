const topDownloadsQueries = require('../db/topDownloadsQueries');
const { withSnapshot } = require('../db/snapshotRead');
const { getResourceById } = require('../db/catalogReadQueries');
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
// Bounded previews of prepared Top 100 resources. The aggregate describes the
// whole snapshot; context discloses the grouping, measure and displayed groups.
// Reject ambiguous or uninformative candidates rather than inventing context.
// The whole payload is cached, so per-dataset profile/aggregate runs rarely.

const featuredCache = createCache({ name: 'insights-featured', ttlMs: 10 * 60 * 1000, negativeTtlMs: 60 * 1000 });
// Tables are immutable between publications. Retain the language-independent
// work across response-cache refreshes; a new table/version/schema gets a new
// key. Final labels and candidate titles are still built for each language.
const featuredSnapshotCache = createCache({
    name: 'featured-snapshots', ttlMs: 24 * 60 * 60 * 1000, negativeTtlMs: 0,
    maxEntries: 128,
    cacheable: value => value != null && Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024
});

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
            await withSnapshot(c.resource_id, async () => {
                const current = await getResourceById(c.resource_id);
                if (!current || current.ingest_status !== 'ready') return;
                const columns = Array.isArray(current.ingested_columns) ? current.ingested_columns : [];
                const preparedAt = snapshotAt(current.ingested_at);
                if (!preparedAt) return;
                const key = JSON.stringify([c.resource_id, current.table_name, preparedAt, columns]);
                const { profile, spec, aggregate } = await featuredSnapshotCache.get(key, async () => {
                    const profile = await profileStoreTable({ tableName: current.table_name, columns });
                    const spec = pickChartSpec({ row_count: profile.rowCount, columns: profile.columns }, columns);
                    if (!spec) return { profile, spec: null, aggregate: null };
                    const aggregate = await aggregateStoreTable({
                        tableName: current.table_name,
                        knownColumns: columns.map((x) => x.id),
                        q: undefined, filters: [],
                        groupBy: spec.groupBy, agg: spec.agg, aggColumn: spec.aggColumn || null, bucket: spec.bucket || null,
                        sortSql: spec.sort === 'value' ? '"value" DESC' : '"key" DESC NULLS LAST',
                        limit: spec.limit, offset: 0
                    });
                    return { profile, spec, aggregate };
                });
                if (!spec) return;
                const preview = buildFeaturedPreview({ candidate: c, current, profile, spec, aggregate, lang });
                if (preview) out.push(preview);
            });
        } catch {
            // A dataset that fails to profile/aggregate is simply skipped.
        }
    }
    return out;
}

const featured = async (lang = 'en') => featuredCache.get('featured:' + lang, () => computeFeatured(lang));

module.exports = { topDownloads, featured, buildFeaturedPreview };
