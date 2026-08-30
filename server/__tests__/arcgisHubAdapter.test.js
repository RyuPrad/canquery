const adapter = require('../services/arcgisHubAdapter');
const { sources } = require('../config/catalogSources');

const ITEM_ID = '0123456789abcdef0123456789abcdef';

describe('ArcGIS Hub adapter', () => {
    const source = sources.find(s => s.id === 'halifax-hub');

    const rawRecord = {
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
                format: 'Feature Layer'
            }
        ]
    };

    const itemMetadata = {
        id: ITEM_ID,
        title: 'Halifax Land Use Zoning',
        snippet: 'Zoning layers',
        licenseInfo: 'Open Government Licence – Halifax',
        accessInformation: 'HRM Planning',
        modified: 1785542400000,
        tags: ['zoning', 'planning']
    };

    const layerMetadata = {
        id: 2,
        name: 'Zoning Boundaries',
        type: 'Feature Layer',
        geometryType: 'esriGeometryPolygon',
        objectIdField: 'OBJECTID',
        displayField: 'ZONE_CODE',
        extent: {
            xmin: -63.6, ymin: 44.6, xmax: -63.5, ymax: 44.7,
            spatialReference: { wkid: 4326 }
        },
        fields: [
            { name: 'OBJECTID', alias: 'Object ID', type: 'esriFieldTypeOID' },
            { name: 'ZONE_CODE', alias: 'Zone Code', type: 'esriFieldTypeString' },
            { name: 'SHAPE', alias: 'Shape', type: 'esriFieldTypeGeometry' }
        ]
    };

    const fetchJson = async (url) => {
        if (url.includes('/sharing/rest/content/items/')) return itemMetadata;
        if (url.includes('/FeatureServer/2')) return layerMetadata;
        throw new Error('Unexpected URL: ' + url);
    };

    test('extracts stable itemId and layerId from DCAT distributions', () => {
        const id = adapter.identityFor(rawRecord);
        expect(id).toEqual({ itemId: ITEM_ID, layerId: 2 });
    });

    test('extracts namespace from Hub landing page', () => {
        expect(adapter.namespaceFor(rawRecord)).toBe('data-hrm');
    });

    test('enriches valid ArcGIS layer into canonical dataset, resource, and map candidate', async () => {
        const result = await adapter.enrichRecord(rawRecord, source, { fetchJson });
        expect(result.status).toBe('included');
        const { value } = result;

        expect(value.externalId).toBe(ITEM_ID + ':2');
        expect(value.dataset.id).toBe('arcgis-' + ITEM_ID + '-2');
        expect(value.dataset.titleEn).toBe('Halifax Land Use Zoning');
        expect(value.dataset.notesEn).toBe('Zoning bylaws for Halifax Regional Municipality.');
        expect(value.dataset.keywordsEn).toEqual(['land use', 'zoning', 'planning']);
        expect(value.dataset.orgId).toBe('arcgis-publisher-halifax-regional-municipality');

        expect(value.source.sourceId).toBe('halifax-hub');
        expect(value.source.licenseTitleEn).toBe('Open Government Licence – Halifax');
        expect(value.source.isAuthoritative).toBe(true);

        expect(value.resource.id).toBe('arcgis-' + ITEM_ID + '-2-data');
        expect(value.resource.format).toBe('CSV');
        expect(value.resource.url).toBe('https://hub.arcgis.com/api/download/v1/items/' + ITEM_ID + '/csv?layers=2');

        expect(value.places).toHaveLength(1);
        expect(value.places[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-1209034',
            relationship: 'direct',
            includesDescendants: false
        }));

        expect(value.map).toEqual(expect.objectContaining({
            resourceId: 'arcgis-' + ITEM_ID + '-2-data',
            serviceUrl: 'https://services.arcgis.com/example/FeatureServer/2',
            geometryType: 'polygon',
            extent: [-63.6, 44.6, -63.5, 44.7],
            objectIdField: 'OBJECTID',
            displayField: 'ZONE_CODE'
        }));
        expect(value.map.fields).toEqual([
            { name: 'OBJECTID', alias: 'Object ID', type: 'esriFieldTypeOID' },
            { name: 'ZONE_CODE', alias: 'Zone Code', type: 'esriFieldTypeString' }
        ]);
    });

    test('excludes non-leaf composite service layers', async () => {
        const groupLayerFetch = async (url) => {
            if (url.includes('/sharing/rest/content/items/')) return itemMetadata;
            if (url.includes('/FeatureServer/2')) {
                return { ...layerMetadata, type: 'Group Layer', layers: [{ id: 3 }, { id: 4 }] };
            }
            throw new Error('Unexpected URL: ' + url);
        };

        const result = await adapter.enrichRecord(rawRecord, source, { fetchJson: groupLayerFetch });
        expect(result).toEqual({
            status: 'excluded',
            reason: 'non-leaf-layer',
            externalId: ITEM_ID + ':2'
        });
    });

    test('excludes records with restrictive non-commercial license terms', async () => {
        const restrictiveFetch = async (url) => {
            if (url.includes('/sharing/rest/content/items/')) {
                return { ...itemMetadata, licenseInfo: 'Restricted - Non-Commercial Academic Use Only' };
            }
            if (url.includes('/FeatureServer/2')) return layerMetadata;
            throw new Error('Unexpected URL: ' + url);
        };

        const result = await adapter.enrichRecord(rawRecord, source, { fetchJson: restrictiveFetch });
        expect(result).toEqual({
            status: 'excluded',
            reason: 'unlicensed',
            externalId: ITEM_ID + ':2'
        });
    });

    test('marks external provincial or third-party datasets as non-authoritative', async () => {
        const externalRecord = {
            ...rawRecord,
            publisher: { name: 'Province of Nova Scotia' }
        };

        const result = await adapter.enrichRecord(externalRecord, source, { fetchJson });
        expect(result.status).toBe('included');
        expect(result.value.source.isAuthoritative).toBe(false);
        expect(result.value.organization.titleEn).toBe('Province of Nova Scotia');
    });
});
