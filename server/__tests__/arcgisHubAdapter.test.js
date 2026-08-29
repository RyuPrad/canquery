const adapter = require('../services/arcgisHubAdapter');
const { getSource } = require('../config/catalogSources');

const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function record(overrides = {}) {
    return {
        identifier: 'https://example.test/datasets/' + ITEM_ID + '_2',
        title: 'Municipal Boundary',
        description: '<p>Official municipal boundary geometry.</p>',
        modified: '2026-08-20T12:00:00Z',
        publisher: { name: 'City of Ottawa' },
        keyword: ['boundary', 'planning'],
        theme: ['Administrative'],
        landingPage: 'https://open.ottawa.ca/datasets/' + ITEM_ID + '_2',
        distribution: [{
            title: 'GeoJSON',
            format: 'GeoJSON',
            mediaType: 'application/vnd.geo+json',
            accessURL: 'https://example.test/FeatureServer/2/query?f=geojson&where=1=1'
        }, {
            title: 'CSV',
            format: 'CSV',
            mediaType: 'text/csv',
            accessURL: 'https://example.test/FeatureServer/2/query?f=csv&where=1=1'
        }],
        ...overrides
    };
}

describe('ArcGIS Hub adapter', () => {
    test('enriches valid records into canonical shapes', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return {
                    id: ITEM_ID,
                    title: 'Municipal Boundary Feature Service',
                    owner: 'OttawaOpenData',
                    type: 'Feature Service',
                    access: 'public',
                    orgId: 'ottawa-org-id'
                };
            }
            if (url.includes('/FeatureServer/2')) {
                return {
                    id: 2,
                    name: 'Municipal Boundary',
                    type: 'Feature Layer',
                    geometryType: 'esriGeometryPolygon',
                    fields: [
                        { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'Object ID' },
                        { name: 'NAME', type: 'esriFieldTypeString', alias: 'Boundary Name' }
                    ]
                };
            }
            throw new Error('Unexpected URL: ' + url);
        });

        const source = getSource('ottawa-hub');
        const raw = record();
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.dataset.id).toBe('arcgis-ottawa-hub-item-' + ITEM_ID + '-layer-2');
        expect(result.value.dataset.name).toBe('ottawa-hub-municipal-boundary');
        expect(result.value.dataset.titleEn).toBe('Municipal Boundary');
        expect(result.value.dataset.notesEn).toBe('Official municipal boundary geometry.');
        expect(result.value.dataset.keywordsEn).toEqual(['boundary', 'planning']);
        expect(result.value.organization.titleEn).toBe('City of Ottawa');
        expect(result.value.organization.placeId).toBe('sgc-cd-3506');
        expect(result.value.source.isAuthoritative).toBe(true);
        expect(result.value.source.licenseTitleEn).toBe('Open Government Licence – City of Ottawa');
        expect(result.value.source.licenseUrl).toBe('https://open.ottawa.ca/pages/open-data-licence');
        expect(result.value.places).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3506',
            relationship: 'direct',
            includesDescendants: false
        })]);
        expect(result.value.resources).toHaveLength(2);
        expect(result.value.mapCandidates).toHaveLength(1);
        expect(result.value.mapCandidates[0]).toEqual(expect.objectContaining({
            mode: 'arcgis-geojson-pmtiles',
            sourceUrl: 'https://example.test/FeatureServer/2/query?f=geojson&where=1=1'
        }));
    });

    test('excludes records from non-authoritative item owners', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return {
                    id: ITEM_ID,
                    owner: 'ThirdPartyConsultant',
                    type: 'Feature Service'
                };
            }
            return {
                id: 2,
                type: 'Feature Layer',
                geometryType: 'esriGeometryPolygon',
                fields: []
            };
        });

        const source = getSource('ottawa-hub');
        const raw = record();
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result).toEqual({
            status: 'excluded',
            reason: 'unlicensed',
            externalId: ITEM_ID + ':2'
        });
    });

    test('excludes raster layers from vector map candidate extraction', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return {
                    id: ITEM_ID,
                    owner: 'OttawaOpenData',
                    type: 'Feature Service'
                };
            }
            return {
                id: 2,
                type: 'Raster Layer',
                fields: []
            };
        });

        const source = getSource('ottawa-hub');
        const raw = record({
            distribution: [{
                title: 'GeoTIFF',
                format: 'TIFF',
                mediaType: 'image/tiff',
                accessURL: 'https://example.test/ImageServer/exportImage'
            }]
        });
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.mapCandidates).toHaveLength(0);
    });

    test('tolerates missing DCAT publisher by looking up ArcGIS item owner', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return {
                    id: ITEM_ID,
                    owner: 'CityOfToronto_Admin',
                    type: 'Feature Service'
                };
            }
            return {
                id: 2,
                type: 'Feature Layer',
                geometryType: 'esriGeometryPoint',
                fields: []
            };
        });

        const source = getSource('durham-hub');
        const raw = record({
            publisher: null,
            landingPage: 'https://opendata.durham.ca/datasets/' + ITEM_ID + '_2'
        });
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe('Regional Municipality of Durham');
    });

    test('maps lower-tier Durham municipalities based on DCAT publisher and item owner', async () => {
        const fetchJson = jest.fn(async url => {
            if (url.includes('/sharing/rest/content/items/')) {
                return {
                    id: ITEM_ID,
                    owner: 'TownOfAjax_GIS',
                    type: 'Feature Service'
                };
            }
            return {
                id: 2,
                type: 'Feature Layer',
                geometryType: 'esriGeometryPolygon',
                fields: []
            };
        });

        const source = getSource('durham-hub');
        const raw = record({
            publisher: { name: 'Town of Ajax' },
            landingPage: 'https://opendata.durham.ca/datasets/' + ITEM_ID + '_2'
        });
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result.status).toBe('included');
        expect(result.value.organization.titleEn).toBe('Town of Ajax');
        expect(result.value.places).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3518005',
            relationship: 'direct'
        })]);
    });

    test('excludes non-public or broken ArcGIS items', async () => {
        const fetchJson = jest.fn(async () => {
            const err = new Error('HTTP 403 Access Denied');
            err.status = 403;
            throw err;
        });

        const source = getSource('ottawa-hub');
        const raw = record();
        const result = await adapter.enrichRecord(raw, source, { fetchJson });

        expect(result).toEqual({
            status: 'excluded',
            reason: 'item-metadata-failed',
            externalId: ITEM_ID + ':2'
        });
    });

    test('applies exact Ottawa Police terms and rejects unknown external publishers', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'OttawaPolice', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('ottawa-hub');
        const cityRecord = record();
        const police = await adapter.enrichRecord({
            ...cityRecord,
            publisher: { name: 'Ottawa Police Service' },
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

    test('enforces Hamilton and Surrey portal licensing and detects external layers', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'CityofHamilton', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const hamiltonSource = getSource('hamilton-hub');
        const hamiltonRecord = record({
            landingPage: 'https://open.hamilton.ca/datasets/hamilton::trails',
            publisher: { name: 'City of Hamilton' }
        });
        const hamilton = await adapter.enrichRecord(hamiltonRecord, hamiltonSource, { fetchJson });
        expect(hamilton.status).toBe('included');
        expect(hamilton.value.organization.titleEn).toBe('City of Hamilton');
        expect(hamilton.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3525', relationship: 'direct', includesDescendants: false
        }));
        expect(hamilton.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – City of Hamilton',
            licenseUrl: 'https://open.hamilton.ca/pages/open-data-licence'
        }));

        const surreyFetch = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'CityOfSurrey_Admin', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });
        const surreySource = getSource('surrey-hub');
        const surreyRecord = record({
            landingPage: 'https://data.surrey.ca/datasets/surrey::parks',
            publisher: { name: 'City of Surrey' }
        });
        const surrey = await adapter.enrichRecord(surreyRecord, surreySource, { fetchJson: surreyFetch });
        expect(surrey.status).toBe('included');
        expect(surrey.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5915004', relationship: 'direct', includesDescendants: false
        }));
        expect(surrey.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – City of Surrey',
            licenseUrl: 'https://data.surrey.ca/pages/open-government-licence-surrey'
        }));
    });

    test('maps Oshawa, Ajax, Pickering, Whitby and regional Durham items accurately', async () => {
        const makeFetch = owner => jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner, type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });

        const oshawaSource = getSource('oshawa-hub');
        const oshawaRecord = record({
            landingPage: 'https://data-oshawa.opendata.arcgis.com/datasets/oshawa::zoning',
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
            landingPage: 'https://open-ajax.opendata.arcgis.com/datasets/ajax::parks',
            publisher: { name: 'Town of Ajax' }
        });
        const ajax = await adapter.enrichRecord(ajaxRecord, ajaxSource, { fetchJson: makeFetch('TownOfAjax_Admin') });
        expect(ajax.status).toBe('included');
        expect(ajax.value.organization.titleEn).toBe('Town of Ajax');
        expect(ajax.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518005', relationship: 'direct', includesDescendants: false
        }));

        const pickeringSource = getSource('pickering-hub');
        const pickeringRecord = record({
            landingPage: 'https://data.pickering.ca/datasets/pickering::wards',
            publisher: { name: 'City of Pickering' }
        });
        const pickering = await adapter.enrichRecord(pickeringRecord, pickeringSource, { fetchJson: makeFetch('Pickering_Admin') });
        expect(pickering.status).toBe('included');
        expect(pickering.value.organization.titleEn).toBe('City of Pickering');
        expect(pickering.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518001', relationship: 'direct', includesDescendants: false
        }));

        const whitbySource = getSource('whitby-hub');
        const whitbyRecord = record({
            landingPage: 'https://data-whitby.opendata.arcgis.com/datasets/whitby::facilities',
            publisher: { name: 'Town of Whitby' }
        });
        const whitby = await adapter.enrichRecord(whitbyRecord, whitbySource, { fetchJson: makeFetch('WhitbyGIS') });
        expect(whitby.status).toBe('included');
        expect(whitby.value.organization.titleEn).toBe('Town of Whitby');
        expect(whitby.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518009', relationship: 'direct', includesDescendants: false
        }));
    });

    test('maps Peel regional cluster with Mississauga, Brampton and Region of Peel rules', async () => {
        const makeFetch = owner => jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner, type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPolygon', fields: [] });

        const mississaugaSource = getSource('mississauga-hub');
        const mississaugaRecord = record({
            landingPage: 'https://data.mississauga.ca/datasets/mississauga::zoning',
            publisher: { name: 'City of Mississauga' }
        });
        const mississauga = await adapter.enrichRecord(mississaugaRecord, mississaugaSource, { fetchJson: makeFetch('CityOfMississauga') });
        expect(mississauga.status).toBe('included');
        expect(mississauga.value.organization.titleEn).toBe('City of Mississauga');
        expect(mississauga.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3521005', relationship: 'direct', includesDescendants: false
        }));
        expect(mississauga.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'City of Mississauga Open Data Terms of Use',
            licenseUrl: 'https://data.mississauga.ca/pages/terms-of-use'
        }));

        const bramptonSource = getSource('brampton-hub');
        const bramptonRecord = record({
            landingPage: 'https://geohub.brampton.ca/datasets/brampton::parks',
            publisher: { name: 'City of Brampton' }
        });
        const brampton = await adapter.enrichRecord(bramptonRecord, bramptonSource, { fetchJson: makeFetch('Brampton_Admin') });
        expect(brampton.status).toBe('included');
        expect(brampton.value.organization.titleEn).toBe('City of Brampton');
        expect(brampton.value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3521010', relationship: 'direct', includesDescendants: false
        }));
        expect(brampton.value.source).toEqual(expect.objectContaining({
            isAuthoritative: true,
            licenseTitleEn: 'Open Government Licence – City of Brampton',
            licenseUrl: 'https://geohub.brampton.ca/pages/licence'
        }));
    });

    test('handles Region of Peel explicit and third-party publisher licensing rules', async () => {
        const fetchJson = jest.fn(async url => url.includes('/sharing/rest/content/items/')
            ? { owner: 'PeelRegion_Admin', type: 'Feature Service' }
            : { type: 'Feature Layer', geometryType: 'esriGeometryPoint', fields: [] });
        const source = getSource('peel-hub');
        const peelRecord = record({
            landingPage: 'https://data.peelregion.ca/datasets/peel::roads',
            publisher: { name: 'Region of Peel' },
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
            publisher: { name: 'The City of Saint John' },
            license: null
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
