const adapter = require('../services/ckanSourceAdapter');
const { getSource } = require('../config/catalogSources');

const source = getSource('toronto-open-data');

function packageRecord(overrides = {}) {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'road-centrelines',
        title: 'Road Centrelines',
        notes: 'Official road geometry.',
        metadata_modified: '2026-08-20T12:00:00Z',
        organization: { id: 'city-id', name: 'city-of-toronto', title: 'City of Toronto' },
        topics: ['Transportation'],
        tags: [{ name: 'Roads' }],
        resources: [],
        ...overrides
    };
}

describe('generic CKAN source adapter', () => {
    test('pages deterministically and fails closed on a truncated catalogue', async () => {
        const rows = Array.from({ length: 101 }, (_, index) => ({ id: String(index) }));
        const fetchJson = jest.fn(async url => {
            const start = Number(new URL(url).searchParams.get('start'));
            return { success: true, result: { count: 101, results: rows.slice(start, start + 100) } };
        });
        await expect(adapter.discover(source, { fetchJson })).resolves.toHaveLength(101);
        expect(fetchJson).toHaveBeenCalledTimes(2);
        expect(new URL(fetchJson.mock.calls[0][0]).searchParams.get('sort')).toBe('id asc');

        await expect(adapter.discover(source, {
            fetchJson: async () => ({ success: true, result: { count: 2, results: [] } })
        })).rejects.toThrow(/ended before|empty/i);
    });

    test('namespaces identities, attaches Toronto licensing, and retains every DataStore resource', async () => {
        const record = packageRecord({
            resources: [{
                id: 'geo-upstream', name: 'Road Centrelines', format: 'GeoJSON',
                datastore_active: true, record_count: 20, vertex_count: 80,
                metadata_modified: '2026-08-20T11:00:00Z',
                datastore_cache_last_update: '2026-08-20T11:05:00Z',
                url: 'https://example.test/unused.geojson'
            }, {
                id: 'geo-cache', name: 'Road Centrelines.csv', format: 'CSV',
                datastore_resource_id: 'geo-upstream', is_datastore_cache_file: true,
                url: 'https://example.test/cache.csv'
            }, {
                id: 'wards-xlsx', name: 'Ward lookup', format: 'XLSX', position: 5,
                url: 'https://example.test/wards.xlsx'
            }, {
                id: 'wards-csv', name: 'Ward lookup WGS84', format: 'CSV', position: 6,
                url: 'https://example.test/wards.csv'
            }]
        });
        const result = await adapter.enrichRecord(record, source);
        expect(result.status).toBe('included');
        expect(result.value.dataset.id).toBe('ckan-toronto-open-data-dataset-' + record.id);
        expect(result.value.dataset.name).toBe('toronto-open-data-road-centrelines');
        expect(result.value.dataset.keywordsEn).toEqual(['Transportation', 'Roads']);
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseUrl: 'https://open.toronto.ca/open-data-licence/'
        }));
        expect(result.value.resources).toHaveLength(2);
        const datastore = result.value.resources.find(resource => resource.datastoreActive);
        expect(datastore).toEqual(expect.objectContaining({
            format: 'CSV',
            url: expect.stringContaining('/datastore/dump/geo-upstream')
        }));
        expect(datastore.raw).toEqual(expect.objectContaining({
            source_id: 'toronto-open-data', upstream_resource_id: 'geo-upstream',
            original_format: 'GEOJSON'
        }));
        expect(result.value.resources.find(resource => !resource.datastoreActive).url).toBe('https://example.test/wards.csv');
        expect(result.value.mapCandidates).toEqual([expect.objectContaining({
            resourceId: datastore.id, expectedRows: 20, expectedVertices: 80,
            desiredVersion: expect.stringMatching(/^[a-f0-9]{64}$/)
        })]);
        expect(result.value.places[0]).toEqual(expect.objectContaining({ placeId: 'sgc-cd-3520', relationship: 'direct' }));
    });

    test('keeps metadata-only packages and excludes malformed identities', async () => {
        const empty = await adapter.enrichRecord(packageRecord({ resources: [] }), source);
        expect(empty.status).toBe('included');
        expect(empty.value.resources).toEqual([]);
        await expect(adapter.enrichRecord(packageRecord({ id: '' }), source)).resolves.toEqual(expect.objectContaining({
            status: 'excluded', reason: 'invalid-package'
        }));
    });
});
