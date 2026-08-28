const { normalize, slugify, rowsFrom, preflightPlaceChanges } = require('../scripts/sync-places');

describe('Statistics Canada SGC place normalization', () => {
    test('builds stable province, region and municipality ancestry', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3518', 'Class title': 'Durham' },
            { Level: '4', Code: '3518013', 'Class title': 'Oshawa' }
        ];
        const fr = [
            { Code: '35', 'Titres de classes': 'Ontario' },
            { Code: '3518', 'Titres de classes': 'Durham' },
            { Code: '3518013', 'Titres de classes': 'Oshawa' }
        ];
        const result = normalize(en, fr);
        expect(result.places.find(place => place.id === 'ca-on')).toEqual(expect.objectContaining({ parentId: 'ca', slug: 'ontario' }));
        expect(result.places.find(place => place.id === 'ca-on-durham')).toEqual(expect.objectContaining({
            parentId: 'ca-on', slug: 'durham-on', featured: true,
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale'
        }));
        expect(result.places.find(place => place.id === 'ca-on-oshawa')).toEqual(expect.objectContaining({
            parentId: 'ca-on-durham', slug: 'oshawa-on', featured: true,
            typeEn: 'City', typeFr: 'Ville'
        }));
    });

    test('features the eight Durham municipalities with their official municipal types', () => {
        const codes = [
            ['3518005', 'Ajax', 'Town'],
            ['3518039', 'Brock', 'Township'],
            ['3518017', 'Clarington', 'Municipality'],
            ['3518013', 'Oshawa', 'City'],
            ['3518001', 'Pickering', 'City'],
            ['3518020', 'Scugog', 'Township'],
            ['3518029', 'Uxbridge', 'Township'],
            ['3518009', 'Whitby', 'Town']
        ];
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3518', 'Class title': 'Durham' },
            ...codes.map(([Code, name]) => ({ Level: '4', Code, 'Class title': name }))
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);
        const municipalities = result.places.filter(place => place.parentId === 'ca-on-durham');

        expect(municipalities).toHaveLength(8);
        expect(municipalities.every(place => place.featured)).toBe(true);
        for (const [code, , type] of codes) {
            const expectedId = code === '3518013' ? 'ca-on-oshawa' : 'sgc-csd-' + code;
            expect(municipalities.find(place => place.id === expectedId).typeEn).toBe(type);
        }
    });

    test('features Peel and all three lower-tier municipalities with curated viewports', () => {
        const rows = [
            ['3521', 'Peel'],
            ['3521005', 'Mississauga'],
            ['3521010', 'Brampton'],
            ['3521024', 'Caledon']
        ];
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            ...rows.map(([Code, name]) => ({
                Level: Code.length === 4 ? '3' : '4', Code, 'Class title': name
            }))
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);
        const peel = result.places.find(place => place.id === 'sgc-cd-3521');
        const mississauga = result.places.find(place => place.id === 'sgc-csd-3521005');
        const brampton = result.places.find(place => place.id === 'sgc-csd-3521010');
        const caledon = result.places.find(place => place.id === 'sgc-csd-3521024');

        expect(peel).toEqual(expect.objectContaining({
            slug: 'peel-on', kind: 'region', parentId: 'ca-on', featured: true,
            typeEn: 'Regional municipality', latitude: 43.75, longitude: -79.78, defaultZoom: 9
        }));
        expect(mississauga).toEqual(expect.objectContaining({
            slug: 'mississauga-on', parentId: 'sgc-cd-3521', featured: true,
            typeEn: 'City', defaultZoom: 10
        }));
        expect(brampton).toEqual(expect.objectContaining({
            slug: 'brampton-on', parentId: 'sgc-cd-3521', featured: true,
            typeEn: 'City', defaultZoom: 10
        }));
        expect(caledon).toEqual(expect.objectContaining({
            slug: 'caledon-on', parentId: 'sgc-cd-3521', featured: true,
            typeEn: 'Town', defaultZoom: 9
        }));
    });

    test('decodes CSV buffers and produces URL-safe accents', () => {
        const parsed = rowsFrom(Buffer.from('Level,Code,Class title\n2,35,Ontario\n'), 'utf-8');
        expect(parsed[0].Code).toBe('35');
        expect(slugify('Montréal')).toBe('montreal');
        const accented = rowsFrom(Buffer.from(
            'Level,Code,Class title\n3,2466,Montr\xe9al\n', 'latin1'
        ), 'windows-1252');
        expect(accented[0]['Class title']).toBe('Montréal');
    });

    test('keeps Montréal region and city distinct and features only the city', () => {
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
            nameEn: 'Quebec', nameFr: 'Québec', slug: 'quebec'
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-2466')).toEqual(expect.objectContaining({
            slug: 'montreal-region-qc', kind: 'region', parentId: 'sgc-pr-24', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-2466023')).toEqual(expect.objectContaining({
            slug: 'montreal-qc', kind: 'municipality', parentId: 'sgc-cd-2466',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 45.5019, longitude: -73.5674, defaultZoom: 10
        }));
    });

    test('features Vancouver as a canonical city beneath Greater Vancouver', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915022', 'Class title': 'Vancouver' }
        ];
        const fr = [
            { Code: '59', 'Titres de classes': 'Colombie-Britannique' },
            { Code: '5915', 'Titres de classes': 'Greater Vancouver' },
            { Code: '5915022', 'Titres de classes': 'Vancouver' }
        ];
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-pr-59')).toEqual(expect.objectContaining({
            slug: 'british-columbia', parentId: 'ca', featured: false
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

    test('keeps the Halifax census division and featured regional municipality distinct', () => {
        const en = [
            { Level: '2', Code: '12', 'Class title': 'Nova Scotia' },
            { Level: '3', Code: '1209', 'Class title': 'Halifax' },
            { Level: '4', Code: '1209034', 'Class title': 'Halifax' }
        ];
        const fr = [
            { Code: '12', 'Titres de classes': 'Nouvelle-Écosse' },
            { Code: '1209', 'Titres de classes': 'Halifax' },
            { Code: '1209034', 'Titres de classes': 'Halifax' }
        ];
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-pr-12')).toEqual(expect.objectContaining({
            slug: 'nova-scotia', nameFr: 'Nouvelle-Écosse', parentId: 'ca', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-1209')).toEqual(expect.objectContaining({
            slug: 'halifax-region-ns', kind: 'region', parentId: 'sgc-pr-12', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-1209034')).toEqual(expect.objectContaining({
            slug: 'halifax-ns', kind: 'municipality', parentId: 'sgc-cd-1209',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale', featured: true,
            latitude: 44.6488, longitude: -63.5752, defaultZoom: 8
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            expect.objectContaining({ placeId: 'sgc-cd-1209', scheme: 'sgc-cd', value: '1209' }),
            expect.objectContaining({ placeId: 'sgc-csd-1209034', scheme: 'sgc-csd', value: '1209034' })
        ]));
    });

    test('features Calgary beneath Division No. 6 with its curated viewport', () => {
        const en = [
            { Level: '2', Code: '48', 'Class title': 'Alberta' },
            { Level: '3', Code: '4806', 'Class title': 'Division No. 6' },
            { Level: '4', Code: '4806016', 'Class title': 'Calgary' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);
        expect(result.places.find(place => place.id === 'sgc-pr-48')).toEqual(expect.objectContaining({
            slug: 'alberta', parentId: 'ca', featured: false
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
            { Level: '2', Code: '46', 'Class title': 'Manitoba' },
            { Level: '3', Code: '4611', 'Class title': 'Division No. 11' },
            { Level: '4', Code: '4611040', 'Class title': 'Winnipeg' },
            { Level: '2', Code: '48', 'Class title': 'Alberta' },
            { Level: '3', Code: '4811', 'Class title': 'Division No. 11' },
            { Level: '4', Code: '4811061', 'Class title': 'Edmonton' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-4611')).toEqual(expect.objectContaining({
            slug: 'division-no-11-mb', parentId: 'sgc-pr-46', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-4611040')).toEqual(expect.objectContaining({
            slug: 'winnipeg-mb', parentId: 'sgc-cd-4611', typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 49.8954, longitude: -97.1385, defaultZoom: 9
        }));
        expect(result.places.find(place => place.id === 'sgc-cd-4811')).toEqual(expect.objectContaining({
            slug: 'division-no-11-ab', parentId: 'sgc-pr-48', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-4811061')).toEqual(expect.objectContaining({
            slug: 'edmonton-ab', parentId: 'sgc-cd-4811', typeEn: 'City', typeFr: 'Ville',
            featured: true, latitude: 53.5461, longitude: -113.4938, defaultZoom: 9
        }));
    });

    test('plans former-slug aliases and fails closed on ownership conflicts', async () => {
        const desired = [{ id: 'p1', slug: 'montreal-qc', nameEn: 'Montréal' }];
        const db = { query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'p1', slug: 'montr-al-qc', name_en: 'Montr�al' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] }) };
        await expect(preflightPlaceChanges(db, desired)).resolves.toEqual({
            aliases: [{ slug: 'montr-al-qc', placeId: 'p1' }],
            nameChanges: 1, slugChanges: 1, aliasConflicts: 0
        });

        const conflict = { query: jest.fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'p2', slug: 'montreal-qc' }] }) };
        await expect(preflightPlaceChanges(conflict, desired)).rejects.toThrow(/canonical for another place/);
    });

    test('merges Ottawa census-division and subdivision identities into one city', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3506', 'Class title': 'Ottawa' },
            { Level: '4', Code: '3506008', 'Class title': 'Ottawa' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);
        const ottawa = result.places.filter(place => place.nameEn === 'Ottawa');
        expect(ottawa).toEqual([expect.objectContaining({
            id: 'sgc-cd-3506', slug: 'ottawa-on', kind: 'municipality',
            parentId: 'ca-on', typeEn: 'City', featured: true,
            latitude: 45.4215, longitude: -75.6972, defaultZoom: 9
        })]);
        expect(result.identifiers.filter(item => item.placeId === 'sgc-cd-3506')).toEqual([
            expect.objectContaining({ scheme: 'sgc-cd', value: '3506' }),
            expect.objectContaining({ scheme: 'sgc-csd', value: '3506008' })
        ]);
    });

    test('merges Toronto census-division and subdivision identities into one city', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3520', 'Class title': 'Toronto' },
            { Level: '4', Code: '3520005', 'Class title': 'Toronto' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);
        const toronto = result.places.filter(place => place.nameEn === 'Toronto');
        expect(toronto).toEqual([expect.objectContaining({
            id: 'sgc-cd-3520', slug: 'toronto-on', kind: 'municipality',
            parentId: 'ca-on', typeEn: 'City', featured: true
        })]);
        expect(result.identifiers.filter(item => item.placeId === 'sgc-cd-3520')).toEqual([
            expect.objectContaining({ scheme: 'sgc-cd', value: '3520' }),
            expect.objectContaining({ scheme: 'sgc-csd', value: '3520005' })
        ]);
    });

    test('merges the City of Hamilton while disambiguating Hamilton Township', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3514', 'Class title': 'Northumberland' },
            { Level: '4', Code: '3514019', 'Class title': 'Hamilton' },
            { Level: '3', Code: '3525', 'Class title': 'Hamilton' },
            { Level: '4', Code: '3525005', 'Class title': 'Hamilton' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-3514019')).toEqual(
            expect.objectContaining({
                slug: 'hamilton-township-on', kind: 'municipality',
                parentId: 'sgc-cd-3514', typeEn: 'Township', typeFr: 'Canton',
                featured: false
            })
        );
        expect(result.places.find(place => place.id === 'sgc-cd-3525')).toEqual(
            expect.objectContaining({
                slug: 'hamilton-on', kind: 'municipality', parentId: 'ca-on',
                typeEn: 'City', typeFr: 'Ville', featured: true,
                latitude: 43.2557, longitude: -79.8711, defaultZoom: 9
            })
        );
        expect(result.places.find(place => place.id === 'sgc-csd-3525005')).toBeUndefined();
        expect(result.identifiers.filter(item => item.placeId === 'sgc-cd-3525')).toEqual([
            expect.objectContaining({ scheme: 'sgc-cd', value: '3525' }),
            expect.objectContaining({ scheme: 'sgc-csd', value: '3525005' })
        ]);
    });
});
