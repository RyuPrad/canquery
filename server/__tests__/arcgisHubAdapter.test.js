const adapter = require('../services/arcgisHubAdapter');
const { sources, getSource } = require('../config/catalogSources');

const ITEM_ID = '0123456789abcdef0123456789abcdef';

function record(overrides = {}) {
    return {
        identifier: 'https://www.arcgis.com/home/item.html?id=' + ITEM_ID + '&sublayer=2',
        landingPage: 'https://data-hrm.hub.arcgis.com/datasets/hrm::zoning',
        title: 'Halifax Land Use Zoning',
        description: '<p>Zoning bylaws for Halifax Regional Municipality.</p>',
        publisher: { name: 'Halifax Regional Municipality' },
        keyword: ['land use', 'zoning', 'planning'],
        modified: '2026-08-01T00:00:00.000Z',
        spatial: '-63.6,44.6,-63.5,44.7',
        distribution: [
            {
                accessURL: 'https://services.arcgis.com/example/FeatureServer/2',
                format: 'ArcGIS GeoServices REST API'
            }
        ],
        ...overrides
    };
}

describe('ArcGIS Hub adapter', () => {
    test('extracts itemId and sublayer from canonical URLs', () => {
        expect(adapter.identityFor({
            identifier: 'https://www.arcgis.com/home/item.html?id=' + ITEM_ID + '&sublayer=4'
        })).toEqual({ itemId: ITEM_ID, layerId: 4 });

        expect(adapter.identityFor({
            identifier: 'https://www.arcgis.com/home/item.html?id=' + ITEM_ID
        })).toEqual({ itemId: ITEM_ID, layerId: null });

        expect(adapter.identityFor({ identifier: 'invalid-url' })).toBeNull();
    });

    test('enriches Halifax ArcGIS Hub records under Open Government Licence – Halifax', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return {
                    owner: 'HRM_Admin',
                    licenseInfo: 'Open Government Licence – Halifax',
                    type: 'Feature Service'
                };
            }
            return {
                type: 'Feature Layer',
                geometryType: 'esriGeometryPolygon',
                objectIdField: 'OBJECTID',
                displayField: 'ZONE_NAME',
                extent: {
                    xmin: -63.6, ymin: 44.6, xmax: -63.5, ymax: 44.7,
                    spatialReference: { latestWkid: 4326 }
                },
                fields: [
                    { name: 'OBJECTID' },
                    { name: 'ZONE_NAME' }
                ]
            };
        });

        const source = getSource('halifax-hub');
        const result = await adapter.enrichRecord(record(), source, { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe('Halifax Regional Municipality');
        expect(result.value.dataset.id).toBe('arcgis-' + ITEM_ID + '-2');
        expect(result.value.dataset.titleEn).toBe('Halifax Land Use Zoning');
        expect(result.value.resource.format).toBe('CSV');
        expect(result.value.resource.url).toBe('https://hub.arcgis.com/api/download/v1/items/' + ITEM_ID + '/csv?layers=2');
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – Halifax',
            licenseUrl: 'https://www.halifax.ca/home/open-data/open-data-licence'
        }));
        expect(result.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-1209034',
            relationship: 'direct',
            includesDescendants: false
        }));
        expect(result.value.map).toEqual(expect.objectContaining({
            geometryType: 'polygon',
            objectIdField: 'OBJECTID',
            displayField: 'ZONE_NAME',
            extent: [-63.6, 44.6, -63.5, 44.7]
        }));
    });

    test('applies Halifax portal terms only to exact HRM publisher evidence', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'HalifaxHRM', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const source = getSource('halifax-hub');
        const cityRecord = record({
            landingPage: 'https://data-hrm.hub.arcgis.com/datasets/hrm::zoning',
            publisher: { name: 'Halifax Regional Municipality' },
            license: null
        });
        const city = await adapter.enrichRecord(cityRecord, source, { fetchJson });

        expect(city.status).toBe('included');
        expect(city.value.organization.titleEn).toBe('Halifax Regional Municipality');
        expect(city.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-1209034', relationship: 'direct', includesDescendants: false
        }));

        const external = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: 'Ministry of Education' },
            license: null
        }, source, { fetchJson });
        expect(external).toEqual({
            status: 'included',
            value: expect.objectContaining({
                source: expect.objectContaining({
                    isAuthoritative: false
                })
            })
        });
    });

    test('enforces Hamilton and Surrey portal licensing and detects external layers', async () => {
        const makeFetch = owner => jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner, type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });

        const hamiltonSource = getSource('hamilton-hub');
        const hamiltonRecord = record({
            landingPage: 'https://open.hamilton.ca/datasets/hamilton::zoning',
            publisher: { name: 'City of Hamilton' }
        });
        const hamilton = await adapter.enrichRecord(hamiltonRecord, hamiltonSource, { fetchJson: makeFetch('CityofHamilton') });
        expect(hamilton.status).toBe('included');
        expect(hamilton.value.organization.titleEn).toBe('City of Hamilton');
        expect(hamilton.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3525', relationship: 'direct', includesDescendants: false
        }));

        const surreySource = getSource('surrey-hub');
        const surreyRecord = record({
            landingPage: 'https://opendata-surrey.hub.arcgis.com/datasets/surrey::parks',
            publisher: { name: 'City of Surrey' }
        });
        const surrey = await adapter.enrichRecord(surreyRecord, surreySource, { fetchJson: makeFetch('CityofSurrey') });
        expect(surrey.status).toBe('included');
        expect(surrey.value.organization.titleEn).toBe('City of Surrey');
        expect(surrey.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5915004', relationship: 'direct', includesDescendants: false
        }));
    });

    test('maps Oshawa, Ajax, Pickering, Whitby and regional Durham items accurately', async () => {
        const makeFetch = owner => jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner, type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });

        const oshawaSource = getSource('oshawa-hub');
        const oshawaRecord = record({
            landingPage: 'https://city-oshawa.opendata.arcgis.com/datasets/oshawa::parks',
            publisher: { name: 'City of Oshawa' }
        });
        const oshawa = await adapter.enrichRecord(oshawaRecord, oshawaSource, { fetchJson: makeFetch('OshawaGIS') });
        expect(oshawa.status).toBe('included');
        expect(oshawa.value.organization.titleEn).toBe('City of Oshawa');
        expect(oshawa.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518013', relationship: 'direct', includesDescendants: false
        }));

        const ajaxSource = getSource('ajax-hub');
        const ajaxRecord = record({
            landingPage: 'https://opendata.ajax.ca/datasets/ajax::trails',
            publisher: { name: 'Town of Ajax' }
        });
        const ajax = await adapter.enrichRecord(ajaxRecord, ajaxSource, { fetchJson: makeFetch('TownOfAjax') });
        expect(ajax.status).toBe('included');
        expect(ajax.value.organization.titleEn).toBe('Town of Ajax');
        expect(ajax.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518005', relationship: 'direct', includesDescendants: false
        }));

        const pickeringSource = getSource('pickering-hub');
        const pickeringRecord = record({
            landingPage: 'https://opendata.pickering.ca/datasets/pickering::wards',
            publisher: { name: 'City of Pickering' }
        });
        const pickering = await adapter.enrichRecord(pickeringRecord, pickeringSource, { fetchJson: makeFetch('CityOfPickering') });
        expect(pickering.status).toBe('included');
        expect(pickering.value.organization.titleEn).toBe('City of Pickering');
        expect(pickering.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518001', relationship: 'direct', includesDescendants: false
        }));
    });

    test('admits only explicit Brampton CC BY or Statistics Canada records', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'Brampton', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('brampton-hub');
        const bramptonRecord = record({
            landingPage: 'https://geohub.brampton.ca/datasets/brampton::parks',
            publisher: { name: 'City of Brampton' },
            license: 'https://creativecommons.org/licenses/by/4.0'
        });
        const allowed = await adapter.enrichRecord(bramptonRecord, source, { fetchJson });
        expect(allowed.status).toBe('included');
        expect(allowed.value.places[0].placeId).toBe('sgc-csd-3521010');
        expect(allowed.value.source.licenseUrl).toBe('https://www.ontario.ca/page/open-government-licence-ontario');

        const missing = await adapter.enrichRecord({ ...bramptonRecord, license: null }, source, { fetchJson });
        expect(missing.status).toBe('included');

        const restricted = await adapter.enrichRecord({
            ...bramptonRecord,
            license: 'Reproduction is permitted for non-commercial purposes only.'
        }, source, { fetchJson });
        expect(restricted).toEqual({ status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2' });
    });

    test('uses recognized Peel licences and keeps regional third-party records non-authoritative', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'RegionOfPeel', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolyline', fields: [] });
        const source = getSource('peel-hub');
        const peelRecord = record({
            landingPage: 'https://data.peelregion.ca/datasets/RegionofPeel::roads',
            publisher: { name: 'Region of Peel - Corporate Services' },
            license: 'https://data.peelregion.ca/pages/license'
        });
        const regional = await adapter.enrichRecord(peelRecord, source, { fetchJson });
        expect(regional.status).toBe('included');
        expect(regional.value.places[0].placeId).toBe('sgc-cd-3521');
        expect(regional.value.places[0].includesDescendants).toBe(true);
        expect(regional.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseUrl: 'https://data.peelregion.ca/pages/terms-of-use'
        }));

        const custom = await adapter.enrichRecord({
            ...peelRecord,
            publisher: { name: 'Canada Mortgage and Housing Corporation' },
            license: 'https://www.cmhc-schl.gc.ca/en/data-and-research/cmhc-licence-agreement-use-of-data'
        }, source, { fetchJson });
        expect(custom.status).toBe('included');

        const websiteTerms = await adapter.enrichRecord({
            ...peelRecord,
            license: 'https://www.peelregion.ca/privacy/terms-of-use.asp'
        }, source, { fetchJson });
        expect(websiteTerms).toEqual({ status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2' });
    });

    test('rejects group layers instead of presenting them as downloadable tables', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'OshawaGIS', type: 'Feature Service' }
            : { type: 'Group Layer' });
        const result = await adapter.enrichRecord(record(), getSource('oshawa-hub'), { fetchJson });
        expect(result).toEqual({ status: 'excluded', reason: 'non-leaf-layer', externalId: ITEM_ID + ':2' });
    });

    test('extracts canonical item/layer identities and strips unsafe markup', () => {
        expect(adapter.identityFor(record())).toEqual({ itemId: ITEM_ID, layerId: 2 });
        expect(adapter.htmlToText('<p>A &amp; B</p><style>x</style><script>y</script>')).toBe('A & B');
    });

    test('enriches Saint John ArcGIS Hub records under Open Government Licence – City of Saint John', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'CityOfSaintJohn', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const source = getSource('saint-john-hub');
        const sjRecord = record({
            landingPage: 'https://catalogue-saintjohn.opendata.arcgis.com/datasets/SaintJohn::zoning',
            publisher: { name: 'City of Saint John' },
            license: 'Open Government Licence – City of Saint John'
        });
        const result = await adapter.enrichRecord(sjRecord, source, { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe('City of Saint John');
        expect(result.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-1301006', relationship: 'direct', includesDescendants: false
        }));
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – City of Saint John',
            licenseUrl: 'https://catalogue-saintjohn.opendata.arcgis.com/pages/open-government-licence-city-of-saint-john'
        }));
    });
});
