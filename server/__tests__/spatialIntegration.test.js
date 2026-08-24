const { Client, Pool } = require('pg');
const { queryLocalMap } = require('../db/mapIndexQueries');
const { indexMapResource } = require('../services/mapIndexPipeline');

const databaseUrl = process.env.SPATIAL_TEST_DATABASE_URL;
const spatialDescribe = databaseUrl ? describe : describe.skip;

spatialDescribe('PostGIS viewport integration', () => {
    let client;
    let mapPool;
    const suffix = process.pid + '-' + Date.now();
    const orgId = 'spatial-org-' + suffix;
    const datasetId = 'spatial-dataset-' + suffix;
    const resourceId = 'spatial-resource-' + suffix;
    const projectedOrgId = 'projected-org-' + suffix;
    const projectedDatasetId = 'projected-dataset-' + suffix;
    const projectedResourceId = 'projected-resource-' + suffix;

    beforeAll(async () => {
        client = new Client({ connectionString: databaseUrl });
        await client.connect();
        mapPool = new Pool({ connectionString: databaseUrl, max: 2 });
        await client.query("INSERT INTO organizations (id, name, title_en) VALUES ($1,$2,'Spatial test')", [orgId, orgId]);
        await client.query("INSERT INTO datasets (id, name, title_en, org_id) VALUES ($1,$2,'Spatial test',$3)", [datasetId, datasetId, orgId]);
        await client.query("INSERT INTO resources (id, dataset_id, format, url) VALUES ($1,$2,'CSV','https://example.test/map.csv')", [resourceId, datasetId]);
        await client.query(`
            INSERT INTO map_store.features (resource_id, feature_id, geom, properties)
            VALUES
              ($1, 1, ST_GeomFromText('LINESTRING(-80 43.6,-79 43.6)', 4326), '{"name":"crossing"}'),
              ($1, 2, ST_GeomFromText('POINT(-75 40)', 4326), '{"name":"outside"}')
        `, [resourceId]);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query('DELETE FROM resources WHERE id = $1', [projectedResourceId]);
        await client.query('DELETE FROM datasets WHERE id = $1', [projectedDatasetId]);
        await client.query('DELETE FROM organizations WHERE id = $1', [projectedOrgId]);
        await client.query('DELETE FROM resources WHERE id = $1', [resourceId]);
        await client.query('DELETE FROM datasets WHERE id = $1', [datasetId]);
        await client.query('DELETE FROM organizations WHERE id = $1', [orgId]);
        await client.end();
        if (mapPool) await mapPool.end();
    });

    test('uses a bounded bbox query and clips geometry to the viewport', async () => {
        const rows = await queryLocalMap(client, {
            resourceId,
            bbox: [-79.8, 43.5, -79.2, 43.7],
            tolerance: 0.00001,
            limit: 10
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].properties).toEqual({ name: 'crossing' });
        const coordinates = rows[0].geometry.coordinates.flat(Infinity).filter(Number.isFinite);
        expect(Math.min(...coordinates.filter(value => value < 0))).toBeGreaterThanOrEqual(-79.800001);
        expect(Math.max(...coordinates.filter(value => value < 0))).toBeLessThanOrEqual(-79.199999);
    });

    test('streams and transforms a projected direct GeoJSON candidate into WGS84', async () => {
        const workerId = '00000000-0000-4000-8000-000000000020';
        const candidate = {
            mode: 'geojson-file', sourceUrl: 'https://example.test/projected.geojson',
            expectedBytes: 512
        };
        await client.query(
            "INSERT INTO organizations (id, name, title_en) VALUES ($1,$2,'Projected test')",
            [projectedOrgId, projectedOrgId]
        );
        await client.query(
            "INSERT INTO datasets (id, name, title_en, org_id) VALUES ($1,$2,'Projected test',$3)",
            [projectedDatasetId, projectedDatasetId, projectedOrgId]
        );
        await client.query(`
            INSERT INTO resources (id, dataset_id, name_fr, format, url, datastore_active, raw)
            VALUES ($1,$2,'Projection','GEOJSON',$3,false,$4)
        `, [
            projectedResourceId, projectedDatasetId, candidate.sourceUrl,
            JSON.stringify({
                source_id: 'montreal-open-data', upstream_resource_id: 'projection-test',
                original_format: 'GEOJSON'
            })
        ]);
        await client.query(`
            INSERT INTO map_index_jobs (
                resource_id, desired_version, status, candidate, attempts,
                worker_id, claimed_at, heartbeat_at
            ) VALUES ($1,'projected-v1','running',$2,1,$3,now(),now())
        `, [projectedResourceId, JSON.stringify(candidate), workerId]);
        const body = JSON.stringify({
            type: 'FeatureCollection',
            crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2950' } },
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [301656.0625, 5058619.8492] },
                properties: { Nom_gare: 'Canary', nested: { ignored: true } }
            }]
        });
        const result = await indexMapResource({
            id: projectedResourceId, url: candidate.sourceUrl
        }, {
            resource_id: projectedResourceId,
            claimed_version: 'projected-v1',
            candidate
        }, workerId, {
            maxRows: 10,
            maxVertices: 100,
            maxFileBytes: 1024 * 1024,
            storeBudgetBytes: 1024 * 1024 * 1024,
            minFreeBytes: 1,
            fetchImpl: async () => new Response(body, {
                status: 200,
                headers: { 'content-type': 'application/geo+json', 'content-length': String(Buffer.byteLength(body)) }
            })
        }, { metadataPool: mapPool, indexPool: mapPool });
        expect(result).toEqual(expect.objectContaining({
            featureCount: 1, vertexCount: 1, queueStatus: 'ready'
        }));
        const feature = await client.query(`
            SELECT ST_X(geom) AS longitude, ST_Y(geom) AS latitude, properties
            FROM map_store.features WHERE resource_id = $1
        `, [projectedResourceId]);
        expect(feature.rows[0].longitude).toBeGreaterThan(-74);
        expect(feature.rows[0].longitude).toBeLessThan(-73);
        expect(feature.rows[0].latitude).toBeGreaterThan(45);
        expect(feature.rows[0].latitude).toBeLessThan(46);
        expect(feature.rows[0].properties).toEqual({ Nom_gare: 'Canary' });
    });

    test('migrations expose one canonical Ottawa city with durable aliases', async () => {
        const place = await client.query(`
            SELECT id, slug, kind, type_en, type_fr, parent_id, featured,
                   latitude, longitude, default_zoom
            FROM places WHERE id = 'sgc-cd-3506'
        `);
        expect(place.rows).toEqual([expect.objectContaining({
            id: 'sgc-cd-3506', slug: 'ottawa-on', kind: 'municipality',
            type_en: 'City', type_fr: 'Ville', parent_id: 'ca-on', featured: true,
            latitude: 45.4215, longitude: -75.6972, default_zoom: 9
        })]);

        const identifiers = await client.query(`
            SELECT scheme, value FROM place_identifiers
            WHERE place_id = 'sgc-cd-3506' ORDER BY scheme
        `);
        expect(identifiers.rows).toEqual([
            { scheme: 'sgc-cd', value: '3506' },
            { scheme: 'sgc-csd', value: '3506008' }
        ]);

        const aliases = await client.query(`
            SELECT slug FROM place_aliases
            WHERE place_id = 'sgc-cd-3506' ORDER BY slug
        `);
        expect(aliases.rows).toEqual([
            { slug: 'ottawa-on-3506008' },
            { slug: 'sgc-csd-3506008' }
        ]);
        const duplicate = await client.query("SELECT 1 FROM places WHERE id = 'sgc-csd-3506008'");
        expect(duplicate.rowCount).toBe(0);
    });

    test('migrations expose distinct Montréal region and featured city identities', async () => {
        const places = await client.query(`
            SELECT id, slug, kind, parent_id, type_en, type_fr, featured,
                   latitude, longitude, default_zoom
            FROM places WHERE id IN ('sgc-cd-2466', 'sgc-csd-2466023')
            ORDER BY id
        `);
        expect(places.rows).toEqual([
            expect.objectContaining({
                id: 'sgc-cd-2466', slug: 'montreal-region-qc', kind: 'region',
                parent_id: 'sgc-pr-24', featured: false
            }),
            expect.objectContaining({
                id: 'sgc-csd-2466023', slug: 'montreal-qc', kind: 'municipality',
                parent_id: 'sgc-cd-2466', type_en: 'City', type_fr: 'Ville',
                featured: true, latitude: 45.5019, longitude: -73.5674, default_zoom: 10
            })
        ]);
        const aliases = await client.query(`
            SELECT slug, place_id FROM place_aliases
            WHERE slug IN ('montr-al-qc', 'montr-al-qc-2466023', 'montreal-qc-2466023')
            ORDER BY slug
        `);
        expect(aliases.rows).toEqual([
            { slug: 'montr-al-qc', place_id: 'sgc-cd-2466' },
            { slug: 'montr-al-qc-2466023', place_id: 'sgc-csd-2466023' },
            { slug: 'montreal-qc-2466023', place_id: 'sgc-csd-2466023' }
        ]);
    });
});
