const {
    discover,
    enrichRecord,
    csvUrl,
    geoJsonPageUrl,
    directMapVersion,
    cachedRecordCount,
    validateSource
} = require('../services/socrataAdapter');
const { getSource } = require('../config/catalogSources');

const source = getSource('calgary-open-data');
const edmonton = getSource('edmonton-open-data');
const winnipeg = getSource('winnipeg-open-data');

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
    test('discovers one bounded catalogue snapshot and rejects truncation or duplicates', async () => {
        const records = Array.from({ length: 201 }, (_, index) => catalogRecord('id-' + index));
        const fetchJson = jest.fn(async value => {
            const url = new URL(value);
            expect(url.searchParams.get('only')).toBe('datasets');
            expect(url.searchParams.get('search_context')).toBe('data.calgary.ca');
            expect(url.searchParams.get('limit')).toBe('5000');
            expect(url.searchParams.get('offset')).toBe('0');
            return { resultSetSize: records.length, results: records };
        });
        await expect(discover(source, { fetchJson })).resolves.toEqual(records);
        expect(fetchJson).toHaveBeenCalledTimes(1);

        await expect(discover(source, { fetchJson: async () => ({
            resultSetSize: 5001, results: records
        }) })).rejects.toThrow(/safe snapshot limit/);
        await expect(discover(source, { fetchJson: async () => ({
            resultSetSize: 202, results: records
        }) })).rejects.toThrow(/advertised count/);
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

    test('admits only explicitly attributed Edmonton records under the portal terms', async () => {
        const allowedView = view({
            attribution: ' The City of Edmonton ',
            license: { name: 'See Terms of Use' },
            metadata: { custom_fields: {} }
        });
        const result = await enrichRecord(catalogRecord(), edmonton, {
            fetchJson: async () => allowedView
        });
        expect(result.status).toBe('included');
        expect(result.value).toEqual(expect.objectContaining({
            organization: expect.objectContaining({
                id: 'socrata-edmonton-open-data-org-city-of-edmonton',
                placeId: 'sgc-csd-4811061'
            }),
            source: expect.objectContaining({
                licenseUrl: expect.stringContaining('City-of-Edmonton-Open-Data-Terms-of-Use'),
                raw: expect.objectContaining({
                    publisher_evidence: 'The City of Edmonton',
                    publisher_evidence_mode: 'attribution',
                    license_evidence: 'See Terms of Use',
                    license_evidence_mode: 'view-license-name'
                })
            })
        }));
        expect(result.value.resources[0].url)
            .toBe('https://data.edmonton.ca/api/views/abcd-1234/rows.csv?accessType=DOWNLOAD');

        for (const attribution of ['', 'EPCOR']) {
            await expect(enrichRecord(catalogRecord(), edmonton, {
                fetchJson: async () => ({ ...allowedView, attribution })
            })).resolves.toEqual(expect.objectContaining({
                status: 'excluded', reason: 'publisher-not-admitted'
            }));
        }
        await expect(enrichRecord(catalogRecord(), edmonton, {
            fetchJson: async () => ({ ...allowedView, license: { name: 'Canada Open Government Licence' } })
        })).resolves.toEqual(expect.objectContaining({ status: 'excluded', reason: 'unlicensed' }));
    });

    test('uses Winnipeg record-specific licence evidence and rejects external publishers', async () => {
        const allowedView = view({
            attribution: null,
            license: { name: 'Open Government Licence - Prince Edward Island' },
            metadata: { custom_fields: {
                Licence: { Licence: 'Open Government Licence - Winnipeg' }
            } }
        });
        const result = await enrichRecord(catalogRecord(), winnipeg, {
            fetchJson: async () => allowedView
        });
        expect(result.status).toBe('included');
        expect(result.value).toEqual(expect.objectContaining({
            organization: expect.objectContaining({
                id: 'socrata-winnipeg-open-data-org-city-of-winnipeg',
                placeId: 'sgc-csd-4611040'
            }),
            source: expect.objectContaining({
                licenseUrl: 'https://data.winnipeg.ca/open-data-licence',
                raw: expect.objectContaining({
                    publisher_evidence: null,
                    license_evidence: 'Open Government Licence - Winnipeg'
                })
            })
        }));

        await expect(enrichRecord(catalogRecord(), winnipeg, {
            fetchJson: async () => ({ ...allowedView, attribution: 'Winnipeg Transit' })
        })).resolves.toEqual(expect.objectContaining({ status: 'included' }));
        await expect(enrichRecord(catalogRecord(), winnipeg, {
            fetchJson: async () => ({ ...allowedView, attribution: 'Province of Manitoba' })
        })).resolves.toEqual(expect.objectContaining({
            status: 'excluded', reason: 'publisher-not-admitted'
        }));
        await expect(enrichRecord(catalogRecord(), winnipeg, {
            fetchJson: async () => ({
                ...allowedView,
                metadata: { custom_fields: {} },
                license: { name: 'Canada Open Government Licence' }
            })
        })).resolves.toEqual(expect.objectContaining({ status: 'excluded', reason: 'unlicensed' }));
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

    test('rejects incomplete or unknown Socrata admission configuration before fetching', () => {
        expect(() => validateSource({ ...source, socrataPolicy: null })).toThrow(/policy is missing/);
        expect(() => validateSource({
            ...source,
            socrataPolicy: {
                ...source.socrataPolicy,
                license: { ...source.socrataPolicy.license, mode: 'arbitrary-path' }
            }
        })).toThrow(/invalid license evidence mode/);
        expect(() => validateSource({ ...source, defaultOrganizationId: '' }))
            .toThrow(/configuration is incomplete/);
    });
});
