const arcgisHub = require('./arcgisHubAdapter');

const adapters = new Map([
    ['arcgis-hub', arcgisHub]
]);

function getSourceAdapter(kind) {
    const adapter = adapters.get(kind);
    if (!adapter) throw new Error('unsupported catalogue source kind: ' + kind);
    return adapter;
}

module.exports = { getSourceAdapter };
