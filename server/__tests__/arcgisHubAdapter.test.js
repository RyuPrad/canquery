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
});
