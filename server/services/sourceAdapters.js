const arcgisHub = require('./arcgisHubAdapter');
const ckanSource = require('./ckanSourceAdapter');
const opendatasoft = require('./opendatasoftAdapter');

const adapters = new Map([
    ['arcgis-hub', arcgisHub],
    ['ckan', ckanSource],
    ['opendatasoft', opendatasoft]
]);

function getSourceAdapter(kind) {
    const adapter = adapters.get(kind);
    if (!adapter) throw new Error('unsupported catalogue source kind: ' + kind);
    return adapter;
}

module.exports = { getSourceAdapter };
