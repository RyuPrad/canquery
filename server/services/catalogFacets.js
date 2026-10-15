const { createCache } = require('../utils/cache');
const { searchExpression } = require('./localSearch');
const { readDatasetFacets } = require('../db/catalogFacetQueries');
const { LEVELS } = require('../db/catalogSqlFragments');

// Counts describe the whole catalogue, which changes at sync time, so they
// outlive the 60-second list cache. They are optional: a busy, slow or failed
// computation degrades to null and the list is still returned.
const TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const WARN_INTERVAL_MS = 60 * 1000;
const RESPONSE_LIMITS = { organization: 500, source: 500, format: 40, keyword: 25 };
const ACCESS = ['queryable', 'mappable'];

const facetCache = createCache({
    name: 'catalog-facets',
    ttlMs: TTL_MS,
    negativeTtlMs: 0,
    maxEntries: 64,
    cacheable: value => value != null && Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024
});

// At most `concurrency` computations run at once per process; a short queue
// absorbs bursts and everything beyond it is answered without counts.
function createFacetLimiter({ concurrency, queueLimit, waitMs }) {
    let active = 0;
    const queue = [];
    const release = () => {
        const next = queue.shift();
        if (next) {
            clearTimeout(next.timer);
            next.resolve(true);
        } else {
            active--;
        }
    };
    return {
        async run(fn) {
            if (active >= concurrency) {
                if (queue.length >= queueLimit) return { skipped: true };
                const admitted = await new Promise(resolve => {
                    const entry = { resolve };
                    entry.timer = setTimeout(() => {
                        const index = queue.indexOf(entry);
                        if (index >= 0) queue.splice(index, 1);
                        resolve(false);
                    }, waitMs);
                    entry.timer.unref?.();
                    queue.push(entry);
                });
                if (!admitted) return { skipped: true };
            } else {
                active++;
            }
            try {
                return { value: await fn() };
            } finally {
                release();
            }
        },
        stats: () => ({ active, queued: queue.length })
    };
}

const limiter = createFacetLimiter({ concurrency: 2, queueLimit: 8, waitMs: 1000 });
const cooldowns = new Map();
const lastWarning = new Map();

function warn(reason) {
    const now = Date.now();
    if ((lastWarning.get(reason) || 0) > now - WARN_INTERVAL_MS) return;
    lastWarning.set(reason, now);
    console.warn('[catalog-facets] counts unavailable: ' + reason);
}

function coolDown(key) {
    cooldowns.delete(key);
    while (cooldowns.size >= 256) cooldowns.delete(cooldowns.keys().next().value);
    cooldowns.set(key, Date.now() + COOLDOWN_MS);
}

// The SQL depends on the parsed search terms, not their spelling, and never
// on paging or order.
function facetKey(filters) {
    return JSON.stringify(['facets', filters.q ? searchExpression(filters.q) : null,
        filters.org || null, filters.format || null, filters.keyword || null, filters.place || null,
        filters.source || null, filters.level || null, filters.mappable || null, filters.queryable || null,
        filters.lang === 'fr' ? 'fr' : 'en']);
}

const label = row => ({ en: row.label_en ?? null, fr: row.label_fr ?? null });
const byCount = (a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

function shapeDatasetFacets(rows, filters) {
    let total = 0;
    const groups = { level: new Map(), access: new Map(), organization: new Map(), source: new Map(), format: new Map(), keyword: new Map() };
    const labels = { organization: new Map(), source: new Map() };
    const selectedKeywords = new Map();
    for (const row of rows) {
        const count = Number(row.count) || 0;
        if (row.facet === 'total') total = count;
        else if (row.facet === 'keyword-selected') selectedKeywords.set(row.value, count);
        else if (row.facet === 'organization-label') labels.organization.set(row.value, label(row));
        else if (row.facet === 'source-label') labels.source.set(row.value, label(row));
        else if (groups[row.facet] && row.value != null) {
            const labelled = row.facet === 'organization' || row.facet === 'source';
            groups[row.facet].set(row.value, { value: row.value, ...(labelled ? { label: label(row) } : {}), count });
        }
    }
    // A selected keyword counts matches in either language, like the filter.
    for (const [value, count] of selectedKeywords) groups.keyword.set(value, { value, count });
    const selected = { level: filters.level, organization: filters.org, source: filters.source, format: filters.format, keyword: filters.keyword };
    for (const [name, values] of Object.entries(selected)) {
        for (const value of values || []) {
            if (groups[name].has(value)) continue;
            const known = labels[name]?.get(value);
            groups[name].set(value, { value, ...(labels[name] ? { label: known || { en: null, fr: null } } : {}), count: 0 });
        }
    }
    const listed = (name) => {
        const items = Array.from(groups[name].values()).sort(byCount);
        const limit = RESPONSE_LIMITS[name];
        if (!limit || items.length <= limit) return items;
        const keep = new Set(selected[name] || []);
        return items.filter((item, index) => index < limit || keep.has(item.value));
    };
    return {
        total,
        facets: {
            level: LEVELS.filter(value => groups.level.has(value)).map(value => groups.level.get(value)),
            access: ACCESS.map(value => groups.access.get(value) || { value, count: 0 }),
            organization: listed('organization'),
            source: listed('source'),
            format: listed('format'),
            keyword: listed('keyword')
        }
    };
}

// Never throws: counts are optional.
async function datasetFacets(filters) {
    const key = facetKey(filters);
    if ((cooldowns.get(key) || 0) > Date.now()) return null;
    try {
        return await facetCache.get(key, async () => {
            const outcome = await limiter.run(() => readDatasetFacets(filters));
            if (outcome.skipped) {
                warn('busy');
                return null;
            }
            return shapeDatasetFacets(outcome.value, filters);
        });
    } catch (error) {
        const timedOut = error && error.code === '57014';
        if (timedOut) coolDown(key);
        warn(timedOut ? 'timeout' : 'error' + (error && error.code ? ' ' + error.code : ''));
        return null;
    }
}

module.exports = { datasetFacets, shapeDatasetFacets, facetKey, createFacetLimiter, facetCache };
