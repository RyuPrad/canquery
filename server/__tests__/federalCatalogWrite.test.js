jest.mock('../db/catalogWriteQueries', () => ({
    upsertOrganizations: jest.fn(), upsertDatasets: jest.fn(), upsertDatasetSources: jest.fn(),
    replaceResources: jest.fn(), replaceDatasetPlaces: jest.fn()
}));
const writes = require('../db/catalogWriteQueries');
const { loadFederalPlaceIds, writeFederalChunk, countUnmappedProvincial, reportUnmappedProvincial } = require('../services/federalCatalogWrite');
const { normalizePackage } = require('../services/catalogNormalizer');

const pkg = (id, organization, jurisdiction) => ({ id, name: id, title: id, jurisdiction, owner_org: 'org-' + organization,
    organization: { id: 'org-' + organization, name: organization, title: organization }, resources: [] });
const chunk = packages => {
    const normalized = packages.map(normalizePackage);
    return {
        organizations: Array.from(new Map(normalized.map(n => [n.organization.id, n.organization])).values()),
        datasets: normalized.map(n => n.dataset),
        resources: [],
        places: normalized.flatMap(n => n.places)
    };
};

describe('federal catalogue chunk writes', () => {
    beforeEach(() => jest.clearAllMocks());

    test('replaces the place links of every dataset in the chunk, keeping links to known places', async () => {
        const client = {};
        await writeFederalChunk(client, chunk([pkg('a', 'ab', 'provincial'), pkg('b', 'ec', 'federal'), pkg('c', 'sk', 'provincial')]),
            new Set(['sgc-pr-48']));
        expect(writes.replaceDatasetPlaces).toHaveBeenCalledWith(client, 'open-canada', ['a', 'b', 'c'], [
            { datasetId: 'a', placeId: 'sgc-pr-48', relationship: 'direct', includesDescendants: false, assignmentMethod: 'source' }
        ]);
        const organizations = writes.upsertOrganizations.mock.calls[0][1];
        expect(organizations.map(org => [org.name, org.placeId])).toEqual([['ab', 'sgc-pr-48'], ['ec', null], ['sk', null]]);
        expect(writes.upsertDatasetSources.mock.calls[0][1][0]).toMatchObject({ sourceId: 'open-canada', externalId: 'a', isAuthoritative: true });
        expect(writes.replaceResources).toHaveBeenCalledWith(client, ['a', 'b', 'c'], []);
    });

    test('writes nothing for an empty chunk', async () => {
        await writeFederalChunk({}, { organizations: [], datasets: [], resources: [], places: [] }, new Set());
        expect(writes.upsertDatasets).not.toHaveBeenCalled();
        expect(writes.replaceDatasetPlaces).not.toHaveBeenCalled();
    });

    test('reads the known places once, for the listed ids only', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'ca-on' }] }) };
        expect(await loadFederalPlaceIds(db)).toEqual(new Set(['ca-on']));
        expect(db.query.mock.calls[0][1][0]).toHaveLength(12);
    });

    test('counts and reports provincial records whose publisher is not listed', () => {
        const counts = new Map();
        for (const p of [pkg('a', 'ab', 'provincial'), pkg('b', 'ec', 'provincial'), pkg('c', 'ec', 'provincial'), pkg('d', 'ec', 'federal')]) {
            countUnmappedProvincial(counts, normalizePackage(p));
        }
        expect(counts).toEqual(new Map([['ec', 2]]));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        reportUnmappedProvincial(counts);
        reportUnmappedProvincial(new Map());
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toBe('provincial records without a mapped publisher: {"ec":2}');
        warn.mockRestore();
    });
});
