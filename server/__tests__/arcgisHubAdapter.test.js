const { ArcgisHubAdapter } = require('../services/arcgisHubAdapter');
const { sources } = require('../config/catalogSources');

const victoriaSource = sources.find(source => source.id === 'victoria-hub');
const halifaxSource = sources.find(source => source.id === 'halifax-hub');
const hamiltonSource = sources.find(source => source.id === 'hamilton-hub');

const BASE_DATASET = {
    id: 'test-dataset-1',
    attributes: {
        id: 'test-dataset-1',
        name: 'Victoria Budget 2024',
        description: 'Annual municipal operating budget dataset',
        source: 'City of Victoria',
        modified: 1710000000000,
        published: 1705000000000,
        license: 'Custom Open Data Licence',
        recordCount: 150,
        size: 204800,
        format: 'Feature Service',
        type: 'Vector',
        spatialReference: 'EPSG:4326',
        geometryType: 'esriGeometryPolygon',
        tags: ['finance', 'budget', 'municipal'],
        categories: ['Finance'],
        owner: 'City of Victoria',
        orgName: 'City of Victoria',
        url: 'https://opendata.victoria.ca/datasets/test-dataset-1'
    }
};

describe('ArcgisHubAdapter', () => {
    let adapter;

    beforeEach(() => {
        adapter = new ArcgisHubAdapter(victoriaSource);
    });

    test('normalizes a basic ArcGIS Hub dataset into standard CanQuery format', () => {
        const normalized = adapter.normalizeDataset(BASE_DATASET);

        expect(normalized).not.toBeNull();
        expect(normalized.id).toBe('test-dataset-1');
        expect(normalized.titleEn).toBe('Victoria Budget 2024');
        expect(normalized.titleFr).toBeNull();
        expect(normalized.descriptionEn).toBe('Annual municipal operating budget dataset');
        expect(normalized.descriptionFr).toBeNull();
        expect(normalized.organizationName).toBe('City of Victoria');
        expect(normalized.organizationTitleEn).toBe('City of Victoria');
        expect(normalized.organizationTitleFr).toBeNull();
        expect(normalized.licenseTitleEn).toBe('City of Victoria Open Data Licence');
        expect(normalized.licenseUrl).toBe('https://opendata.victoria.ca/pages/open-data-licence');
        expect(normalized.sourceId).toBe('victoria-hub');
        expect(normalized.catalogUrl).toBe('https://opendata.victoria.ca/datasets/test-dataset-1');
        expect(normalized.tags).toEqual(['finance', 'budget', 'municipal']);
        expect(normalized.categories).toEqual(['Finance']);
        expect(normalized.placeAssignments).toEqual([{
            placeId: 'sgc-csd-5917034',
            relationship: 'direct'
        }]);
    });

    test('drops datasets published by unconfigured third parties', () => {
        const dataset = {
            ...BASE_DATASET,
            attributes: {
                ...BASE_DATASET.attributes,
                source: 'External Contributor',
                owner: 'External Contributor',
                orgName: 'External Contributor'
            }
        };

        const normalized = adapter.normalizeDataset(dataset);
        expect(normalized).toBeNull();
    });

    test('drops datasets that match explicit non-open licence patterns', () => {
        const dataset = {
            ...BASE_DATASET,
            attributes: {
                ...BASE_DATASET.attributes,
                license: 'For educational and non-commercial research use only'
            }
        };

        const normalized = adapter.normalizeDataset(dataset);
        expect(normalized).toBeNull();
    });

    test('resolves Halifax datasets with authoritative publisher variants', () => {
        const halifaxAdapter = new ArcgisHubAdapter(halifaxSource);
        const dataset = {
            id: 'halifax-transit-routes',
            attributes: {
                id: 'halifax-transit-routes',
                name: 'Transit Routes',
                description: 'Halifax transit bus route network',
                source: 'Halifax Regional Municipality',
                modified: 1710000000000,
                published: 1705000000000,
                license: 'Open Data Licence',
                recordCount: 50,
                size: 102400,
                format: 'Feature Service',
                type: 'Vector',
                spatialReference: 'EPSG:4326',
                geometryType: 'esriGeometryPolyline',
                tags: ['transit', 'bus', 'transportation'],
                categories: ['Transportation'],
                owner: 'HRM Open Data',
                orgName: 'Halifax Regional Municipality',
                url: 'https://data-hrm.hub.arcgis.com/datasets/halifax-transit-routes'
            }
        };

        const normalized = halifaxAdapter.normalizeDataset(dataset);
        expect(normalized).not.toBeNull();
        expect(normalized.organizationName).toBe('Halifax Regional Municipality');
        expect(normalized.licenseTitleEn).toBe('Halifax Open Data Licence');
        expect(normalized.licenseUrl).toBe('https://data-hrm.hub.arcgis.com/pages/licence');
        expect(normalized.placeAssignments).toEqual([{
            placeId: 'sgc-csd-1209034',
            relationship: 'direct'
        }]);
    });

    test('drops datasets missing both title and ID', () => {
        const dataset = {
            attributes: {
                description: 'A dataset without a title or id'
            }
        };

        const normalized = adapter.normalizeDataset(dataset);
        expect(normalized).toBeNull();
    });

    test('synthesizes CSV and GeoJSON resource downloads from Hub feature services', () => {
        const dataset = {
            ...BASE_DATASET,
            attributes: {
                ...BASE_DATASET.attributes,
                url: 'https://opendata.victoria.ca/datasets/test-dataset-1'
            }
        };

        const normalized = adapter.normalizeDataset(dataset);
        expect(normalized).not.toBeNull();
        expect(normalized.resources.length).toBeGreaterThan(0);

        const csvResource = normalized.resources.find(r => r.format === 'csv');
        expect(csvResource).toBeDefined();
        expect(csvResource.id).toBe('test-dataset-1-csv');
        expect(csvResource.url).toBe('https://opendata.victoria.ca/datasets/test-dataset-1.csv');

        const geojsonResource = normalized.resources.find(r => r.format === 'geojson');
        expect(geojsonResource).toBeDefined();
        expect(geojsonResource.id).toBe('test-dataset-1-geojson');
        expect(geojsonResource.url).toBe('https://opendata.victoria.ca/datasets/test-dataset-1.geojson');
    });

    test('preserves explicit distributions provided by DCAT-US 1.1 feed', () => {
        const dcatDataset = {
            identifier: 'dcat-dataset-1',
            title: 'Victoria Park Trees',
            description: 'Inventory of public trees in Victoria parks',
            publisher: {
                name: 'City of Victoria'
            },
            modified: '2024-03-01T00:00:00.000Z',
            issued: '2024-01-15T00:00:00.000Z',
            license: 'https://opendata.victoria.ca/pages/open-data-licence',
            keyword: ['parks', 'trees', 'urban-forestry'],
            theme: ['Environment'],
            distribution: [
                {
                    title: 'CSV',
                    format: 'CSV',
                    mediaType: 'text/csv',
                    downloadURL: 'https://opendata.victoria.ca/datasets/dcat-dataset-1_0.csv',
                    accessURL: 'https://opendata.victoria.ca/datasets/dcat-dataset-1'
                },
                {
                    title: 'GeoJSON',
                    format: 'GeoJSON',
                    mediaType: 'application/geo+json',
                    downloadURL: 'https://opendata.victoria.ca/datasets/dcat-dataset-1_0.geojson',
                    accessURL: 'https://opendata.victoria.ca/datasets/dcat-dataset-1'
                },
                {
                    title: 'Shapefile',
                    format: 'ZIP',
                    mediaType: 'application/zip',
                    downloadURL: 'https://opendata.victoria.ca/datasets/dcat-dataset-1_0.zip',
                    accessURL: 'https://opendata.victoria.ca/datasets/dcat-dataset-1'
                }
            ]
        };

        const normalized = adapter.normalizeDcatUsDataset(dcatDataset);
        expect(normalized).not.toBeNull();
        expect(normalized.id).toBe('dcat-dataset-1');
        expect(normalized.titleEn).toBe('Victoria Park Trees');
        expect(normalized.resources).toHaveLength(3);
        expect(normalized.resources.map(r => r.format)).toEqual(['csv', 'geojson', 'zip']);
        expect(normalized.placeAssignments).toEqual([{
            placeId: 'sgc-csd-5917034',
            relationship: 'direct'
        }]);
    });

    test('drops DCAT-US datasets published by unconfigured organizations', () => {
        const dcatDataset = {
            identifier: 'external-dataset-1',
            title: 'External Third Party Data',
            description: 'Data from an unknown entity',
            publisher: {
                name: 'Unknown Regional Board'
            },
            distribution: [{
                title: 'CSV',
                format: 'CSV',
                downloadURL: 'https://example.com/data.csv'
            }]
        };

        const normalized = adapter.normalizeDcatUsDataset(dcatDataset);
        expect(normalized).toBeNull();
    });

    test('drops DCAT-US datasets with restrictive non-commercial terms', () => {
        const dcatDataset = {
            identifier: 'restricted-dataset-1',
            title: 'Research Survey Data',
            description: 'Restricted dataset',
            publisher: {
                name: 'City of Victoria'
            },
            license: 'Restricted – Personal and Non-Commercial Research Only',
            distribution: [{
                title: 'CSV',
                format: 'CSV',
                downloadURL: 'https://opendata.victoria.ca/datasets/survey.csv'
            }]
        };

        const normalized = adapter.normalizeDcatUsDataset(dcatDataset);
        expect(normalized).toBeNull();
    });

    test('resolves Hamilton datasets and assigns City of Hamilton Open Data Licence', () => {
        const hamiltonAdapter = new ArcgisHubAdapter(hamiltonSource);
        const dataset = {
            identifier: 'hamilton-bikeways',
            title: 'Hamilton Bikeways and Multi-Use Trails',
            description: 'Designated bicycle paths and multi-use trails across the city',
            publisher: {
                name: 'City of Hamilton'
            },
            distribution: [{
                title: 'CSV',
                format: 'CSV',
                downloadURL: 'https://open.hamilton.ca/datasets/hamilton-bikeways.csv'
            }]
        };

        const normalized = hamiltonAdapter.normalizeDcatUsDataset(dataset);
        expect(normalized).not.toBeNull();
        expect(normalized.organizationName).toBe('City of Hamilton');
        expect(normalized.licenseTitleEn).toBe('City of Hamilton Open Data Licence');
        expect(normalized.licenseUrl).toBe('https://open.hamilton.ca/pages/licence');
        expect(normalized.placeAssignments).toEqual([{
            placeId: 'sgc-cd-3525',
            relationship: 'direct'
        }]);
    });
});
