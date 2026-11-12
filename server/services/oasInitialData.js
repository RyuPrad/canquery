const { envelope } = require('../utils/envelope');
const { OAS_META } = require('./oasPages');

// A direct visit to the OAS amounts hub or to one of its table pages receives, inside
// its HTML, the answers the page would otherwise fetch: the summary of the quarter
// shown, and on a table's page that table's every income band. Both are exactly the
// bodies of the website's JSON routes (routes/oas.js), so the page checks them like
// fetched responses and draws on its first render, with no loading state between the
// server's HTML and the application.
const INLINE_MAX_BYTES = 256 * 1024;
const PAYLOAD_VERSION = 1;

// `summary` is null until a quarter is loaded (no block then); `data` is the table of
// a table page, null on the hub.
function oasInitialData({ lang, table, summary, data }, { path }) {
    if (!summary || (table !== null && !data)) return null;
    const payload = { version: PAYLOAD_VERSION, kind: 'oas', path, lang, table,
        summary: envelope(summary, { meta: OAS_META }), rows: data ? envelope(data, { meta: OAS_META }) : null };
    return Buffer.byteLength(JSON.stringify(payload)) > INLINE_MAX_BYTES ? null : payload;
}

module.exports = { oasInitialData, INLINE_MAX_BYTES, PAYLOAD_VERSION };
