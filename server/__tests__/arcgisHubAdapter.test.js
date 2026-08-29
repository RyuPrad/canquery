const adapter = require('../services/arcgisHubAdapter');
const { getSource } = require('../config/catalogSources');

const ITEM_ID = '0123456789abcdef0123456789abcdef';

function record(overrides = {}) {
    return {
        identifier: 'https://www.arcgis.com/home/item.html?id=' + ITEM_ID + '&sublayer=2',
        landingPage: 'https://city-oshawa.opendata.arcgis.com/datasets/oshawa::roads/about',
        title: 'Roads <b>2026</b>',
        description: '<p>Public <strong>road</strong> data.</p><script>bad()</script>',
        publisher: { name: 'City of Oshawa' },
        license: 'Oshawa Open Government Licence',
        keyword: ['roads', 'transportation'],
        spatial: '-79,43.8,-78.7,44',
        modified: '2026-08-01T00:00:00Z',
        distribution: [{
            format: 'ArcGIS GeoServices REST API',
            accessURL: 'https://services.arcgis.com/example/FeatureServer/2'
        }],
        ...overrides
    };
}

describe('ArcGIS Hub adapter', () => {
    test('normalizes a spatial leaf into a loadable snapshot, place link and live map', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return { owner: 'OshawaGIS', type: 'Feature Service', size: 1234, tags: ['roads'] };
            }
            return {
                type: 'Feature Layer',
                geometryType: 'esriGeometryPolyline',
                objectIdField: 'OBJECTID',
                displayField: 'ROAD_NAME',
                extent: {
                    xmin: -79, ymin: 43.8, xmax: -78.7, ymax: 44,
                    spatialReference: { wkid: 4326 }
                },
                fields: [
                    { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'Id' },
                    { name: 'ROAD_NAME', type: 'esriFieldTypeString', alias: 'Road Name' }
                ]
            };
        });

        const result = await adapter.enrichRecord(record(), getSource('oshawa-hub'), { fetchJson });
        expect(result.status).toBe('included');
        expect(result.value.dataset.titleEn).toBe('Roads 2026');
        expect(result.value.dataset.notesEn).toBe('Public road data.');
        expect(result.value.organization.titleEn).toBe('City of Oshawa');
        expect(result.value.places).toEqual([
            { placeId: 'ca-on-oshawa', relationship: 'direct', includesDescendants: false }
        ]);
        expect(result.value.source).toEqual(expect.objectContaining({
            sourceId: 'oshawa-hub',
            isAuthoritative: true,
            licenseUrl: 'https://map.oshawa.ca/OpenData/Open%20Government%20Licence%20version%202.0%20-%20Oshawa.pdf'
        }));
        expect(result.value.mapIndex).toEqual(expect.objectContaining({
            status: 'ready',
            mode: 'arcgis-feature-layer',
            layerName: 'Roads 2026',
            featureCount: null,
            geometryType: 'polyline',
            extent: [-79, 43.8, -78.7, 44]
        }));
    });

    test('excludes unparseable item identifiers and non-feature items', async () => {
        const source = getSource('oshawa-hub');
        const badId = await adapter.enrichRecord({
            ...record(),
            identifier: 'https://example.com/not-an-item'
        }, source, { fetchJson: jest.fn() });
        expect(badId).toEqual({ status: 'excluded', reason: 'missing-item-id', externalId: null });

        const fetchJson = jest.fn(async () => ({ owner: 'OshawaGIS', type: 'Web Map' }));
        const nonFeature = await adapter.enrichRecord(record(), source, { fetchJson });
        expect(nonFeature).toEqual({
            status: 'excluded',
            reason: 'unsupported-item-type',
            externalId: ITEM_ID + ':2'
        });
    });

    test('excludes items when ArcGIS metadata fetch fails', async () => {
        const source = getSource('oshawa-hub');
        const fetchJson = jest.fn(async () => {
            throw new Error('500 internal server error');
        });
        const raw = record();
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result).toEqual({
            status: 'excluded',
            reason: 'item-metadata-failed',
            externalId: ITEM_ID + ':2'
        });
    });

    test('applies exact Ottawa Police terms and rejects unknown external publishers', async () => {
        const fetchJson = jest.fn(async () => ({
            owner: 'OttawaPoliceService',
            type: 'Feature Service'
        }));
        const source = getSource('ottawa-hub');
        const police = await adapter.enrichRecord({
            ...record(),
            publisher: { name: 'Ottawa Police Service' },
            license: 'https://data.ottawapolice.ca/pages/open-data-licence'
        }, source, { fetchJson });
        expect(police.value.source).toEqual(expect.objectContaining({
            licenseTitleEn: 'Open Government Licence – Ottawa Police Service',
            licenseUrl: 'https://data.ottawapolice.ca/pages/open-data-licence'
        }));

        const external = await adapter.enrichRecord({
            ...record(),
            publisher: { name: 'Third Party Contractor' },
            license: 'https://data.ottawapolice.ca/pages/open-data-licence'
        }, source, { fetchJson });
        expect(external).toEqual({
            status: 'excluded',
            reason: 'unauthorized-publisher',
            externalId: ITEM_ID + ':2'
        });
    });

    test('applies Halifax portal terms only to exact HRM publisher evidence', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'HRMGIS', type: 'Feature Service' }
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
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
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
            placeId: 'ca-on-oshawa', relationship: 'direct', includesDescendants: false
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
        expect(allowed.value.source.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');

        const missing = await adapter.enrichRecord({ ...bramptonRecord, license: null }, source, { fetchJson });
        expect(missing).toEqual({ status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2' });

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
            licenseUrl: 'https://data.peelregion.ca/pages/license'
        }));

        const custom = await adapter.enrichRecord({
            ...peelRecord,
            publisher: { name: 'Canada Mortgage and Housing Corporation' },
            license: 'https://www.cmhc-schl.gc.ca/en/data-and-research/cmhc-licence-agreement-use-of-data'
        }, source, { fetchJson });
        expect(custom).toEqual({ status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2' });

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
