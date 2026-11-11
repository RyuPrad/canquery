// Datasets with a page of their own built from their files: the dataset's page and
// each of its file pages lead to it. One entry per dataset; `available` says whether
// the hub has anything to show yet.
const { LMIA_DATASET_ID } = require('./lmiaLabels');
const { OAS_DATASET_ID, oasPath, copy } = require('./oasLabels');
const { hubAvailable } = require('./hubAvailability');

const HUBS = Object.freeze({
    [LMIA_DATASET_ID]: { available: () => true, section: { title: 'Search every list by employer',
        links: [{ path: '/lmia', label: 'Positive LMIA employers: every list since 2014' }] } },
    [OAS_DATASET_ID]: { available: () => hubAvailable('oas'), section: { title: 'Find an amount by income',
        links: [{ path: oasPath('en'), label: copy('en').hubLong },
            { path: oasPath('fr'), label: copy('fr').hubLong, detail: '(français)' }] } }
});

// The link section a dataset or file page of this dataset shows; none for other datasets.
function hubSections(datasetId) {
    const hub = Object.hasOwn(HUBS, datasetId) ? HUBS[datasetId] : null;
    return hub && hub.available() ? [hub.section] : [];
}

module.exports = { hubSections };
