const {
    discover,
    enrichRecord,
    exportUrl,
    directMapVersion
} = require('../services/opendatasoftAdapter');
const { getSource } = require('../config/catalogSources');

const source = getSource('vancouver-open-data');

function makeRecord(overrides = {}) {
    const defaults = {
        title: 'Public trees',
        description: '<p>Tree locations<br>updated daily.</p>',
        theme: ['Geographic data'],
        keyword: ['trees', 'parks'],
        license: 'Open Government Licence - Vancouver',
        license_url: 'https://opendata.vancouver.ca/pages/licence/',
        publisher: 'City of Vancouver',
        modified: '2026-08-20T12:00:00+00:00',
        data_processed: '2026-08-25T14:07:12+00:00',
        geometry_types: ['Point'],
        records_count: 42
    };
    const record = {
        visibility: 'domain',
        fields: [
            { name: 'tree_id', label: 'Tree ID', type: 'int' },
            { name: 'geom', label: 'Geometry', type: 'geo_point_2d' }
        ],
        dataset_id: 'public-trees',
        dataset_uid: 'da_trees',
        has_records: true,
        features: ['analyze', 'geo'],
        data_visible: true,
        metas: { default: defaults }
    };
    const merged = { ...record, ...overrides };
    merged.metas = {
        ...record.metas,
        ...(overrides.metas || {}),
        default: { ...defaults, ...(overrides.metas && overrides.metas.default || {}) }
    };
    return merged;
}

describe('Opendatasoft catalogue adapter', () => {
    test('discovers every advertised record in stable id order', async () => {
        const all = Array.from({ length: 201 }, (_, index) => ({
            dataset_id: 'dataset-' + String(index).padStart(3, '0')
        }));
        const fetchJson = jest.fn(async value => {
            const url = new URL(value);
            const offset = Number(url.searchParams.get('offset'));
            expect(url.pathname).toBe('/api/explore/v2.1/catalog/datasets');
            expect(url.searchParams.get('limit')).toBe('100');
            expect(url.searchParams.get('order_by')).toBe('dataset_id');
            return { total_count: all.length, results: all.slice(offset, offset + 100) };
        });

        await expect(discover(source, { fetchJson })).resolves.toEqual(all);
        expect(fetchJson).toHaveBeenCalledTimes(3);
    });

    test('fails closed on count drift, truncation, duplicate ids, and empty catalogues', async () => {
        const page = Array.from({ length: 100 }, (_, index) => ({ dataset_id: 'd-' + index }));
        await expect(discover(source, { fetchJson: jest.fn()
            .mockResolvedValueOnce({ total_count: 101, results: page })
            .mockResolvedValueOnce({ total_count: 102, results: [{ dataset_id: 'last' }] })
        })).rejects.toThrow(/count changed/);

        await expect(discover(source, { fetchJson: async () => ({
            total_count: 2, results: [{ dataset_id: 'only-one' }]
        }) })).rejects.toThrow(/ended before/);

        await expect(discover(source, { fetchJson: async () => ({
            total_count: 2, results: [{ dataset_id: 'same' }, { dataset_id: 'same' }]
        }) })).rejects.toThrow(/duplicate dataset id/);

        await expect(discover(source, { fetchJson: async () => ({
            total_count: 0, results: []
        }) })).rejects.toThrow(/empty catalogue/);
    });

    test('normalizes a licensed city record into one loadable CSV and one bounded map candidate', async () => {
        const record = makeRecord();
        const result = await enrichRecord(record, source);

        expect(result.status).toBe('included');
        expect(result.value).toEqual(expect.objectContaining({
            externalId: 'public-trees',
            organization: expect.objectContaining({
                id: 'opendatasoft-vancouver-open-data-org-city-of-vancouver',
                titleEn: 'City of Vancouver',
                titleFr: 'Ville de Vancouver',
                placeId: 'sgc-csd-5915022'
            }),
            dataset: expect.objectContaining({
                id: 'opendatasoft-vancouver-open-data-dataset-public-trees',
                titleEn: 'Public trees',
                notesEn: 'Tree locations\nupdated daily.',
                keywordsEn: ['Geographic data', 'trees', 'parks']
            }),
            source: expect.objectContaining({
                isAuthoritative: true,
                licenseUrl: 'https://opendata.vancouver.ca/pages/licence/',
                landingUrl: 'https://opendata.vancouver.ca/explore/dataset/public-trees/information/'
            }),
            places: [expect.objectContaining({
                placeId: 'sgc-csd-5915022', relationship: 'direct', includesDescendants: false
            })],
            manageMaps: false,
            manageMapCandidates: true
        }));
        expect(result.value.resources).toEqual([expect.objectContaining({
            id: 'opendatasoft-vancouver-open-data-resource-public-trees',
            format: 'CSV', datastoreActive: false, sizeBytes: null,
            url: 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/public-trees/exports/csv' +
                '?lang=en&timezone=America%2FVancouver&use_labels=false&delimiter=%2C',
            raw: expect.objectContaining({
                provider: 'opendatasoft', record_count: 42, field_count: 2
            })
        })]);
        expect(result.value.mapCandidates).toEqual([expect.objectContaining({
            resourceId: 'opendatasoft-vancouver-open-data-resource-public-trees',
            mode: 'geojson-file', expectedRows: 42,
            sourceUrl: 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/public-trees/exports/geojson' +
                '?lang=en&timezone=America%2FVancouver',
            desiredVersion: expect.stringMatching(/^[0-9a-f]{64}$/)
        })]);
        expect(result.value.resources[0].url).not.toBe(result.value.mapCandidates[0].sourceUrl);
    });

    test('uses the configured City publisher only when record metadata omits it', async () => {
        const record = makeRecord({ metas: { default: { publisher: null } } });
        const result = await enrichRecord(record, source);
        expect(result.status).toBe('included');
        expect(result.value.source.raw).toEqual(expect.objectContaining({
            publisher: 'City of Vancouver', supplied_publisher: null
        }));
    });

    test.each([
        [{ has_records: false }, 'not-loadable'],
        [{ data_visible: false }, 'not-public'],
        [{ metas: { default: { license: null } } }, 'unlicensed'],
        [{ metas: { default: { license_url: 'https://example.test/terms' } } }, 'unlicensed'],
        [{ metas: { default: { publisher: 'External Publisher' } } }, 'publisher-not-admitted']
    ])('excludes ineligible records with a stable reason', async (overrides, reason) => {
        await expect(enrichRecord(makeRecord(overrides), source)).resolves.toEqual(expect.objectContaining({
            status: 'excluded', reason
        }));
    });

    test('requires both geo capability and a declared geometry type for map admission', async () => {
        const result = await enrichRecord(makeRecord({
            metas: { default: { geometry_types: null } }
        }), source);
        expect(result.value.mapCandidates).toEqual([]);
    });

    test('export URLs and map versions are deterministic and source-bound', () => {
        const record = makeRecord();
        expect(exportUrl(source, 'public trees', 'geojson')).toBe(
            'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/public%20trees/exports/geojson' +
            '?lang=en&timezone=America%2FVancouver'
        );
        expect(directMapVersion(record, source)).toBe(directMapVersion(record, source));
        expect(directMapVersion(record, source)).not.toBe(directMapVersion(makeRecord({
            metas: { default: { records_count: 43 } }
        }), source));
    });
});
