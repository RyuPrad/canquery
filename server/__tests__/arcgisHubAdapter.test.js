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
        expect(result.value.externalId).toBe(ITEM_ID + ':2');
        expect(result.value.dataset.id).toBe('arcgis-' + ITEM_ID + '-2');
        expect(result.value.dataset.notesEn).toBe('Public road data.');
        expect(result.value.resource).toEqual(expect.objectContaining({
            format: 'CSV',
            url: 'https://hub.arcgis.com/api/download/v1/items/' + ITEM_ID + '/csv?layers=2'
        }));
        expect(result.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'ca-on-oshawa', relationship: 'direct', includesDescendants: false
        }));
        expect(result.value.map).toEqual(expect.objectContaining({
            geometryType: 'polyline', serviceUrl: 'https://services.arcgis.com/example/FeatureServer/2'
        }));
        expect(result.value.source.licenseUrl).toMatch(/Oshawa\.pdf$/);
        expect(result.value.source.isAuthoritative).toBe(true);
        expect(result.value.organization).toEqual(expect.objectContaining({
            id: 'arcgis-publisher-city-of-oshawa',
            titleEn: 'City of Oshawa'
        }));
    });

    test('canonicalizes a placeholder Pickering publisher from the ArcGIS owner', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'OpenData_CityofPickering', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const result = await adapter.enrichRecord(record({
            landingPage: 'https://opendata.pickering.ca/datasets/pickering::wards/about',
            publisher: { name: '{{source}}' },
            license: 'https://www.pickering.ca/media/depbgebg/opendatalicencepickeringv1_acc.pdf'
        }), getSource('pickering-hub'), { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization).toEqual(expect.objectContaining({
            id: 'arcgis-publisher-city-of-pickering',
            titleEn: 'City of Pickering'
        }));
        expect(result.value.places[0].placeId).toBe('sgc-csd-3518001');
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            raw: expect.objectContaining({ publisher: 'City of Pickering', supplied_publisher: null })
        }));
    });

    test('admits only records carrying Whitby open-licence evidence', async () => {
        const allowedFetch = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? {
                owner: 'TownofWhitby',
                type: 'Feature Service',
                licenseInfo: '<a href="https://whitby.maps.arcgis.com/sharing/rest/content/items/223810efc31c40b3aff99dd74f809a97/data">Open Government Licence</a>'
            }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const whitbyRecord = record({
            landingPage: 'https://geohub-whitby.hub.arcgis.com/datasets/whitby::parks/about',
            publisher: { name: 'Town of Whitby' },
            license: 'Custom License'
        });
        const allowed = await adapter.enrichRecord(whitbyRecord, getSource('whitby-hub'), { fetchJson: allowedFetch });
        expect(allowed.status).toBe('included');
        expect(allowed.value.places[0].placeId).toBe('sgc-csd-3518009');

        const restrictedFetch = jest.fn(async () => ({
            owner: 'TownofWhitby', type: 'Feature Service',
            licenseInfo: 'Permitted for personal, non-commercial purposes only.'
        }));
        const restricted = await adapter.enrichRecord(whitbyRecord, getSource('whitby-hub'), { fetchJson: restrictedFetch });
        expect(restricted).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });
        expect(restrictedFetch).toHaveBeenCalledTimes(1);

        const missingFetch = jest.fn(async () => ({ owner: 'TownofWhitby', type: 'Feature Service' }));
        const missing = await adapter.enrichRecord(whitbyRecord, getSource('whitby-hub'), { fetchJson: missingFetch });
        expect(missing).toEqual({ status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2' });
        expect(missingFetch).toHaveBeenCalledTimes(1);
    });

    test('marks mirrored Durham records non-authoritative and the regional copy authoritative', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'DurhamRegion', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolyline', fields: [] });
        const durhamRecord = record({
            publisher: { name: 'Regional Municipality of Durham' },
            license: 'Region of Durham Open Data Licence v1.0'
        });
        const mirror = await adapter.enrichRecord(durhamRecord, getSource('pickering-hub'), { fetchJson });
        const original = await adapter.enrichRecord(durhamRecord, getSource('durham-hub'), { fetchJson });

        expect(mirror.value.source.isAuthoritative).toBe(false);
        expect(mirror.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'ca-on-durham', relationship: 'coverage', includesDescendants: true
        }));
        expect(original.value.source.isAuthoritative).toBe(true);
        expect(original.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'ca-on-durham', relationship: 'direct', includesDescendants: true
        }));
    });

    test('applies Mississauga portal terms while preserving explicit Statistics Canada licensing', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'Mississauga', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const source = getSource('mississauga-hub');
        const cityRecord = record({
            landingPage: 'https://data.mississauga.ca/datasets/mississauga::wards',
            publisher: { name: 'City Of Mississauga' },
            license: null
        });
        const city = await adapter.enrichRecord(cityRecord, source, { fetchJson });
        expect(city.status).toBe('included');
        expect(city.value.places[0].placeId).toBe('sgc-csd-3521005');
        expect(city.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseUrl: 'https://www.mississauga.ca/file/COM/CityOfMississaugaTermsOfUse.pdf'
        }));

        const census = await adapter.enrichRecord({
            ...cityRecord,
            license: 'https://www.statcan.gc.ca/en/reference/licence'
        }, source, { fetchJson });
        expect(census.value.source.licenseUrl).toBe('https://www.statcan.gc.ca/en/reference/licence');
    });

    test('applies Ottawa portal terms while preserving explicit Police licensing', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'open.ouvert@ottawa.ca', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('ottawa-hub');
        const cityRecord = record({
            landingPage: 'https://open.ottawa.ca/datasets/ottawa::parks',
            publisher: { name: 'City of Ottawa' },
            license: null
        });
        const city = await adapter.enrichRecord(cityRecord, source, { fetchJson });
        expect(city.status).toBe('included');
        expect(city.value.places[0].placeId).toBe('sgc-cd-3506');
        expect(city.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseUrl: expect.stringContaining('/open-data-licence-version-20')
        }));

        const police = await adapter.enrichRecord({
            ...cityRecord,
            title: 'Ottawa Police Service Neighbourhoods',
            license: 'https://data.ottawapolice.ca/pages/open-data-licence'
        }, source, { fetchJson });
        expect(police.value.source).toEqual(expect.objectContaining({
            licenseTitleEn: 'Open Government Licence – Ottawa Police Service',
            licenseUrl: 'https://data.ottawapolice.ca/pages/open-data-licence'
        }));

        const placeholderFetch = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'ExternalPublisher', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const placeholder = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: '{{source}}' }
        }, source, { fetchJson: placeholderFetch });
        expect(placeholder).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
    });

    test('applies Halifax portal terms only to exact HRM publisher evidence', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'opendata_HRM', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const source = getSource('halifax-hub');
        const cityRecord = record({
            landingPage: 'https://data-hrm.hub.arcgis.com/datasets/HRM::parks',
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
            licenseUrl: 'https://data-hrm.hub.arcgis.com/pages/open-data-licence'
        }));

        const restricted = await adapter.enrichRecord({
            ...cityRecord,
            license: 'Reproduction is permitted for non-commercial use only.'
        }, source, { fetchJson });
        expect(restricted).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });

        const externalFetch = jest.fn(async () => ({ owner: 'ExternalPublisher', type: 'Feature Service' }));
        const placeholder = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: '{{source}}' }
        }, source, { fetchJson: externalFetch });
        expect(placeholder).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
        expect(externalFetch).toHaveBeenCalledTimes(1);
    });

    test('admits only allowlisted Hamilton City department publishers', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'Hamilton_Open_Data', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolyline', fields: [] });
        const source = getSource('hamilton-hub');
        const cityRecord = record({
            landingPage: 'https://open.hamilton.ca/datasets/SpatialSolutions::roads',
            publisher: { name: 'City of Hamilton;Public Works;Hamilton Water' },
            license: null
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
            licenseUrl: expect.stringContaining('/open-data-licence-terms-and-conditions'),
            attributionEn: 'Contains public sector Data made available under the City of Hamilton’s Open Data Licence'
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

    test('trusts placeholder publishers only on the exact configured HTTPS catalogue host', async () => {
        const source = getSource('coquitlam-hub');
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'UnexpectedArcgisOwner', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const placeholderRecord = record({
            landingPage: 'https://data.coquitlam.ca/datasets/coquitlam::parks',
            publisher: { name: '{{source}}' },
            license: null
        });

        const trusted = await adapter.enrichRecord(placeholderRecord, source, { fetchJson });
        expect(trusted.status).toBe('included');
        expect(trusted.value.organization.titleEn).toBe('City of Coquitlam');
        expect(trusted.value.source.raw).toEqual(expect.objectContaining({
            publisher: 'City of Coquitlam', supplied_publisher: null
        }));

        const wrongHost = await adapter.enrichRecord(placeholderRecord, {
            ...source,
            catalogUrl: 'https://mirror.example/api/feed/dcat-us/1.1.json'
        }, { fetchJson });
        expect(wrongHost).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
    });

    test.each([
        ['waterloo-region-hub', 'Cambridge, Ontario', 'City of Cambridge', 'sgc-csd-3530010', 'https://www.cambridge.ca/en/your-city/open-data.aspx'],
        ['fredericton-hub', 'City of Fredericton - Ville de Fredericton', 'City of Fredericton', 'sgc-csd-1310032', 'https://data-fredericton.opendata.arcgis.com/pages/open-data-licence'],
        ['airdrie-hub', 'GeoConnection', 'City of Airdrie', 'sgc-csd-4806021', 'https://data-airdrie.opendata.arcgis.com/pages/terms-of-use'],
        ['airdrie-hub', 'The City of Airdrie', 'City of Airdrie', 'sgc-csd-4806021', 'https://data-airdrie.opendata.arcgis.com/pages/terms-of-use']
    ])('normalizes %s publisher evidence %s without widening its licence gate', async (
        sourceId, suppliedPublisher, canonicalPublisher, placeId, licenseUrl
    ) => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'UnrelatedArcgisOwner', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });

        const result = await adapter.enrichRecord(record({
            publisher: { name: suppliedPublisher },
            license: null
        }), getSource(sourceId), { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe(canonicalPublisher);
        expect(result.value.places[0]).toEqual(expect.objectContaining({ placeId }));
        expect(result.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseUrl,
            raw: expect.objectContaining({
                publisher: canonicalPublisher,
                supplied_publisher: suppliedPublisher
            })
        }));
    });

    test.each([
        ['lethbridge-hub', 'City of Lethbridge', 'sgc-csd-4802012'],
        ['medicine-hat-hub', 'City of Medicine Hat', 'sgc-csd-4801006'],
        ['airdrie-hub', 'City of Airdrie', 'sgc-csd-4806021'],
        ['canmore-hub', 'Town of Canmore', 'sgc-csd-4815023'],
        ['penticton-hub', 'City of Penticton', 'sgc-csd-5907041'],
        ['langley-city-hub', 'City of Langley', 'sgc-csd-5915001'],
        ['huron-hub', 'County of Huron', 'sgc-cd-3540'],
        ['cumberland-hub', 'Municipality of the County of Cumberland', 'sgc-cd-1211']
    ])('admits %s placeholders only from its exact HTTPS catalogue host', async (
        sourceId, canonicalPublisher, placeId
    ) => {
        const source = getSource(sourceId);
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'UnrelatedArcgisOwner', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const placeholderRecord = record({ publisher: { name: '{{source}}' }, license: null });

        const trusted = await adapter.enrichRecord(placeholderRecord, source, { fetchJson });
        expect(trusted.status).toBe('included');
        expect(trusted.value.organization.titleEn).toBe(canonicalPublisher);
        expect(trusted.value.places[0]).toEqual(expect.objectContaining({ placeId }));
        expect(trusted.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            raw: expect.objectContaining({ publisher: canonicalPublisher, supplied_publisher: null })
        }));

        const wrongHost = await adapter.enrichRecord(placeholderRecord, {
            ...source,
            catalogUrl: 'https://mirror.example/api/feed/dcat-us/1.1.json'
        }, { fetchJson });
        expect(wrongHost).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
    });

    test('rejects v35 third-party and explicitly restricted ArcGIS records', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'MunicipalGIS', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolyline', fields: [] });

        const mapleRidge = await adapter.enrichRecord(record({
            publisher: { name: 'City of Maple Ridge' },
            license: 'This record is governed by the TransLink terms of use.'
        }), getSource('maple-ridge-hub'), { fetchJson });
        expect(mapleRidge).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });

        const poco = await adapter.enrichRecord(record({
            publisher: { name: 'City of Port Coquitlam' },
            license: 'PoCoMap is available for internal business and personal purpose only.'
        }), getSource('port-coquitlam-hub'), { fetchJson });
        expect(poco).toEqual({
            status: 'excluded', reason: 'restricted-license', externalId: ITEM_ID + ':2'
        });

        const thirdParty = await adapter.enrichRecord(record({
            publisher: { name: 'Metro Vancouver' },
            license: null
        }), getSource('new-westminster-hub'), { fetchJson });
        expect(thirdParty).toEqual({
            status: 'excluded', reason: 'unlicensed', externalId: ITEM_ID + ':2'
        });
    });

    test('excludes configured unavailable ArcGIS service families without fetching their metadata', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return { owner: 'CityOfAbbotsford', type: 'Feature Service' };
            }
            throw new Error('unavailable service metadata should not be fetched');
        });
        const result = await adapter.enrichRecord(record({
            publisher: { name: 'City of Abbotsford' },
            license: null,
            distribution: [{
                format: 'ArcGIS GeoServices REST API',
                accessURL: 'https://maps.abbotsford.ca/arcgis/rest/services/GeocortexExt/Public/MapServer/2'
            }]
        }), getSource('abbotsford-hub'), { fetchJson });

        expect(result).toEqual({
            status: 'excluded', reason: 'unavailable-service', externalId: ITEM_ID + ':2'
        });
        expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    test('extracts canonical item/layer identities and strips unsafe markup', () => {
        expect(adapter.identityFor(record())).toEqual({ itemId: ITEM_ID, layerId: 2 });
        expect(adapter.htmlToText('<p>A &amp; B</p><style>x</style><script>y</script>')).toBe('A & B');
    });
});
