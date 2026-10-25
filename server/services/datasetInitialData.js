const { datasetDetail } = require('./catalogService');
const { datasetEnvelope } = require('./resourceEnvelopes');
const { listArticles } = require('./blogContent');
const { envelope } = require('../utils/envelope');

// A direct visit to /datasets/:id receives, inside its HTML, the dataset
// envelope and both guide lists the page would otherwise fetch, built from the
// rows the page's HTML was rendered from. A crawler rendering the page then
// needs no API request at all. A dataset with very many files is left to the
// browser's own request rather than doubling the size of its HTML.
const INLINE_MAX_BYTES = 256 * 1024;
const PAYLOAD_VERSION = 1;

function datasetInitialData(row, resources, { path }) {
    const guides = Object.fromEntries(['en', 'fr'].map(lang =>
        [lang, envelope(listArticles({ lang, dataset: row.id }))]));
    const payload = { version: PAYLOAD_VERSION, kind: 'dataset', path,
        dataset: datasetEnvelope(datasetDetail(row, resources)), guides };
    return Buffer.byteLength(JSON.stringify(payload)) > INLINE_MAX_BYTES ? null : payload;
}

module.exports = { datasetInitialData, INLINE_MAX_BYTES, PAYLOAD_VERSION };
