const {
    upsertOrganizations,
    upsertDatasets,
    upsertDatasetSources,
    replaceResources,
    replaceDatasetPlaces
} = require('../db/catalogWriteQueries');
const { FEDERAL_PUBLISHER_PLACES } = require('../config/federalPublisherPlaces');

// The provinces and territories named in config/federalPublisherPlaces.js that
// this database holds. Read once per run: a place missing from a fresh database
// would fail a foreign key and roll back the whole chunk.
async function loadFederalPlaceIds(db) {
    const ids = Array.from(new Set(Object.values(FEDERAL_PUBLISHER_PLACES)));
    const { rows } = await db.query('SELECT id FROM places WHERE id = ANY($1::text[])', [ids]);
    return new Set(rows.map(row => row.id));
}

// The writes of one chunk of normalized federal packages, inside the caller's
// transaction. Place links are replaced for every dataset of the chunk, so a
// record that changed its level or publisher loses the place it had.
async function writeFederalChunk(client, { organizations, datasets, resources, places }, knownPlaceIds) {
    if (datasets.length === 0) return;
    const known = placeId => Boolean(placeId) && knownPlaceIds.has(placeId);
    const datasetIds = datasets.map(dataset => dataset.id);
    await upsertOrganizations(client, organizations.map(organization =>
        organization.placeId && !known(organization.placeId) ? { ...organization, placeId: null } : organization));
    await upsertDatasets(client, datasets);
    await upsertDatasetSources(client, datasets.map(dataset => ({
        sourceId: 'open-canada',
        externalId: dataset.id,
        datasetId: dataset.id,
        landingUrl: 'https://open.canada.ca/data/en/dataset/' + dataset.id,
        isAuthoritative: true
    })));
    await replaceResources(client, datasetIds, resources);
    await replaceDatasetPlaces(client, 'open-canada', datasetIds, places.filter(link => known(link.placeId)));
}

// Provincial records whose publisher has no province in the table, counted by
// organization name, so a new provincial publisher shows up in the sync log.
function countUnmappedProvincial(counts, normalized) {
    if (normalized.dataset.jurisdiction !== 'provincial' || normalized.places.length > 0) return counts;
    const name = (normalized.organization && normalized.organization.name) || '(no organization)';
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
}

function reportUnmappedProvincial(counts) {
    if (counts.size === 0) return;
    console.warn('provincial records without a mapped publisher: ' +
        JSON.stringify(Object.fromEntries(Array.from(counts).sort(([a], [b]) => a.localeCompare(b)))));
}

module.exports = { loadFederalPlaceIds, writeFederalChunk, countUnmappedProvincial, reportUnmappedProvincial };
