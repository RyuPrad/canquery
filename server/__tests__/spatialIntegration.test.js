const { Client } = require('pg');
const { queryLocalMap } = require('../db/mapIndexQueries');

const databaseUrl = process.env.SPATIAL_TEST_DATABASE_URL;
const spatialDescribe = databaseUrl ? describe : describe.skip;

spatialDescribe('PostGIS viewport integration', () => {
    let client;
    const suffix = process.pid + '-' + Date.now();
    const orgId = 'spatial-org-' + suffix;
    const datasetId = 'spatial-dataset-' + suffix;
    const resourceId = 'spatial-resource-' + suffix;

    beforeAll(async () => {
        client = new Client({ connectionString: databaseUrl });
        await client.connect();
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
        await client.query('DELETE FROM resources WHERE id = $1', [resourceId]);
        await client.query('DELETE FROM datasets WHERE id = $1', [datasetId]);
        await client.query('DELETE FROM organizations WHERE id = $1', [orgId]);
        await client.end();
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
});
