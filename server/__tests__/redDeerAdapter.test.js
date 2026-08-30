const adapter = require('../services/redDeerAdapter');
const { getSource } = require('../config/catalogSources');

const source = getSource('red-deer-hub');
const record = {
    dataUrl: 'https://data.reddeer.ca/api/datasets/building-permits?skip=0&take=50',
    metaDataUrl: 'https://data.reddeer.ca/api/datasets/building-permits/metadata',
    name: 'Building Permits',
    description: 'Building permits issued monthly by The City of Red Deer',
    category: 'Inspections & Licensing',
    formats: 'Excel, CSV, JSON',
    keywords: 'Building, Permit, Construction',
    owner: 'Inspections & Licensing',
    lastUpdateDate: '2026-08-29T04:00:04.017'
};

describe('Red Deer catalogue adapter', () => {
    test('discovers a complete exact-host catalogue', async () => {
        const result = await adapter.discover(source, {
            fetchJson: jest.fn().mockResolvedValue({ totalCount: 1, datasets: [record] })
        });

        expect(result).toEqual([record]);
    });

    test('rejects incomplete catalogues and off-host dataset URLs', async () => {
        await expect(adapter.discover(source, {
            fetchJson: jest.fn().mockResolvedValue({ totalCount: 2, datasets: [record] })
        })).rejects.toThrow('invalid or incomplete');

        await expect(adapter.discover(source, {
            fetchJson: jest.fn().mockResolvedValue({
                totalCount: 1,
                datasets: [{ ...record, dataUrl: 'https://example.com/api/datasets/building-permits' }]
            })
        })).rejects.toThrow('outside its configured HTTPS host');
    });

    test('normalizes official downloads, licence provenance, and direct place coverage', async () => {
        const result = await adapter.enrichRecord(record, source);

        expect(result.status).toBe('included');
        expect(result.value.dataset).toEqual(expect.objectContaining({
            id: 'red-deer-building-permits',
            titleEn: 'Building Permits',
            keywordsEn: ['Building', 'Permit', 'Construction']
        }));
        expect(result.value.resources).toEqual([
            expect.objectContaining({
                id: 'red-deer-building-permits-excel', format: 'XLSX',
                url: 'https://data.reddeer.ca/datasets/buildingpermits/download/excel'
            }),
            expect.objectContaining({
                id: 'red-deer-building-permits-csv', format: 'CSV',
                url: 'https://data.reddeer.ca/datasets/buildingpermits/download/csv'
            }),
            expect.objectContaining({
                id: 'red-deer-building-permits-json', format: 'JSON',
                url: 'https://data.reddeer.ca/datasets/buildingpermits/download/json'
            })
        ]);
        expect(result.value.source).toEqual(expect.objectContaining({
            sourceId: 'red-deer-hub', isAuthoritative: true,
            licenseUrl: 'https://data.reddeer.ca/about'
        }));
        expect(result.value.places).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4808011', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('excludes unsupported downloads and missing licence configuration', async () => {
        await expect(adapter.enrichRecord({ ...record, formats: 'MrSID' }, source)).resolves.toEqual({
            status: 'excluded', reason: 'not-loadable', externalId: 'building-permits'
        });
        await expect(adapter.enrichRecord(record, { ...source, license: null })).resolves.toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: 'building-permits'
        });
    });
});
