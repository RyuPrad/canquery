const { envelope } = require('../utils/envelope');
const { PORTALS_META } = require('./portalPages');

// A direct visit to /portals receives, inside its HTML, the answer the page
// would otherwise fetch: exactly the body of the website's JSON route
// (routes/portals.js), so the page checks it like a fetched response and draws
// the directory on its first render.
const INLINE_MAX_BYTES = 256 * 1024;
const PAYLOAD_VERSION = 1;

// `directory` is null while nothing is mirrored (no block then).
function portalInitialData(directory, { path }) {
    if (!directory) return null;
    const payload = { version: PAYLOAD_VERSION, kind: 'portals', path, directory: envelope(directory, { meta: PORTALS_META }) };
    return Buffer.byteLength(JSON.stringify(payload)) > INLINE_MAX_BYTES ? null : payload;
}

module.exports = { portalInitialData, INLINE_MAX_BYTES, PAYLOAD_VERSION };
