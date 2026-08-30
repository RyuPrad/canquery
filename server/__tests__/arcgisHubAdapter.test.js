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
                maxRecordCount: 2000,
                extent: { xmin: -79, ymin: 43.8, xmax: -78.7, ymax: 44, spatialReference: { wkid: 4326 } },
                fields: [
                    { name: 'OBJECTID', alias: 'Object ID', type: 'esriFieldTypeOID' },
                    { name: 'ROAD_NAME', alias: 'Road name', type: 'esriFieldTypeString' }
                ]
            };
        });

        const result = await adapter.enrichRecord(record(), getSource('oshawa-hub'), { fetchJson });
        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe('City of Oshawa');
        expect(result.value.places).toEqual([{
            datasetId: 'arcgis-' + ITEM_ID + '-2',
            placeId: 'ca-on-oshawa',
            relationship: 'direct',
            includesDescendants: false,
            assignmentMethod: 'source'
        }]);
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – The Corporation of the City of Oshawa'
        }));
        expect(result.value.resource).toEqual(expect.objectContaining({
            format: 'CSV',
            url: 'https://hub.arcgis.com/api/download/v1/items/' + ITEM_ID + '/csv?layers=2'
        }));
        expect(result.value.map).toEqual(expect.objectContaining({
            geometryType: 'polyline',
            objectIdField: 'OBJECTID',
            displayField: 'ROAD_NAME',
            fields: ['OBJECTID', 'ROAD_NAME']
        }));
    });

    test('canonicalizes a placeholder Pickering publisher from the ArcGIS owner', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'CityOfPickering', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const result = await adapter.enrichRecord(record({
            landingPage: 'https://data-pickering.opendata.arcgis.com/datasets/pickering::parks',
            publisher: { name: '{{source}}' },
            license: 'Pickering Open Licence'
        }), getSource('pickering-hub'), { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe('City of Pickering');
        expect(result.value.places[0].placeId).toBe('sgc-csd-3518001');
        expect(result.value.source.isAuthoritative).toBe(true);
    });

    test('admits only records carrying Whitby open-licence evidence', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'WhitbyGIS', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('whitby-hub');
        const allowed = await adapter.enrichRecord(record({
            landingPage: 'https://whitby.maps.arcgis.com/datasets/whitby::trails',
            publisher: { name: 'Town of Whitby' },
            license: 'https://whitby.maps.arcgis.com/sharing/rest/content/items/223810efc31c40b3aff99dd74f809a97/data'
        }), source, { fetchJson });
        expect(allowed.status).toBe('included');

        const excluded = await adapter.enrichRecord(record({
            landingPage: 'https://whitby.maps.arcgis.com/datasets/whitby::trails',
            publisher: { name: 'Town of Whitby' },
            license: null
        }), source, { fetchJson });
        expect(excluded).toEqual({ status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2' });
    });

    test('marks mirrored Durham records non-authoritative and the regional copy authoritative', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'DurhamRegion', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const oshawaSource = getSource('oshawa-hub');
        const regionalSource = getSource('durham-hub');
        const recordPayload = record({
            landingPage: 'https://opendata.durham.ca/datasets/durham::boundaries',
            publisher: { name: 'Regional Municipality of Durham' },
            license: 'Region of Durham Open Data Licence'
        });

        const mirrored = await adapter.enrichRecord(recordPayload, oshawaSource, { fetchJson });
        expect(mirrored.status).toBe('included');
        expect(mirrored.value.organization.titleEn).toBe('Regional Municipality of Durham');
        expect(mirrored.value.places[0].placeId).toBe('ca-on-durham');
        expect(mirrored.value.places[0].includesDescendants).toBe(true);
        expect(mirrored.value.source.isAuthoritative).toBe(false);

        const regional = await adapter.enrichRecord(recordPayload, regionalSource, { fetchJson });
        expect(regional.status).toBe('included');
        expect(regional.value.source.isAuthoritative).toBe(true);
    });

    test('applies Mississauga portal terms while preserving explicit Statistics Canada licensing', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'CityOfMississauga', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('mississauga-hub');
        const cityRecord = record({
            landingPage: 'https://data.mississauga.ca/datasets/mississauga::parks',
            publisher: { name: 'City of Mississauga' },
            license: '<p>Standard portal terms</p>'
        });
        const city = await adapter.enrichRecord(cityRecord, source, { fetchJson });
        expect(city.status).toBe('included');
        expect(city.value.organization.titleEn).toBe('City of Mississauga');
        expect(city.value.places[0].placeId).toBe('sgc-csd-3521005');
        expect(city.value.source.isAuthoritative).toBe(true);
        expect(city.value.source.licenseTitleEn).toBe('City of Mississauga Open Data Terms of Use');

        const statCanRecord = record({
            landingPage: 'https://data.mississauga.ca/datasets/mississauga::census',
            publisher: { name: 'Statistics Canada' },
            license: 'https://www.statcan.gc.ca/en/reference/licence'
        });
        const statCan = await adapter.enrichRecord(statCanRecord, source, { fetchJson });
        expect(statCan.status).toBe('included');
        expect(statCan.value.organization.titleEn).toBe('Statistics Canada');
        expect(statCan.value.source.isAuthoritative).toBe(false);
        expect(statCan.value.source.licenseUrl).toBe('https://www.statcan.gc.ca/en/reference/licence');
    });

    test('applies Ottawa portal terms while preserving explicit Police licensing', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'OttawaGIS', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const source = getSource('ottawa-hub');

        const city = await adapter.enrichRecord(record({
            landingPage: 'https://open.ottawa.ca/datasets/ottawa::zoning',
            publisher: { name: 'City of Ottawa' },
            license: null
        }), source, { fetchJson });
        expect(city.status).toBe('included');
        expect(city.value.places[0].placeId).toBe('sgc-cd-3506');
        expect(city.value.source.isAuthoritative).toBe(true);
        expect(city.value.source.licenseTitleEn).toBe('Open Government Licence – City of Ottawa');

        const police = await adapter.enrichRecord(record({
            landingPage: 'https://open.ottawa.ca/datasets/ottawa::crime',
            publisher: { name: 'Ottawa Police Service' },
            license: 'https://data.ottawapolice.ca/pages/open-data-licence'
        }), source, { fetchJson });
        expect(police.status).toBe('included');
        expect(police.value.source.isAuthoritative).toBe(true);
        expect(police.value.source.licenseTitleEn).toBe('Open Government Licence – Ottawa Police Service');

        const restricted = await adapter.enrichRecord(record({
            landingPage: 'https://open.ottawa.ca/datasets/ottawa::restricted',
            publisher: { name: 'City of Ottawa' },
            license: 'Available for personal use only.'
        }), source, { fetchJson });
        expect(restricted).toEqual({
            status: 'excluded',
            reason: 'restricted-license',
            externalId: ITEM_ID + ':2'
        });
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
        expect(city.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – Halifax',
            licenseUrl: 'https://data-hrm.hub.arcgis.com/pages/open-data-licence',
            attributionEn: 'Contains information licensed under the Open Government Licence – Halifax.'
        }));

        const restricted = await adapter.enrichRecord({
            ...cityRecord,
            license: 'Available for personal, non-commercial use only.'
        }, source, { fetchJson });
        expect(restricted).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });

        const external = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: 'Ministry of Education' },
            license: null
        }, source, { fetchJson });
        expect(external).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
    });

    test('admits only allowlisted Hamilton City department publishers', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'CityofHamilton', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const source = getSource('hamilton-hub');
        const cityRecord = record({
            landingPage: 'https://open.hamilton.ca/datasets/hamilton::zoning',
            publisher: { name: 'City of Hamilton' },
            license: '<p>Constraints go here</p>'
        });
        const city = await adapter.enrichRecord(cityRecord, source, { fetchJson });

        expect(city.status).toBe('included');
        expect(city.value.organization.titleEn).toBe('City of Hamilton');
        expect(city.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3525', relationship: 'direct', includesDescendants: false
        }));
        expect(city.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'City of Hamilton Open Data Licence',
            licenseUrl: 'https://open.hamilton.ca/pages/open-data-licence',
            attributionEn: 'Contains information made available under the City of Hamilton Open Data Licence.'
        }));

        const restricted = await adapter.enrichRecord({
            ...cityRecord,
            license: 'Available for personal, non-commercial use only.'
        }, source, { fetchJson });
        expect(restricted).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });

        const unfamiliar = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: 'City of Hamilton;External Partner' }
        }, source, { fetchJson });
        expect(unfamiliar).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });

        const placeholderFetch = jest.fn(async () => ({
            owner: 'ExternalPublisher', type: 'Feature Service'
        }));
        const placeholder = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: '{{source}}' }
        }, source, { fetchJson: placeholderFetch });
        expect(placeholder).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
        expect(placeholderFetch).toHaveBeenCalledTimes(1);
    });

    test('applies Surrey portal terms only to exact City publisher evidence', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'SurreyGIS', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('surrey-hub');
        const cityRecord = record({
            landingPage: 'https://opendata-surrey.hub.arcgis.com/datasets/surrey::public-art',
            publisher: { name: 'City of Surrey' },
            license: '<p>Constraints go here</p>'
        });
        const city = await adapter.enrichRecord(cityRecord, source, { fetchJson });

        expect(city.status).toBe('included');
        expect(city.value.organization.titleEn).toBe('City of Surrey');
        expect(city.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5915004', relationship: 'direct', includesDescendants: false
        }));
        expect(city.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government License – Surrey',
            licenseUrl: expect.stringContaining('/pages/55089a19491a4fe59a41e059fd8af708'),
            attributionEn: 'Contains information licensed under the Open Government License – City of Surrey.'
        }));

        const restricted = await adapter.enrichRecord({
            ...cityRecord,
            license: 'Available for personal, non-commercial use only.'
        }, source, { fetchJson });
        expect(restricted).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });

        const external = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: 'Ministry of Education' },
            license: null
        }, source, { fetchJson });
        expect(external).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
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
        expect(regional.value.organization.titleEn).toBe('Regional Municipality of Peel');
        expect(regional.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3521', relationship: 'direct', includesDescendants: true
        }));
        expect(regional.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true, licenseUrl: 'https://data.peelregion.ca/pages/license'
        }));

        const census = await adapter.enrichRecord({
            ...peelRecord,
            publisher: { name: 'Statistics Canada' },
            license: 'Statistics Canada Open License'
        }, source, { fetchJson });
        expect(census.value.source).toEqual(expect.objectContaining({
            isAuthoritative: false,
            licenseUrl: 'https://www.statcan.gc.ca/en/reference/licence'
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
