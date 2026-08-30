const arcgisHub = require('./arcgisHubAdapter');
const ckanSource = require('./ckanSourceAdapter');
const opendatasoft = require('./opendatasoftAdapter');
const socrata = require('./socrataAdapter');
const redDeer = require('./redDeerAdapter');

const adapters = new Map([
    ['arcgis-hub', arcgisHub],
    ['ckan', ckanSource],
    ['opendatasoft', opendatasoft],
    ['socrata', socrata],
    ['red-deer', redDeer]
]);

function getSourceAdapter(kind) {
    const adapter = adapters.get(kind);
    if (!adapter) throw new Error('unsupported catalogue source kind: ' + kind);
    return adapter;
}

module.exports = { getSourceAdapter };
