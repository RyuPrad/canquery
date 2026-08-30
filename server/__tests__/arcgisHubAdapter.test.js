const {
    identityFor,
    namespaceFor,
    canonicalKey,
    idsFor,
    publisherName,
    licenseFor,
    isAuthoritative,
    serviceIsLeaf,
    enrichRecord
} = require('../services/arcgisHubAdapter');
const { getSource, HAMILTON_LICENSE } = require('../config/catalogSources');

describe('arcgisHubAdapter', () => {
    describe('identityFor', () => {
        test('extracts 32-char hex identifier directly', () => {
            const record = { identifier: '1234567890abcdef1234567890abcdef' };
            expect(identityFor(record)).toEqual({
                itemId: '1234567890abcdef1234567890abcdef',
                layerId: null
            });
        });

        test('extracts item id and layer id from distribution accessURL', () => {
            const record = {
                distribution: [{
                    accessURL: 'https://services.arcgis.com/org/arcgis/rest/services/Trees/FeatureServer/2'
                }],
                landingPage: 'https://hub.arcgis.com/datasets/org::trees?id=1234567890abcdef1234567890abcdef'
            };
            expect(identityFor(record)).toEqual({
                itemId: '1234567890abcdef1234567890abcdef',
                layerId: 2
            });
        });

        test('extracts item id from /items/<id> path in landingPage', () => {
            const record = {
                landingPage: 'https://hub.arcgis.com/items/abcdef1234567890abcdef1234567890'
            };
            expect(identityFor(record)).toEqual({
                itemId: 'abcdef1234567890abcdef1234567890',
                layerId: null
            });
        });

        test('returns null when no item id can be found', () => {
            const record = {
                landingPage: 'https://example.com/invalid'
            };
            expect(identityFor(record)).toBeNull();
        });
    });

    describe('canonicalKey and idsFor', () => {
        test('formats canonicalKey without layerId', () => {
            expect(canonicalKey({ itemId: 'abc1234', layerId: null })).toBe('abc1234');
        });

        test('formats canonicalKey with layerId', () => {
            expect(canonicalKey({ itemId: 'abc1234', layerId: 3 })).toBe('abc1234_3');
        });

        test('generates expected namespaced IDs', () => {
            const ids = idsFor({ itemId: 'abc1234', layerId: 0 });
            expect(ids).toEqual({
                datasetId: 'arcgis-item-abc1234_0',
                datasetName: 'arcgis-item-abc1234_0',
                resourceId: 'arcgis-res-abc1234_0'
            });
        });
    });

    describe('namespaceFor', () => {
        test('extracts hostname from landingPage', () => {
            expect(namespaceFor({ landingPage: 'https://open.ottawa.ca/datasets/test' })).toBe('open.ottawa.ca');
        });

        test('returns null on missing or invalid landingPage', () => {
            expect(namespaceFor({})).toBeNull();
            expect(namespaceFor({ landingPage: 'invalid-url' })).toBeNull();
        });
    });

    describe('publisherName and aliases', () => {
        const source = {
            nameEn: 'City of Hamilton Open Data',
            publisherAliases: [
                { publisher: /^city of hamilton$/i, name: 'City of Hamilton' },
                { publisher: /^city of hamilton;\s*public works/i, name: 'City of Hamilton - Public Works' }
            ]
        };

        test('uses aliased publisher when matching pattern', () => {
            const record = { publisher: { name: 'City of Hamilton; Public Works; Hamilton Water' } };
            expect(publisherName(record, {}, source)).toBe('City of Hamilton - Public Works');
        });

        test('falls back to item owner if publisher name absent', () => {
            const record = {};
            const item = { owner: 'City of Hamilton' };
            expect(publisherName(record, item, source)).toBe('City of Hamilton');
        });

        test('falls back to source nameEn if all absent', () => {
            expect(publisherName({}, {}, source)).toBe('City of Hamilton Open Data');
        });
    });

    describe('licenseFor', () => {
        const source = {
            restrictedLicensePatterns: [/non.?commercial/i, /personal use only/i],
            licenseRules: [
                {
                    publisher: /hamilton/i,
                    license: HAMILTON_LICENSE
                }
            ]
        };

        test('returns matched license rule when unrestricted', () => {
            const record = { license: 'Open Data Licence' };
            const item = {};
            expect(licenseFor(record, item, source, 'open.hamilton.ca', 'City of Hamilton')).toEqual(HAMILTON_LICENSE);
        });

        test('rejects record when license contains restricted pattern', () => {
            const record = { license: 'For Non-Commercial Educational Use Only' };
            const item = {};
            expect(licenseFor(record, item, source, 'open.hamilton.ca', 'City of Hamilton')).toBeNull();
        });
    });

    describe('serviceIsLeaf', () => {
        test('returns true for Feature Layer or Table', () => {
            expect(serviceIsLeaf({ type: 'Feature Layer' })).toBe(true);
            expect(serviceIsLeaf({ type: 'Table' })).toBe(true);
        });

        test('returns false for Group Layer with sublayers', () => {
            expect(serviceIsLeaf({ type: 'Group Layer', layers: [{ id: 1 }, { id: 2 }] })).toBe(false);
        });
    });

    describe('enrichRecord', () => {
        const source = getSource('hamilton-hub');

        test('successfully enriches a valid ArcGIS Hub item record', async () => {
            const record = {
                identifier: '1234567890abcdef1234567890abcdef',
                title: 'Hamilton Bike Routes',
                description: 'City of Hamilton cycle network routes.',
                landingPage: 'https://open.hamilton.ca/datasets/bike-routes',
                publisher: { name: 'City of Hamilton; Public Works; Transportation Operations & Maintenance' },
                distribution: [
                    {
                        accessURL: 'https://services.arcgis.com/org/arcgis/rest/services/Bike_Routes/FeatureServer/0',
                        mediaType: 'application/json',
                        format: 'Feature Layer'
                    }
                ]
            };

            const mockItem = {
                id: '1234567890abcdef1234567890abcdef',
                title: 'Hamilton Bike Routes',
                description: 'Cycle network',
                tags: ['cycling', 'roads', 'transportation'],
                url: 'https://services.arcgis.com/org/arcgis/rest/services/Bike_Routes/FeatureServer'
            };

            const mockLayerMeta = {
                id: 0,
                name: 'Bike Routes Layer',
                type: 'Feature Layer'
            };

            const mockFetch = jest.fn()
                .mockResolvedValueOnce(mockItem)
                .mockResolvedValueOnce(mockLayerMeta);

            const result = await enrichRecord(record, source, { fetchJson: mockFetch });

            expect(result.status).toBe('included');
            expect(result.externalId).toBe('1234567890abcdef1234567890abcdef_0');
            expect(result.dataset.title_en).toBe('Hamilton Bike Routes');
            expect(result.dataset.license_title).toBe('City of Hamilton Open Data Licence');
            expect(result.places).toEqual([{
                place_id: 'sgc-cd-3525',
                relationship: 'direct',
                includes_descendants: false
            }]);
            expect(result.map).toEqual({
                resource_id: 'arcgis-res-1234567890abcdef1234567890abcdef_0',
                mode: 'arcgis-feature-layer',
                service_url: 'https://services.arcgis.com/org/arcgis/rest/services/Bike_Routes/FeatureServer/0',
                layer_id: 0
            });
        });

        test('excludes record with non-commercial license terms', async () => {
            const record = {
                identifier: '1234567890abcdef1234567890abcdef',
                title: 'Private Survey',
                license: 'Non-Commercial Use Only',
                landingPage: 'https://open.hamilton.ca/datasets/private'
            };

            const mockItem = { id: '1234567890abcdef1234567890abcdef', title: 'Private Survey' };
            const mockFetch = jest.fn().mockResolvedValueOnce(mockItem);

            const result = await enrichRecord(record, source, { fetchJson: mockFetch });
            expect(result.status).toBe('excluded');
            expect(result.reason).toBe('license-not-admitted');
        });
    });
});
