const adapter = require('../services/ckanSourceAdapter');
const { getSource } = require('../config/catalogSources');

const source = getSource('toronto-open-data');
const montreal = getSource('montreal-open-data');

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
            mode: 'ckan-datastore-csv',
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

    test('does not expand Toronto into direct-file maps without source opt-in', async () => {
        const result = await adapter.enrichRecord(packageRecord({
            resources: [{
                id: 'direct-geojson', name: 'Direct map', format: 'GeoJSON',
                url: 'https://example.test/direct.geojson'
            }]
        }), source);
        expect(result.value.resources).toHaveLength(1);
        expect(result.value.mapCandidates).toEqual([]);
    });

    test('normalizes Montréal as French-first with record-level licences and direct GeoJSON maps', async () => {
        const record = packageRecord({
            name: 'arbres-publics',
            title: 'Arbres publics',
            notes: 'Inventaire des arbres.',
            license_id: 'cc-by',
            license_title: 'Creative Commons Attribution 4.0',
            license_url: 'http://creativecommons.org/licenses/by/4.0/',
            organization: {
                id: 'ville-de-montreal', name: 'ville-de-montreal', title: 'Ville de Montréal'
            },
            tags: [{ name: 'environnement' }],
            resources: [{
                id: 'geojson-file', name: 'Arbres GeoJSON', format: 'GeoJSON',
                url: 'https://donnees.montreal.ca/download/arbres.geojson',
                size: 12345, hash: 'abc123', last_modified: '2026-08-23T12:00:00Z'
            }]
        });
        const result = await adapter.enrichRecord(record, montreal);
        expect(result.status).toBe('included');
        expect(result.value.dataset).toEqual(expect.objectContaining({
            titleEn: null, titleFr: 'Arbres publics', notesEn: null,
            notesFr: 'Inventaire des arbres.', keywordsEn: [],
            keywordsFr: ['Transportation', 'environnement']
        }));
        expect(result.value.organization).toEqual(expect.objectContaining({
            titleEn: null, titleFr: 'Ville de Montréal', placeId: 'sgc-csd-2466023'
        }));
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
        }));
        expect(result.value.resources[0]).toEqual(expect.objectContaining({
            nameEn: null, nameFr: 'Arbres GeoJSON', language: 'fr', sizeBytes: 12345
        }));
        expect(result.value.places).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2466023', relationship: 'direct', includesDescendants: false
        })]);
        expect(result.value.mapCandidates).toEqual([expect.objectContaining({
            mode: 'geojson-file', sourceUrl: record.resources[0].url,
            expectedBytes: 12345, desiredVersion: expect.stringMatching(/^[a-f0-9]{64}$/)
        })]);
    });

    test('keeps explicitly licensed third-party Montréal records as non-authoritative coverage', async () => {
        const record = packageRecord({
            license_id: 'OGL-Canada-2.0',
            organization: { id: 'stm', name: 'stm', title: 'Société de transport de Montréal' }
        });
        const result = await adapter.enrichRecord(record, montreal);
        expect(result.status).toBe('included');
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: false,
            licenseUrl: 'https://open.canada.ca/en/open-government-licence-canada'
        }));
        expect(result.value.places[0]).toEqual(expect.objectContaining({ relationship: 'coverage' }));

        await expect(adapter.enrichRecord(packageRecord({
            license_id: 'unknown-license',
            organization: { id: 'third-party', title: 'Third Party' }
        }), montreal)).resolves.toEqual(expect.objectContaining({
            status: 'excluded', reason: 'unlicensed'
        }));
    });
});
