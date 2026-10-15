const { track } = require('../utils/runtimeWork');
const { startWarming } = require('../utils/warming');
const { searchExpression } = require('./localSearch');
const { readDatasetFacets } = require('../db/catalogFacetQueries');
const { LEVELS } = require('../db/catalogSqlFragments');

// Counts describe the whole catalogue, which changes at sync time, so they
// outlive the 60-second list cache. They are optional: a busy, slow or failed
// computation degrades to null and the list is still returned.
const FRESH_MS = 5 * 60 * 1000;
// The broadest counts take seconds to compute. After five minutes the previous
// counts are still served while one background refresh replaces them.
const STALE_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const WARN_INTERVAL_MS = 60 * 1000;
const RESPONSE_LIMITS = { organization: 500, source: 500, format: 40, keyword: 25 };
const ACCESS = ['queryable', 'mappable'];

function createFacetStore({ freshMs, staleMs, maxEntries, maxBytes }) {
    const entries = new Map();
    const inFlight = new Map();
    const remember = (key, value) => {
        if (value == null || Buffer.byteLength(JSON.stringify(value)) > maxBytes) return;
        entries.delete(key);
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        const now = Date.now();
        entries.set(key, { value, freshUntil: now + freshMs, staleUntil: now + staleMs });
    };
    // One computation per key at a time, shared by waiting requests and
    // background refreshes alike.
    const compute = (key, load) => {
        let pending = inFlight.get(key);
        if (!pending) {
            pending = Promise.resolve().then(load).then((value) => {
                remember(key, value);
                return value;
            }).finally(() => inFlight.delete(key));
            inFlight.set(key, pending);
        }
        return pending;
    };
    return {
        async get(key, load, { mayCompute = true, onRefreshError = () => {} } = {}) {
            const entry = entries.get(key);
            const now = Date.now();
            if (entry && entry.freshUntil > now) {
                entries.delete(key);
                entries.set(key, entry);
                return entry.value;
            }
            if (entry && entry.staleUntil > now) {
                // Shutdown waits for the tracked refresh; its failure keeps the old counts.
                if (mayCompute && !inFlight.has(key)) track(compute(key, load).catch((error) => onRefreshError(error)));
                return entry.value;
            }
            if (entry) entries.delete(key);
            return mayCompute ? compute(key, load) : null;
        },
        // Unlike get(), waits for a replacement of counts that are no longer fresh.
        async refresh(key, load, { mayCompute = true } = {}) {
            const entry = entries.get(key);
            if (entry && entry.freshUntil > Date.now()) return entry.value;
            if (!mayCompute) return entry && entry.staleUntil > Date.now() ? entry.value : null;
            return compute(key, load);
        },
        clear() {
            entries.clear();
            inFlight.clear();
        }
    };
}

const facetStore = createFacetStore({ freshMs: FRESH_MS, staleMs: STALE_MS, maxEntries: 64, maxBytes: 256 * 1024 });

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

function failed(key, error) {
    const timedOut = error && error.code === '57014';
    if (timedOut) coolDown(key);
    warn(timedOut ? 'timeout' : 'error' + (error && error.code ? ' ' + error.code : ''));
}

const coolingDown = key => (cooldowns.get(key) || 0) > Date.now();

function loader(filters) {
    return async () => {
        const outcome = await limiter.run(() => readDatasetFacets(filters));
        if (outcome.skipped) {
            warn('busy');
            return null;
        }
        return shapeDatasetFacets(outcome.value, filters);
    };
}

// Never throws: counts are optional.
async function datasetFacets(filters) {
    const key = facetKey(filters);
    try {
        return await facetStore.get(key, loader(filters), {
            mayCompute: !coolingDown(key),
            onRefreshError: (error) => failed(key, error)
        });
    } catch (error) {
        failed(key, error);
        return null;
    }
}

// Computes counts that are missing or no longer fresh and waits for them.
// Like datasetFacets, it never throws.
async function refreshDatasetFacets(filters) {
    const key = facetKey(filters);
    try {
        return await facetStore.refresh(key, loader(filters), { mayCompute: !coolingDown(key) });
    } catch (error) {
        failed(key, error);
        return null;
    }
}

// The broadest counts take over a second, and the homepage asks for them on
// every first visit. Compute them as soon as the API starts, then refresh them
// before they expire so an idle hour never leaves a visitor waiting. One
// search at a time, so visitors keep the second computation slot.
const WARM_INTERVAL_MS = 20 * 60 * 1000;

function startFacetWarming(searches, { intervalMs = WARM_INTERVAL_MS } = {}) {
    return startWarming('catalog-facets', searches.map(filters => () => refreshDatasetFacets(filters)), { intervalMs });
}

module.exports = { datasetFacets, refreshDatasetFacets, startFacetWarming, shapeDatasetFacets, facetKey, createFacetLimiter,
    createFacetStore, facetStore, WARM_INTERVAL_MS };
