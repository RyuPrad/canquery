const { createCache } = require('../utils/cache');

// Shared by HTML and JSON discovery reads. Keep one capacity across query
// families; full publisher descriptions can make even a short page very large.
// Resource detail, preparation and snapshot readers never use this cache.
module.exports = createCache({
    name: 'catalog-discovery',
    ttlMs: 60 * 1000,
    negativeTtlMs: 0,
    maxEntries: 128,
    cacheable: value => value != null && Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024
});
