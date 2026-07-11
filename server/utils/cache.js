// Tiny in-memory cache for endpoints that hit the upstream CKAN API or
// run repeated queries. Process-local - if we ever scale to multiple Node
// processes, each gets its own cache. That's intentional: stale data is
// fine for these endpoints (short TTLs anyway) and avoiding shared state
// keeps deployment simple.
//
// Includes stampede protection via in-flight promise deduplication: if
// 50 requests for the same key arrive simultaneously while the cache is
// cold, only one upstream call fires; the other 49 await the same promise.
//
// Map preserves insertion order, which lets us implement a small LRU without
// another dependency. The hard cap matters most for the datastore proxy: its
// key contains caller-controlled query parameters, so TTL alone is not a
// memory bound.
function createCache({ name, ttlMs, negativeTtlMs, maxEntries = 500, maxInFlight = maxEntries }) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new TypeError('cache maxEntries must be a positive integer');
    }
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1) {
        throw new TypeError('cache maxInFlight must be a positive integer');
    }
    const store = new Map();
    const inFlight = new Map();
    let generation = 0;
    const stats = {
        name,
        hits: 0,
        misses: 0,
        in_flight_hits: 0,    // dedup'd onto an in-progress fetch
        negative_hits: 0,     // hit on a cached null/error
        expired: 0,
        evictions: 0,
        uncached_misses: 0,
        in_flight: 0,
        size: 0,
        last_cleared: null
    };

    const setEntry = (key, entry) => {
        // Updating an existing key must also make it most-recently used.
        store.delete(key);
        while (store.size >= maxEntries) {
            const oldestKey = store.keys().next().value;
            store.delete(oldestKey);
            stats.evictions++;
        }
        store.set(key, entry);
        stats.size = store.size;
    };

    return {
        async get(key, fn) {
            const now = Date.now();
            const cached = store.get(key);
            if (cached && cached.expiresAt > now) {
                stats.hits++;
                if (cached.data == null) stats.negative_hits++;
                // Touch the entry so iteration order remains LRU order.
                store.delete(key);
                store.set(key, cached);
                return cached.data;
            }
            if (cached) {
                store.delete(key);
                stats.expired++;
                stats.size = store.size;
            }
            const pending = inFlight.get(key);
            if (pending) {
                stats.in_flight_hits++;
                return pending;
            }
            stats.misses++;
            // Slow upstream calls can otherwise make the stampede-protection
            // map itself an unbounded high-cardinality cache. Once full, run
            // the miss without retaining another key/promise or result.
            if (inFlight.size >= maxInFlight) {
                stats.uncached_misses++;
                return Promise.resolve().then(fn);
            }
            const requestGeneration = generation;
            const promise = Promise.resolve()
                .then(fn)
                .then(result => {
                    if (generation === requestGeneration) {
                        const ttl = result == null ? negativeTtlMs : ttlMs;
                        setEntry(key, { data: result, expiresAt: Date.now() + ttl });
                    }
                    return result;
                })
                .finally(() => {
                    if (inFlight.get(key) === promise) inFlight.delete(key);
                    stats.in_flight = inFlight.size;
                });
            inFlight.set(key, promise);
            stats.in_flight = inFlight.size;
            return promise;
        },
        clear() {
            generation++;
            store.clear();
            inFlight.clear();
            stats.size = 0;
            stats.in_flight = 0;
            stats.last_cleared = new Date().toISOString();
        },
        stats() {
            return { ...stats };
        }
    };
}

module.exports = { createCache };
