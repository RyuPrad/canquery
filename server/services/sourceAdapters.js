const arcgisHub = require('./arcgisHubAdapter');
const ckanSource = require('./ckanSourceAdapter');

const adapters = new Map([
    ['arcgis-hub', arcgisHub],
    ['ckan', ckanSource]
]);

function getSourceAdapter(kind) {
    const adapter = adapters.get(kind);
    if (!adapter) throw new Error('unsupported catalogue source kind: ' + kind);
    return adapter;
}

module.exports = { getSourceAdapter };
