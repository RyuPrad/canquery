const { Pool } = require('pg');
const { searchDatasets } = require('../db/catalogReadQueries');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

integrationDescribe('resident search PostgreSQL integration', () => {
    let pool, db;
    const prefix = 'resident_test_' + process.pid;
    const id = name => prefix + '_' + name;
    const search = (q, args = {}) => searchDatasets({
        q, org: prefix, limit: 20, offset: 0, ...args
    }, db);

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        await db.query('INSERT INTO organizations (id, name) VALUES ($1, $1)', [prefix]);
        const datasets = [
            ['parks', 'Green Spaces', null, 'Neighbourhood parks and green spaces beside a school.', null, 'sgc-cd-3520'],
            ['parking', 'Parking Lot Facilities', null, 'Park your vehicle. Parking lots for vehicles.', null, 'sgc-cd-3520'],
            ['fr', null, 'Parcs et espaces publics', null, 'Les grands parcs et les espaces verts de Montréal.', 'sgc-csd-2466023'],
            ['play', 'Recreation Facilities', null, 'Outdoor playgrounds for children.', null, 'sgc-cd-3520'],
            ['permits', 'Building Permits', null, 'Active building applications and permits.', null, 'sgc-cd-3520']
        ];
        for (const [key, en, fr, notesEn, notesFr, place] of datasets) {
            await db.query(`INSERT INTO datasets (id, name, org_id, title_en, title_fr, notes_en, notes_fr)
                VALUES ($1, $1, $2, $3, $4, $5, $6)`, [id(key), prefix, en, fr, notesEn, notesFr]);
            await db.query(`INSERT INTO dataset_places (source_id, dataset_id, place_id, relationship, assignment_method)
                VALUES ('open-canada', $1, $2, 'direct', 'manual')`, [id(key), place]);
            await db.query(`INSERT INTO resources (id, dataset_id, format, url, datastore_active)
                VALUES ($1, $2, 'CSV', 'https://example.test/data.csv', $3)`, [id(key + '_resource'), id(key), key === 'permits']);
        }
        await db.query(`INSERT INTO resource_maps (resource_id, provider, service_url, geometry_type)
            VALUES ($1, 'arcgis', 'https://example.test/FeatureServer/0', 'polygon')`, [id('parks_resource')]);
    });

    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });

    test('ranks literal parks ahead of parking, retaining indexed recall', async () => {
        const rows = await search('parks', { place: 'toronto-on' });
        expect(rows[0].id).toBe(id('parks'));
        expect(rows.map(row => row.id)).toContain(id('parking'));
        expect(rows[0].preview_map_id).toBe(id('parks_resource'));
        expect(rows[0].preview_table_id).toBeNull();
    });

    test('finds French records using English and English records using French', async () => {
        expect((await search('parks', { place: 'montreal-qc' })).map(row => row.id)).toEqual([id('fr')]);
        expect((await search('parcs', { place: 'toronto-on' }))[0].id).toBe(id('parks'));
        expect((await search('permis de construction'))[0]).toMatchObject({ id: id('permits'), preview_table_id: id('permits_resource') });
    });

    test('keeps extra words, geography, format, map filters and pagination', async () => {
        expect((await search('parks school')).map(row => row.id)).toEqual([id('parks')]);
        expect(await search('building permits', { place: 'montreal-qc' })).toEqual([]);
        expect(await search('parks', { format: 'PDF' })).toEqual([]);
        expect((await search('parks', { mappable: true })).map(row => row.id)).toEqual([id('parks')]);
        const first = await search('parks', { limit: 1 });
        const second = await search('parks', { limit: 1, offset: 1 });
        expect(first[0].id).not.toBe(second[0].id);
    });

    test('handles empty browsing, punctuation and stop words without SQL errors', async () => {
        expect((await search(null)).length).toBe(5);
        expect(await search("' | ! ;")).toEqual([]);
        expect(await search('the')).toEqual([]);
    });
});
