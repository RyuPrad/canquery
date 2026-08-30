const { normalize, rowsFrom, PLACE_ALIAS_UPSERT_SQL } = require('../scripts/sync-places');

describe('Statistics Canada SGC place normalization', () => {
    test('upserts aliases against the migration 006 schema', () => {
        expect(PLACE_ALIAS_UPSERT_SQL).toContain('INSERT INTO place_aliases (slug, place_id)');
        expect(PLACE_ALIAS_UPSERT_SQL).not.toContain('created_at');
    });

    test('builds stable province, region and municipality ancestry', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3518', 'Class title': 'Durham' },
            { Level: '4', Code: '3518013', 'Class title': 'Oshawa' },
            { Level: '4', Code: '3518005', 'Class title': 'Ajax' }
        ];
        const fr = [
            { Code: '35', 'Titres de classes': 'Ontario' },
            { Code: '3518', 'Titres de classes': 'Durham' },
            { Code: '3518013', 'Titres de classes': 'Oshawa' },
            { Code: '3518005', 'Titres de classes': 'Ajax' }
        ];
        const result = normalize(en, fr);

        expect(result.places).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'ca', slug: 'canada', kind: 'country', parentId: null, featured: false }),
            expect.objectContaining({ id: 'ca-on', slug: 'ontario', kind: 'province', parentId: 'ca', featured: false }),
            expect.objectContaining({ id: 'ca-on-durham', slug: 'durham-on', kind: 'region', parentId: 'ca-on', featured: true }),
            expect.objectContaining({ id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality', parentId: 'ca-on-durham', featured: true }),
            expect.objectContaining({ id: 'sgc-csd-3518005', slug: 'ajax-on', kind: 'municipality', parentId: 'ca-on-durham', featured: true })
        ]));

        expect(result.identifiers).toEqual(expect.arrayContaining([
            { placeId: 'ca', scheme: 'sgc', vintage: '2021', value: '01' },
            { placeId: 'ca-on', scheme: 'sgc-pr', vintage: '2021', value: '35' },
            { placeId: 'ca-on-durham', scheme: 'sgc-cd', vintage: '2021', value: '3518' },
            { placeId: 'ca-on-oshawa', scheme: 'sgc-csd', vintage: '2021', value: '3518013' },
            { placeId: 'sgc-csd-3518005', scheme: 'sgc-csd', vintage: '2021', value: '3518005' }
        ]));
    });

    test('features the eight Durham municipalities with their official municipal types', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3518', 'Class title': 'Durham' },
            { Level: '4', Code: '3518001', 'Class title': 'Pickering' },
            { Level: '4', Code: '3518005', 'Class title': 'Ajax' },
            { Level: '4', Code: '3518009', 'Class title': 'Whitby' },
            { Level: '4', Code: '3518013', 'Class title': 'Oshawa' },
            { Level: '4', Code: '3518017', 'Class title': 'Clarington' },
            { Level: '4', Code: '3518020', 'Class title': 'Scugog' },
            { Level: '4', Code: '3518029', 'Class title': 'Uxbridge' },
            { Level: '4', Code: '3518039', 'Class title': 'Brock' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'ca-on-durham')).toEqual(expect.objectContaining({
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale', featured: true
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3518001')).toEqual(expect.objectContaining({
            slug: 'pickering-on', typeEn: 'City', typeFr: 'Ville', featured: true
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3518017')).toEqual(expect.objectContaining({
            slug: 'clarington-on', typeEn: 'Municipality', typeFr: 'Municipalité', featured: true
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3518020')).toEqual(expect.objectContaining({
            slug: 'scugog-on', typeEn: 'Township', typeFr: 'Canton', featured: true
        }));
    });

    test('features Peel and all three lower-tier municipalities with curated viewports', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3521', 'Class title': 'Peel' },
            { Level: '4', Code: '3521005', 'Class title': 'Mississauga' },
            { Level: '4', Code: '3521010', 'Class title': 'Brampton' },
            { Level: '4', Code: '3521024', 'Class title': 'Caledon' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3521')).toEqual(expect.objectContaining({
            slug: 'peel-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 43.75, longitude: -79.78, defaultZoom: 9
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3521005')).toEqual(expect.objectContaining({
            slug: 'mississauga-on', kind: 'municipality', parentId: 'sgc-cd-3521',
            typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 43.589, longitude: -79.644, defaultZoom: 10
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3521010')).toEqual(expect.objectContaining({
            slug: 'brampton-on', kind: 'municipality', parentId: 'sgc-cd-3521',
            typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 43.7315, longitude: -79.7624, defaultZoom: 10
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3521024')).toEqual(expect.objectContaining({
            slug: 'caledon-on', kind: 'municipality', parentId: 'sgc-cd-3521',
            typeEn: 'Town', typeFr: 'Ville',
            featured: true, latitude: 43.8668, longitude: -79.867, defaultZoom: 9
        }));
    });

    test('decodes CSV buffers and produces URL-safe accents', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2466', 'Class title': 'Montréal' },
            { Level: '4', Code: '2466023', 'Class title': 'Montréal' }
        ];
        const fr = [
            { Code: '24', 'Titres de classes': 'Québec' },
            { Code: '2466', 'Titres de classes': 'Montréal' },
            { Code: '2466023', 'Titres de classes': 'Montréal' }
        ];
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-pr-24')).toEqual(expect.objectContaining({
            slug: 'quebec', nameFr: 'Québec'
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-2466')).toEqual(expect.objectContaining({
            slug: 'montreal-region-qc', nameEn: 'Montréal'
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-2466023')).toEqual(expect.objectContaining({
            slug: 'montreal-qc', nameEn: 'Montréal'
        }));
    });

    test('decodes the official Windows-1252 accents and rejects replacement characters', () => {
        const csv = Buffer.concat([
            Buffer.from('Level,Code,Class title\r\n2,24,Qu'),
            Buffer.from([0xe9]),
            Buffer.from('bec\r\n')
        ]);
        expect(rowsFrom(csv, 'windows-1252')).toEqual([{
            Level: '2', Code: '24', 'Class title': 'Québec'
        }]);
        expect(() => rowsFrom(Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0xc3, 0x28])))
            .toThrow(/replacement characters/i);
    });

    test('keeps Montréal region and city distinct and features only the city', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2466', 'Class title': 'Montréal' },
            { Level: '4', Code: '2466023', 'Class title': 'Montréal' },
            { Level: '4', Code: '2466005', 'Class title': 'Montréal-Est' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-2466')).toEqual(expect.objectContaining({
            slug: 'montreal-region-qc', kind: 'region', parentId: 'sgc-pr-24', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-2466023')).toEqual(expect.objectContaining({
            slug: 'montreal-qc', kind: 'municipality', parentId: 'sgc-cd-2466',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 45.5019, longitude: -73.5674, defaultZoom: 10
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-2466005')).toEqual(expect.objectContaining({
            slug: 'montreal-est-qc', kind: 'municipality', parentId: 'sgc-cd-2466', featured: false
        }));
    });

    test('keeps the Québec census division distinct from its featured city', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2423', 'Class title': 'Québec' },
            { Level: '4', Code: '2423027', 'Class title': 'Québec' },
            { Level: '4', Code: '2423015', 'Class title': 'Saint-Augustin-de-Desmaures' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-2423')).toEqual(expect.objectContaining({
            slug: 'quebec-region-qc', kind: 'region', parentId: 'sgc-pr-24', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-2423027')).toEqual(expect.objectContaining({
            slug: 'quebec-qc', kind: 'municipality', parentId: 'sgc-cd-2423',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 46.8139, longitude: -71.208, defaultZoom: 10
        }));
    });

    test('merges Laval census-division and subdivision identities into one city', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2465', 'Class title': 'Laval' },
            { Level: '4', Code: '2465005', 'Class title': 'Laval' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.filter(place => place.id.includes('2465'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-2465')).toEqual(expect.objectContaining({
            slug: 'laval-qc', kind: 'municipality', parentId: 'sgc-pr-24',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 45.6066, longitude: -73.7124, defaultZoom: 10
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            { placeId: 'sgc-cd-2465', scheme: 'sgc-cd', vintage: '2021', value: '2465' },
            { placeId: 'sgc-cd-2465', scheme: 'sgc-csd', vintage: '2021', value: '2465005' }
        ]));
    });

    test('features Vancouver as a canonical city beneath Greater Vancouver', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915022', 'Class title': 'Vancouver' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-pr-59')).toEqual(expect.objectContaining({
            slug: 'british-columbia', kind: 'province', parentId: 'ca', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-5915')).toEqual(expect.objectContaining({
            slug: 'greater-vancouver-bc', kind: 'region', parentId: 'sgc-pr-59', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-5915022')).toEqual(expect.objectContaining({
            slug: 'vancouver-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 49.2827, longitude: -123.1207, defaultZoom: 10
        }));
    });

    test('features Surrey as a canonical city beneath Greater Vancouver', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915004', 'Class title': 'Surrey' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5915004')).toEqual(expect.objectContaining({
            slug: 'surrey-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 49.1913, longitude: -122.849, defaultZoom: 10
        }));
    });

    test('keeps the Halifax census division and featured regional municipality distinct', () => {
        const en = [
            { Level: '2', Code: '12', 'Class title': 'Nova Scotia' },
            { Level: '3', Code: '1209', 'Class title': 'Halifax' },
            { Level: '4', Code: '1209034', 'Class title': 'Halifax' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-1209')).toEqual(expect.objectContaining({
            slug: 'halifax-region-ns', kind: 'region', parentId: 'sgc-pr-12', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-1209034')).toEqual(expect.objectContaining({
            slug: 'halifax-ns', kind: 'municipality', parentId: 'sgc-cd-1209',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 44.6488, longitude: -63.5752, defaultZoom: 8
        }));
    });

    test('features Calgary beneath Division No. 6 with its curated viewport', () => {
        const en = [
            { Level: '2', Code: '48', 'Class title': 'Alberta' },
            { Level: '3', Code: '4806', 'Class title': 'Division No.  6' },
            { Level: '4', Code: '4806016', 'Class title': 'Calgary' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-pr-48')).toEqual(expect.objectContaining({
            slug: 'alberta', kind: 'province', parentId: 'ca', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-4806')).toEqual(expect.objectContaining({
            slug: 'division-no-6-ab', kind: 'region', parentId: 'sgc-pr-48', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-4806016')).toEqual(expect.objectContaining({
            slug: 'calgary-ab', kind: 'municipality', parentId: 'sgc-cd-4806',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 51.0447, longitude: -114.0719, defaultZoom: 9
        }));
    });

    test('features Edmonton and Winnipeg beneath their separate Division No. 11 parents', () => {
        const en = [
            { Level: '2', Code: '48', 'Class title': 'Alberta' },
            { Level: '3', Code: '4811', 'Class title': 'Division No. 11' },
            { Level: '4', Code: '4811061', 'Class title': 'Edmonton' },
            { Level: '2', Code: '46', 'Class title': 'Manitoba' },
            { Level: '3', Code: '4611', 'Class title': 'Division No. 11' },
            { Level: '4', Code: '4611040', 'Class title': 'Winnipeg' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-4811')).toEqual(expect.objectContaining({
            slug: 'division-no-11-ab', kind: 'region', parentId: 'sgc-pr-48', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-4811061')).toEqual(expect.objectContaining({
            slug: 'edmonton-ab', kind: 'municipality', parentId: 'sgc-cd-4811',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 53.5461, longitude: -113.4938, defaultZoom: 9
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-4611')).toEqual(expect.objectContaining({
            slug: 'division-no-11-mb', kind: 'region', parentId: 'sgc-pr-46', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-4611040')).toEqual(expect.objectContaining({
            slug: 'winnipeg-mb', kind: 'municipality', parentId: 'sgc-cd-4611',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 49.8954, longitude: -97.1385, defaultZoom: 9
        }));
    });

    test('plans former-slug aliases and fails closed on ownership conflicts', () => {
        const { planAliases } = require('../scripts/sync-places');
        const existingPlaces = [
            { id: 'ca-on-durham', slug: 'durham-on' },
            { id: 'sgc-csd-3518005', slug: 'ajax-on' }
        ];
        const canonicalPlaces = [
            { id: 'ca-on-durham', slug: 'durham-region-on' },
            { id: 'sgc-csd-3518005', slug: 'ajax-on' }
        ];
        const existingAliases = [
            { slug: 'durham', placeId: 'ca-on-durham' }
        ];

        const planned = planAliases(existingPlaces, canonicalPlaces, existingAliases);
        expect(planned.aliasesToAdd).toEqual([
            { slug: 'durham-on', placeId: 'ca-on-durham' }
        ]);
        expect(planned.conflicts).toHaveLength(0);

        const conflicted = planAliases(
            [{ id: 'place-a', slug: 'shared-slug' }],
            [{ id: 'place-a', slug: 'place-a-new' }],
            [{ slug: 'shared-slug', placeId: 'place-b' }]
        );
        expect(conflicted.conflicts).toEqual([
            expect.objectContaining({ slug: 'shared-slug', expectedPlaceId: 'place-a', existingPlaceId: 'place-b' })
        ]);
    });

    test('merges Ottawa census-division and subdivision identities into one city', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3506', 'Class title': 'Ottawa' },
            { Level: '4', Code: '3506008', 'Class title': 'Ottawa' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.filter(place => place.id.includes('3506'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3506')).toEqual(expect.objectContaining({
            slug: 'ottawa-on', kind: 'municipality', parentId: 'ca-on',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 45.4215, longitude: -75.6972, defaultZoom: 9
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            { placeId: 'sgc-cd-3506', scheme: 'sgc-cd', vintage: '2021', value: '3506' },
            { placeId: 'sgc-cd-3506', scheme: 'sgc-csd', vintage: '2021', value: '3506008' }
        ]));
    });

    test('merges Toronto census-division and subdivision identities into one city', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3520', 'Class title': 'Toronto' },
            { Level: '4', Code: '3520005', 'Class title': 'Toronto' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.filter(place => place.id.includes('3520'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3520')).toEqual(expect.objectContaining({
            slug: 'toronto-on', kind: 'municipality', parentId: 'ca-on',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 43.6532, longitude: -79.3832, defaultZoom: 10
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            { placeId: 'sgc-cd-3520', scheme: 'sgc-cd', vintage: '2021', value: '3520' },
            { placeId: 'sgc-cd-3520', scheme: 'sgc-csd', vintage: '2021', value: '3520005' }
        ]));
    });

    test('merges the City of Hamilton while disambiguating Hamilton Township', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3525', 'Class title': 'Hamilton' },
            { Level: '4', Code: '3525005', 'Class title': 'Hamilton' },
            { Level: '3', Code: '3514', 'Class title': 'Northumberland' },
            { Level: '4', Code: '3514019', 'Class title': 'Hamilton' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.filter(place => place.id.includes('3525'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3525')).toEqual(expect.objectContaining({
            slug: 'hamilton-on', kind: 'municipality', parentId: 'ca-on',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 43.2557, longitude: -79.8711, defaultZoom: 9
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3514019')).toEqual(expect.objectContaining({
            slug: 'hamilton-township-on', kind: 'municipality', parentId: 'sgc-cd-3514',
            typeEn: 'Township', typeFr: 'Canton', featured: false
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            { placeId: 'sgc-cd-3525', scheme: 'sgc-cd', vintage: '2021', value: '3525' },
            { placeId: 'sgc-cd-3525', scheme: 'sgc-csd', vintage: '2021', value: '3525005' },
            { placeId: 'sgc-csd-3514019', scheme: 'sgc-csd', vintage: '2021', value: '3514019' }
        ]));
    });

    test('features Waterloo Region and all seven lower-tier municipalities with curated viewports', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3530', 'Class title': 'Waterloo' },
            { Level: '4', Code: '3530013', 'Class title': 'Kitchener' },
            { Level: '4', Code: '3530016', 'Class title': 'Waterloo' },
            { Level: '4', Code: '3530010', 'Class title': 'Cambridge' },
            { Level: '4', Code: '3530035', 'Class title': 'Woolwich' },
            { Level: '4', Code: '3530020', 'Class title': 'Wilmot' },
            { Level: '4', Code: '3530027', 'Class title': 'Wellesley' },
            { Level: '4', Code: '3530004', 'Class title': 'North Dumfries' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3530')).toEqual(expect.objectContaining({
            slug: 'waterloo-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 43.4643, longitude: -80.5204, defaultZoom: 9
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3530013')).toEqual(expect.objectContaining({
            slug: 'kitchener-on', kind: 'municipality', parentId: 'sgc-cd-3530',
            typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 43.4516, longitude: -80.4925, defaultZoom: 10
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3530016')).toEqual(expect.objectContaining({
            slug: 'waterloo-on', kind: 'municipality', parentId: 'sgc-cd-3530',
            typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 43.4643, longitude: -80.5204, defaultZoom: 10
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3530010')).toEqual(expect.objectContaining({
            slug: 'cambridge-on', kind: 'municipality', parentId: 'sgc-cd-3530',
            typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 43.3616, longitude: -80.3144, defaultZoom: 10
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-3530035')).toEqual(expect.objectContaining({
            slug: 'woolwich-on', kind: 'municipality', parentId: 'sgc-cd-3530',
            typeEn: 'Township', typeFr: 'Canton',
            featured: true, latitude: 43.565, longitude: -80.55, defaultZoom: 9
        }));
    });

    test('features Victoria, London, Kelowna, and Fredericton with curated viewports', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5917', 'Class title': 'Capital' },
            { Level: '4', Code: '5917034', 'Class title': 'Victoria' },
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3539', 'Class title': 'Middlesex' },
            { Level: '4', Code: '3539036', 'Class title': 'London' },
            { Level: '3', Code: '5935', 'Class title': 'Central Okanagan' },
            { Level: '4', Code: '5935010', 'Class title': 'Kelowna' },
            { Level: '2', Code: '13', 'Class title': 'New Brunswick' },
            { Level: '3', Code: '1310', 'Class title': 'York' },
            { Level: '4', Code: '1310032', 'Class title': 'Fredericton' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5917034')).toEqual(expect.objectContaining({
            slug: 'victoria-bc', kind: 'municipality', parentId: 'sgc-cd-5917',
            typeEn: 'City', featured: true, latitude: 48.4284, longitude: -123.3656, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3539036')).toEqual(expect.objectContaining({
            slug: 'london-on', kind: 'municipality', parentId: 'sgc-cd-3539',
            typeEn: 'City', featured: true, latitude: 42.9849, longitude: -81.2453, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5935010')).toEqual(expect.objectContaining({
            slug: 'kelowna-bc', kind: 'municipality', parentId: 'sgc-cd-5935',
            typeEn: 'City', featured: true, latitude: 49.888, longitude: -119.496, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1310032')).toEqual(expect.objectContaining({
            slug: 'fredericton-nb', kind: 'municipality', parentId: 'sgc-cd-1310',
            typeEn: 'City', featured: true, latitude: 45.9636, longitude: -66.6431, defaultZoom: 10
        }));
    });

    test('configures Halton Region as a regional cluster with Oakville, Burlington, Milton, and Halton Hills', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3524', 'Class title': 'Halton' },
            { Level: '4', Code: '3524001', 'Class title': 'Oakville' },
            { Level: '4', Code: '3524002', 'Class title': 'Burlington' },
            { Level: '4', Code: '3524009', 'Class title': 'Milton' },
            { Level: '4', Code: '3524015', 'Class title': 'Halton Hills' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3524')).toEqual(expect.objectContaining({
            slug: 'halton-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', featured: true, latitude: 43.4900, longitude: -79.8800, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524001')).toEqual(expect.objectContaining({
            slug: 'oakville-on', kind: 'municipality', parentId: 'sgc-cd-3524',
            typeEn: 'Town', featured: true, latitude: 43.4675, longitude: -79.6877, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524002')).toEqual(expect.objectContaining({
            slug: 'burlington-on', kind: 'municipality', parentId: 'sgc-cd-3524',
            typeEn: 'City', featured: true, latitude: 43.3255, longitude: -79.7990, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524009')).toEqual(expect.objectContaining({
            slug: 'milton-on', kind: 'municipality', parentId: 'sgc-cd-3524',
            typeEn: 'Town', featured: true, latitude: 43.5183, longitude: -79.8774, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524015')).toEqual(expect.objectContaining({
            slug: 'halton-hills-on', kind: 'municipality', parentId: 'sgc-cd-3524',
            typeEn: 'Town', featured: true, latitude: 43.6300, longitude: -79.9500, defaultZoom: 9
        }));
    });

    test('merges Greater Sudbury census-division and subdivision into one single-tier city', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3553', 'Class title': 'Greater Sudbury / Grand Sudbury' },
            { Level: '4', Code: '3553005', 'Class title': 'Greater Sudbury / Grand Sudbury' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.filter(place => place.id.includes('3553'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3553')).toEqual(expect.objectContaining({
            slug: 'greater-sudbury-on', kind: 'municipality', parentId: 'ca-on',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 46.4900, longitude: -80.9900, defaultZoom: 9
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            { placeId: 'sgc-cd-3553', scheme: 'sgc-cd', vintage: '2021', value: '3553' },
            { placeId: 'sgc-cd-3553', scheme: 'sgc-csd', vintage: '2021', value: '3553005' }
        ]));
    });

    test('features Burnaby beneath Greater Vancouver and Saskatoon beneath Saskatchewan', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915025', 'Class title': 'Burnaby' },
            { Level: '2', Code: '47', 'Class title': 'Saskatchewan' },
            { Level: '3', Code: '4711', 'Class title': 'Division No. 11' },
            { Level: '4', Code: '4711066', 'Class title': 'Saskatoon' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5915025')).toEqual(expect.objectContaining({
            slug: 'burnaby-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
            typeEn: 'City', featured: true, latitude: 49.2488, longitude: -122.9805, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4711066')).toEqual(expect.objectContaining({
            slug: 'saskatoon-sk', kind: 'municipality', parentId: 'sgc-cd-4711',
            typeEn: 'City', featured: true, latitude: 52.1332, longitude: -106.6700, defaultZoom: 10
        }));
    });

    test('features York Region cluster with curated viewports and lower-tier municipalities', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3519', 'Class title': 'York' },
            { Level: '4', Code: '3519036', 'Class title': 'Markham' },
            { Level: '4', Code: '3519048', 'Class title': 'Newmarket' },
            { Level: '4', Code: '3519028', 'Class title': 'Vaughan' },
            { Level: '4', Code: '3519038', 'Class title': 'Richmond Hill' },
            { Level: '4', Code: '3519046', 'Class title': 'Aurora' },
            { Level: '4', Code: '3519044', 'Class title': 'Whitchurch-Stouffville' },
            { Level: '4', Code: '3519049', 'Class title': 'King' },
            { Level: '4', Code: '3519054', 'Class title': 'East Gwillimbury' },
            { Level: '4', Code: '3519070', 'Class title': 'Georgina' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3519')).toEqual(expect.objectContaining({
            slug: 'york-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', featured: true, latitude: 44.0000, longitude: -79.4667, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3519036')).toEqual(expect.objectContaining({
            slug: 'markham-on', kind: 'municipality', parentId: 'sgc-cd-3519',
            typeEn: 'City', featured: true, latitude: 43.8561, longitude: -79.3370, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3519048')).toEqual(expect.objectContaining({
            slug: 'newmarket-on', kind: 'municipality', parentId: 'sgc-cd-3519',
            typeEn: 'Town', featured: true, latitude: 44.0592, longitude: -79.4613, defaultZoom: 10
        }));
    });

    test('features Niagara Region cluster with curated viewports and lower-tier municipalities', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3526', 'Class title': 'Niagara' },
            { Level: '4', Code: '3526043', 'Class title': 'Niagara Falls' },
            { Level: '4', Code: '3526032', 'Class title': 'Welland' },
            { Level: '4', Code: '3526053', 'Class title': 'St. Catharines' },
            { Level: '4', Code: '3526003', 'Class title': 'Fort Erie' },
            { Level: '4', Code: '3526011', 'Class title': 'Port Colborne' },
            { Level: '4', Code: '3526037', 'Class title': 'Thorold' },
            { Level: '4', Code: '3526047', 'Class title': 'Niagara-on-the-Lake' },
            { Level: '4', Code: '3526057', 'Class title': 'Lincoln' },
            { Level: '4', Code: '3526065', 'Class title': 'Grimsby' },
            { Level: '4', Code: '3526028', 'Class title': 'Pelham' },
            { Level: '4', Code: '3526021', 'Class title': 'West Lincoln' },
            { Level: '4', Code: '3526014', 'Class title': 'Wainfleet' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3526')).toEqual(expect.objectContaining({
            slug: 'niagara-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', featured: true, latitude: 43.0600, longitude: -79.3100, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3526043')).toEqual(expect.objectContaining({
            slug: 'niagara-falls-on', kind: 'municipality', parentId: 'sgc-cd-3526',
            typeEn: 'City', featured: true, latitude: 43.0896, longitude: -79.0849, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3526032')).toEqual(expect.objectContaining({
            slug: 'welland-on', kind: 'municipality', parentId: 'sgc-cd-3526',
            typeEn: 'City', featured: true, latitude: 42.9922, longitude: -79.2483, defaultZoom: 10
        }));
    });

    test('features Moncton, Guelph, Saanich, and Belleville municipal anchors', () => {
        const en = [
            { Level: '2', Code: '13', 'Class title': 'New Brunswick' },
            { Level: '3', Code: '1307', 'Class title': 'Westmorland' },
            { Level: '4', Code: '1307019', 'Class title': 'Moncton' },
            { Level: '4', Code: '1307022', 'Class title': 'Moncton' },
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3523', 'Class title': 'Wellington' },
            { Level: '4', Code: '3523008', 'Class title': 'Guelph' },
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5917', 'Class title': 'Capital' },
            { Level: '4', Code: '5917021', 'Class title': 'Saanich' },
            { Level: '3', Code: '3512', 'Class title': 'Hastings' },
            { Level: '4', Code: '3512005', 'Class title': 'Belleville' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-1307019')).toEqual(expect.objectContaining({
            slug: 'moncton-parish-nb', kind: 'municipality', parentId: 'sgc-cd-1307',
            typeEn: 'Parish', featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1307022')).toEqual(expect.objectContaining({
            slug: 'moncton-nb', kind: 'municipality', parentId: 'sgc-cd-1307',
            typeEn: 'City', featured: true, latitude: 46.0878, longitude: -64.7782, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3523008')).toEqual(expect.objectContaining({
            slug: 'guelph-on', kind: 'municipality', parentId: 'sgc-cd-3523',
            typeEn: 'City', featured: true, latitude: 43.5448, longitude: -80.2482, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5917021')).toEqual(expect.objectContaining({
            slug: 'saanich-bc', kind: 'municipality', parentId: 'sgc-cd-5917',
            typeEn: 'District municipality', featured: true, latitude: 48.4841, longitude: -123.3822, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3512005')).toEqual(expect.objectContaining({
            slug: 'belleville-on', kind: 'municipality', parentId: 'sgc-cd-3512',
            typeEn: 'City', featured: true, latitude: 44.1628, longitude: -77.3832, defaultZoom: 10
        }));
    });

    test('features Yellowknife, Barrie, Thunder Bay, Chatham-Kent, Kawartha Lakes, Summerland, Norfolk, and Haldimand', () => {
        const en = [
            { Level: '2', Code: '61', 'Class title': 'Northwest Territories' },
            { Level: '3', Code: '6106', 'Class title': 'Region 6' },
            { Level: '4', Code: '6106023', 'Class title': 'Yellowknife' },
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3543', 'Class title': 'Simcoe' },
            { Level: '4', Code: '3543042', 'Class title': 'Barrie' },
            { Level: '3', Code: '3558', 'Class title': 'Thunder Bay' },
            { Level: '4', Code: '3558004', 'Class title': 'Thunder Bay' },
            { Level: '3', Code: '3536', 'Class title': 'Chatham-Kent' },
            { Level: '4', Code: '3536020', 'Class title': 'Chatham-Kent' },
            { Level: '3', Code: '3516', 'Class title': 'Kawartha Lakes' },
            { Level: '4', Code: '3516010', 'Class title': 'Kawartha Lakes' },
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5907', 'Class title': 'Okanagan-Similkameen' },
            { Level: '4', Code: '5907035', 'Class title': 'Summerland' },
            { Level: '3', Code: '3528', 'Class title': 'Haldimand-Norfolk' },
            { Level: '4', Code: '3528052', 'Class title': 'Norfolk County' },
            { Level: '4', Code: '3528018', 'Class title': 'Haldimand County' },
            { Level: '2', Code: '48', 'Class title': 'Alberta' },
            { Level: '3', Code: '4802', 'Class title': 'Division No. 2' },
            { Level: '4', Code: '4802012', 'Class title': 'Lethbridge' },
            { Level: '3', Code: '4801', 'Class title': 'Division No. 1' },
            { Level: '4', Code: '4801006', 'Class title': 'Medicine Hat' },
            { Level: '3', Code: '4806', 'Class title': 'Division No. 6' },
            { Level: '4', Code: '4806021', 'Class title': 'Airdrie' },
            { Level: '3', Code: '4815', 'Class title': 'Division No. 15' },
            { Level: '4', Code: '4815023', 'Class title': 'Canmore' },
            { Level: '4', Code: '5907041', 'Class title': 'Penticton' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915001', 'Class title': 'Langley' },
            { Level: '3', Code: '3540', 'Class title': 'Huron' },
            { Level: '2', Code: '12', 'Class title': 'Nova Scotia' },
            { Level: '3', Code: '1211', 'Class title': 'Cumberland' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-6106023')).toEqual(expect.objectContaining({
            slug: 'yellowknife-nt', kind: 'municipality', parentId: 'sgc-cd-6106',
            typeEn: 'City', featured: true, latitude: 62.4540, longitude: -114.3718, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3543042')).toEqual(expect.objectContaining({
            slug: 'barrie-on', kind: 'municipality', parentId: 'sgc-cd-3543',
            typeEn: 'City', featured: true, latitude: 44.3894, longitude: -79.6903, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3558004')).toEqual(expect.objectContaining({
            slug: 'thunder-bay-on', kind: 'municipality', parentId: 'sgc-cd-3558',
            typeEn: 'City', featured: true, latitude: 48.3809, longitude: -89.2477, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3536')).toEqual(expect.objectContaining({
            slug: 'chatham-kent-on', kind: 'municipality', parentId: 'ca-on',
            typeEn: 'Municipality', featured: true, latitude: 42.4048, longitude: -82.1910, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3516')).toEqual(expect.objectContaining({
            slug: 'kawartha-lakes-on', kind: 'municipality', parentId: 'ca-on',
            typeEn: 'City', featured: true, latitude: 44.3564, longitude: -78.7408, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5907035')).toEqual(expect.objectContaining({
            slug: 'summerland-bc', kind: 'municipality', parentId: 'sgc-cd-5907',
            typeEn: 'District municipality', featured: true, latitude: 49.6006, longitude: -119.6778, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3528052')).toEqual(expect.objectContaining({
            slug: 'norfolk-county-on', kind: 'municipality', parentId: 'sgc-cd-3528',
            typeEn: 'City', featured: true, latitude: 42.8333, longitude: -80.3833, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3528018')).toEqual(expect.objectContaining({
            slug: 'haldimand-county-on', kind: 'municipality', parentId: 'sgc-cd-3528',
            typeEn: 'City', featured: true, latitude: 42.9333, longitude: -79.8667, defaultZoom: 9
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-4802012')).toEqual(expect.objectContaining({
            slug: 'lethbridge-ab', kind: 'municipality', parentId: 'sgc-cd-4802',
            typeEn: 'City', featured: true, latitude: 49.6956, longitude: -112.8451, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4801006')).toEqual(expect.objectContaining({
            slug: 'medicine-hat-ab', kind: 'municipality', parentId: 'sgc-cd-4801',
            typeEn: 'City', featured: true, latitude: 50.0417, longitude: -110.6775, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4806021')).toEqual(expect.objectContaining({
            slug: 'airdrie-ab', kind: 'municipality', parentId: 'sgc-cd-4806',
            typeEn: 'City', featured: true, latitude: 51.2917, longitude: -114.0144, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4815023')).toEqual(expect.objectContaining({
            slug: 'canmore-ab', kind: 'municipality', parentId: 'sgc-cd-4815',
            typeEn: 'Town', featured: true, latitude: 51.0890, longitude: -115.3590, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5907041')).toEqual(expect.objectContaining({
            slug: 'penticton-bc', kind: 'municipality', parentId: 'sgc-cd-5907',
            typeEn: 'City', featured: true, latitude: 49.4991, longitude: -119.5937, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5915001')).toEqual(expect.objectContaining({
            slug: 'langley-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
            typeEn: 'City', featured: true, latitude: 49.1044, longitude: -122.6580, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3540')).toEqual(expect.objectContaining({
            slug: 'huron-county-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'County', featured: true, latitude: 43.5833, longitude: -81.5000, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-1211')).toEqual(expect.objectContaining({
            slug: 'cumberland-county-ns', kind: 'region', parentId: 'sgc-pr-12',
            typeEn: 'County', featured: true, latitude: 45.7500, longitude: -64.0000, defaultZoom: 8
        }));
    });

    test('normalizes the v33-v35 municipalities with canonical ancestry and viewports', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2481', 'Class title': 'Gatineau' },
            { Level: '4', Code: '2481017', 'Class title': 'Gatineau' },
            { Level: '3', Code: '2425', 'Class title': 'Lévis' },
            { Level: '4', Code: '2425213', 'Class title': 'Lévis' },
            { Level: '3', Code: '2454', 'Class title': 'Les Maskoutains' },
            { Level: '4', Code: '2454048', 'Class title': 'Saint-Hyacinthe' },
            { Level: '2', Code: '13', 'Class title': 'New Brunswick' },
            { Level: '3', Code: '1301', 'Class title': 'Saint John' },
            { Level: '4', Code: '1301006', 'Class title': 'Saint John' },
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915034', 'Class title': 'Coquitlam' },
            { Level: '4', Code: '5915029', 'Class title': 'New Westminster' },
            { Level: '4', Code: '5915043', 'Class title': 'Port Moody' },
            { Level: '4', Code: '5915075', 'Class title': 'Maple Ridge' },
            { Level: '4', Code: '5915039', 'Class title': 'Port Coquitlam' },
            { Level: '3', Code: '5953', 'Class title': 'Fraser-Fort George' },
            { Level: '4', Code: '5953023', 'Class title': 'Prince George' },
            { Level: '3', Code: '5931', 'Class title': 'Squamish-Lillooet' },
            { Level: '4', Code: '5931006', 'Class title': 'Squamish' },
            { Level: '3', Code: '5933', 'Class title': 'Thompson-Nicola' },
            { Level: '4', Code: '5933042', 'Class title': 'Kamloops' },
            { Level: '2', Code: '60', 'Class title': 'Yukon' },
            { Level: '3', Code: '6001', 'Class title': 'Yukon' },
            { Level: '4', Code: '6001009', 'Class title': 'Whitehorse' },
            { Level: '2', Code: '47', 'Class title': 'Saskatchewan' },
            { Level: '3', Code: '4706', 'Class title': 'Division No. 6' },
            { Level: '4', Code: '4706027', 'Class title': 'Regina' },
            { Level: '2', Code: '61', 'Class title': 'Northwest Territories' },
            { Level: '3', Code: '6106', 'Class title': 'Region 6' },
            { Level: '4', Code: '6106023', 'Class title': 'Yellowknife' }
        ];
        const frenchNames = new Map([
            ['24', 'Québec'], ['2425', 'Lévis'], ['2425213', 'Lévis'],
            ['61', 'Territoires du Nord-Ouest']
        ]);
        const fr = en.map(row => ({
            Code: row.Code,
            'Titres de classes': frenchNames.get(row.Code) || row['Class title']
        }));
        const result = normalize(en, fr);

        const expected = [
            ['sgc-csd-2481017', 'gatineau-qc', 'sgc-cd-2481', 45.4765, -75.7013],
            ['sgc-csd-2425213', 'levis-qc', 'sgc-cd-2425', 46.8033, -71.1779],
            ['sgc-csd-2454048', 'saint-hyacinthe-qc', 'sgc-cd-2454', 45.6307, -72.9569],
            ['sgc-csd-1301006', 'saint-john-nb', 'sgc-cd-1301', 45.2733, -66.0633],
            ['sgc-csd-5915034', 'coquitlam-bc', 'sgc-cd-5915', 49.2838, -122.7932],
            ['sgc-csd-5915029', 'new-westminster-bc', 'sgc-cd-5915', 49.2057, -122.911],
            ['sgc-csd-5915043', 'port-moody-bc', 'sgc-cd-5915', 49.2838, -122.8317],
            ['sgc-csd-5915075', 'maple-ridge-bc', 'sgc-cd-5915', 49.2193, -122.5984],
            ['sgc-csd-5915039', 'port-coquitlam-bc', 'sgc-cd-5915', 49.2628, -122.7811],
            ['sgc-csd-5953023', 'prince-george-bc', 'sgc-cd-5953', 53.9171, -122.7497],
            ['sgc-csd-5931006', 'squamish-bc', 'sgc-cd-5931', 49.7016, -123.1558],
            ['sgc-csd-5933042', 'kamloops-bc', 'sgc-cd-5933', 50.6745, -120.3273],
            ['sgc-csd-6001009', 'whitehorse-yt', 'sgc-cd-6001', 60.7212, -135.0568],
            ['sgc-csd-4706027', 'regina-sk', 'sgc-cd-4706', 50.4452, -104.6189]
        ];
        for (const [id, slug, parentId, latitude, longitude] of expected) {
            expect(result.places.find(place => place.id === id)).toEqual(expect.objectContaining({
                slug, parentId, kind: 'municipality', featured: true,
                latitude, longitude
            }));
        }
        expect(result.places.find(place => place.id === 'sgc-pr-61')).toEqual(expect.objectContaining({
            kind: 'territory', nameFr: 'Territoires du Nord-Ouest', featured: false
        }));
        expect(JSON.stringify(result)).not.toContain('\uFFFD');
    });
});
