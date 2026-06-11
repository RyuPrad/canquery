// Tiny in-memory cache for endpoints that hit the upstream CKAN API or
// run repeated queries. Process-local - if we ever scale to multiple Node
// processes, each gets its own cache. That's intentional: stale data is
// fine for these endpoints (short TTLs anyway) and avoiding shared state
// keeps deployment simple.
//
// Includes stampede protection via in-flight promise deduplication: if
// 50 requests for the same key arrive simultaneously while the cache is
// cold, only one upstream call fires; the other 49 await the same promise.
function createCache({ name, ttlMs, negativeTtlMs }) {
    const store = new Map();
    const inFlight = new Map();
    const stats = {
        name,
        hits: 0,
        misses: 0,
        in_flight_hits: 0,    // dedup'd onto an in-progress fetch
        negative_hits: 0,     // hit on a cached null/error
        size: 0,
        last_cleared: null
    };

    return {
        async get(key, fn) {
            const now = Date.now();
            const cached = store.get(key);
            if (cached && cached.expiresAt > now) {
                stats.hits++;
                if (cached.data == null) stats.negative_hits++;
                return cached.data;
            }
            const pending = inFlight.get(key);
            if (pending) {
                stats.in_flight_hits++;
                return pending;
            }
            stats.misses++;
            const promise = Promise.resolve()
                .then(fn)
                .then(result => {
                    const ttl = result == null ? negativeTtlMs : ttlMs;
                    store.set(key, { data: result, expiresAt: Date.now() + ttl });
                    stats.size = store.size;
                    return result;
                })
                .finally(() => inFlight.delete(key));
            inFlight.set(key, promise);
            return promise;
        },
        clear() {
            store.clear();
            inFlight.clear();
            stats.size = 0;
            stats.last_cleared = new Date().toISOString();
        },
        stats() {
            return { ...stats };
        }
    };
}

module.exports = { createCache };
