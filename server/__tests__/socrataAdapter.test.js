const {
    discover,
    enrichRecord,
    csvUrl,
    geoJsonPageUrl,
    directMapVersion,
    cachedRecordCount
} = require('../services/socrataAdapter');
const { getSource } = require('../config/catalogSources');

const source = getSource('calgary-open-data');

function catalogRecord(id = 'abcd-1234') {
    return {
        resource: {
            id, type: 'dataset', lens_view_type: 'tabular',
            name: 'Building permits', description: 'Issued permits',
            updatedAt: '2026-08-25T12:00:00Z'
        }
    };
}

function view(overrides = {}) {
    return {
        id: 'abcd-1234', name: 'Building permits', description: 'Issued permits',
        rowsUpdatedAt: 1787662800, viewLastModified: 1787666400,
        tags: ['buildings'],
        metadata: { custom_fields: {
            'Data Supplier': { Organization: 'The City of Calgary' },
            'License/Attribution': { 'License URL': 'https://data.calgary.ca/d/Open-Data-Terms/u45n-7awa' }
        } },
        columns: [
            { fieldName: 'permit_num', name: 'Permit number', dataTypeName: 'text', cachedContents: { count: '42' } },
            { fieldName: 'point', name: 'Location', dataTypeName: 'point', cachedContents: { count: '40', null: '2' } }
        ],
        ...overrides
    };
}

describe('Socrata catalogue adapter', () => {
    test('discovers every advertised dataset and rejects drift or duplicates', async () => {
        const records = Array.from({ length: 201 }, (_, index) => catalogRecord('id-' + index));
        const fetchJson = jest.fn(async value => {
            const url = new URL(value);
            const offset = Number(url.searchParams.get('offset'));
            expect(url.searchParams.get('only')).toBe('datasets');
            expect(url.searchParams.get('search_context')).toBe('data.calgary.ca');
            return { resultSetSize: records.length, results: records.slice(offset, offset + 100) };
        });
        await expect(discover(source, { fetchJson })).resolves.toEqual(records);
        expect(fetchJson).toHaveBeenCalledTimes(3);

        await expect(discover(source, { fetchJson: jest.fn()
            .mockResolvedValueOnce({ resultSetSize: 101, results: records.slice(0, 100) })
            .mockResolvedValueOnce({ resultSetSize: 102, results: records.slice(100, 102) })
        })).rejects.toThrow(/count changed/);
        await expect(discover(source, { fetchJson: async () => ({
            resultSetSize: 2, results: [catalogRecord('same'), catalogRecord('same')]
        }) })).rejects.toThrow(/duplicate dataset id/);
    });

    test('normalizes a strictly licensed city table and bounded PMTiles candidate', async () => {
        const result = await enrichRecord(catalogRecord(), source, { fetchJson: async () => view() });
        expect(result.status).toBe('included');
        expect(result.value).toEqual(expect.objectContaining({
            externalId: 'abcd-1234',
            organization: expect.objectContaining({ placeId: 'sgc-csd-4806016' }),
            dataset: expect.objectContaining({ titleEn: 'Building permits' }),
            source: expect.objectContaining({
                isAuthoritative: true,
                licenseUrl: expect.stringContaining('Open-Calgary-Terms-of-Use')
            }),
            manageMaps: false,
            manageMapCandidates: true
        }));
        expect(result.value.resources).toEqual([expect.objectContaining({
            format: 'CSV',
            url: 'https://data.calgary.ca/api/views/abcd-1234/rows.csv?accessType=DOWNLOAD',
            raw: expect.objectContaining({ record_count: 42, field_count: 2 })
        })]);
        expect(result.value.mapCandidates).toEqual([expect.objectContaining({
            mode: 'socrata-geojson-pmtiles', expectedRows: 42,
            sourceUrl: 'https://data.calgary.ca/resource/abcd-1234.geojson',
            desiredVersion: expect.stringMatching(/^[0-9a-f]{64}$/)
        })]);
    });

    test('fails closed on publisher and record licence, and bounds map admission', async () => {
        const external = view({ metadata: { custom_fields: {
            'Data Supplier': { Organization: 'Government of Alberta' },
            'License/Attribution': { 'License URL': 'https://data.calgary.ca/d/Open-Data-Terms/u45n-7awa' }
        } } });
        await expect(enrichRecord(catalogRecord(), source, { fetchJson: async () => external }))
            .resolves.toEqual(expect.objectContaining({ status: 'excluded', reason: 'publisher-not-admitted' }));

        const genericTerms = view({ metadata: { custom_fields: {
            'Data Supplier': { Organization: 'The City of Calgary' },
            'License/Attribution': { 'License URL': 'https://data.calgary.ca/terms' }
        } } });
        await expect(enrichRecord(catalogRecord(), source, { fetchJson: async () => genericTerms }))
            .resolves.toEqual(expect.objectContaining({ status: 'excluded', reason: 'unlicensed' }));

        const tooLarge = view({ columns: view().columns.map(column => ({
            ...column, cachedContents: { count: '1000001' }
        })) });
        const included = await enrichRecord(catalogRecord(), source, { fetchJson: async () => tooLarge });
        expect(included.status).toBe('included');
        expect(included.value.mapCandidates).toEqual([]);
        expect(included.value.resources[0].raw.record_count).toBe(1000001);
    });

    test('treats Socrata legacy location columns as point-capable map data', async () => {
        const legacy = view({
            columns: [{
                fieldName: 'location', name: 'Location', dataTypeName: 'location',
                cachedContents: { count: '3' }
            }]
        });
        const result = await enrichRecord(catalogRecord(), source, { fetchJson: async () => legacy });
        expect(result.value.resources[0].raw.geometry_fields).toEqual([
            { name: 'location', alias: 'Location', type: 'location' }
        ]);
        expect(result.value.mapCandidates).toHaveLength(1);
    });

    test('uses exact fallback counts and builds only portal-local deterministic URLs', async () => {
        expect(cachedRecordCount(view())).toBe(42);
        expect(csvUrl(source, 'a b')).toBe('https://data.calgary.ca/api/views/a%20b/rows.csv?accessType=DOWNLOAD');
        expect(geoJsonPageUrl(source, 'a b', { limit: 10, offset: 20 }))
            .toBe('https://data.calgary.ca/resource/a%20b.geojson?%24limit=10&%24offset=20&%24order=%3Aid');
        expect(directMapVersion(view(), source, 42)).toBe(directMapVersion(view(), source, 42));

        const noCount = view({ columns: view().columns.map(({ cachedContents: _cachedContents, ...column }) => column) });
        const fetchJson = jest.fn()
            .mockResolvedValueOnce(noCount)
            .mockResolvedValueOnce([{ count: '17' }]);
        const result = await enrichRecord(catalogRecord(), source, { fetchJson });
        expect(result.value.resources[0].raw.record_count).toBe(17);
        expect(new URL(fetchJson.mock.calls[1][0]).origin).toBe('https://data.calgary.ca');
    });
});
