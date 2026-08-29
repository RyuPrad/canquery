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

    test('keeps the Québec census division distinct from its featured city', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2423', 'Class title': 'Québec' },
            { Level: '4', Code: '2423027', 'Class title': 'Québec' },
            { Level: '4', Code: '2423057', 'Class title': "L'Ancienne-Lorette" }
        ];
        const fr = [
            { Code: '24', 'Titres de classes': 'Québec' },
            { Code: '2423', 'Titres de classes': 'Québec' },
            { Code: '2423027', 'Titres de classes': 'Québec' },
            { Code: '2423057', 'Titres de classes': "L'Ancienne-Lorette" }
        ];
        const result = normalize(en, fr);
        expect(result.places.find(place => place.id === 'sgc-cd-2423')).toEqual(expect.objectContaining({
            slug: 'quebec-region-qc', kind: 'region', parentId: 'sgc-pr-24', featured: false
        }));
        expect(result.places.find(place => place.id === 'sgc-csd-2423027')).toEqual(expect.objectContaining({
            slug: 'quebec-qc', kind: 'municipality', parentId: 'sgc-cd-2423',
            typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 46.8139, longitude: -71.208, defaultZoom: 10
        }));
        expect(result.identifiers).toEqual(expect.arrayContaining([
            expect.objectContaining({ placeId: 'sgc-cd-2423', scheme: 'sgc-cd', value: '2423' }),
            expect.objectContaining({ placeId: 'sgc-csd-2423027', scheme: 'sgc-csd', value: '2423027' })
        ]));
    });

    test('merges Laval census-division and subdivision identities into one city', () => {
        const en = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2465', 'Class title': 'Laval' },
            { Level: '4', Code: '2465005', 'Class title': 'Laval' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);
        const laval = result.places.filter(place => place.nameEn === 'Laval');
        expect(laval).toEqual([expect.objectContaining({
            id: 'sgc-cd-2465', slug: 'laval-qc', kind: 'municipality',
            parentId: 'sgc-pr-24', typeEn: 'City', typeFr: 'Ville', featured: true,
            latitude: 45.6066, longitude: -73.7124, defaultZoom: 10
        })]);
        expect(result.identifiers.filter(item => item.placeId === 'sgc-cd-2465')).toEqual([
            expect.objectContaining({ scheme: 'sgc-cd', value: '2465' }),
            expect.objectContaining({ scheme: 'sgc-csd', value: '2465005' })
        ]);
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

    test('features Surrey as a canonical city beneath Greater Vancouver', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915004', 'Class title': 'Surrey' }
        ];
        const fr = [
            { Code: '59', 'Titres de classes': 'Colombie-Britannique' },
            { Code: '5915', 'Titres de classes': 'Greater Vancouver' },
            { Code: '5915004', 'Titres de classes': 'Surrey' }
        ];
        const result = normalize(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5915004')).toEqual(
            expect.objectContaining({
                slug: 'surrey-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
                typeEn: 'City', typeFr: 'Ville', featured: true,
                latitude: 49.1913, longitude: -122.849, defaultZoom: 10
            })
        );
        expect(result.identifiers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                placeId: 'sgc-csd-5915004', scheme: 'sgc-csd', value: '5915004'
            })
        ]));
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
            .mockResolvedValueOnce({ rows: [{ id: 'p1', slug: 'montr-al-qc', name_en: 'Montral' }] })
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

    test('features Waterloo Region and all seven lower-tier municipalities with curated viewports', () => {
        const rows = [
            ['3530', 'Waterloo'],
            ['3530013', 'Kitchener'],
            ['3530016', 'Waterloo'],
            ['3530010', 'Cambridge'],
            ['3530035', 'Woolwich'],
            ['3530020', 'Wilmot'],
            ['3530027', 'Wellesley'],
            ['3530004', 'North Dumfries']
        ];
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            ...rows.map(([Code, name]) => ({
                Level: Code.length === 4 ? '3' : '4', Code, 'Class title': name
            }))
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        const region = result.places.find(place => place.id === 'sgc-cd-3530');
        expect(region).toEqual(expect.objectContaining({
            slug: 'waterloo-region-on', kind: 'region', parentId: 'ca-on', featured: true,
            typeEn: 'Regional municipality', latitude: 43.4643, longitude: -80.5204, defaultZoom: 9
        }));

        const kitchener = result.places.find(place => place.id === 'sgc-csd-3530013');
        expect(kitchener).toEqual(expect.objectContaining({
            slug: 'kitchener-on', parentId: 'sgc-cd-3530', featured: true,
            typeEn: 'City', latitude: 43.4516, longitude: -80.4925, defaultZoom: 10
        }));

        const waterlooCity = result.places.find(place => place.id === 'sgc-csd-3530016');
        expect(waterlooCity).toEqual(expect.objectContaining({
            slug: 'waterloo-on', parentId: 'sgc-cd-3530', featured: true,
            typeEn: 'City', latitude: 43.4643, longitude: -80.5204, defaultZoom: 10
        }));

        const cambridge = result.places.find(place => place.id === 'sgc-csd-3530010');
        expect(cambridge).toEqual(expect.objectContaining({
            slug: 'cambridge-on', parentId: 'sgc-cd-3530', featured: true,
            typeEn: 'City', latitude: 43.3616, longitude: -80.3144, defaultZoom: 10
        }));

        const woolwich = result.places.find(place => place.id === 'sgc-csd-3530035');
        expect(woolwich).toEqual(expect.objectContaining({
            slug: 'woolwich-on', parentId: 'sgc-cd-3530', featured: true,
            typeEn: 'Township', defaultZoom: 9
        }));
    });

    test('features Victoria, London, Kelowna, and Fredericton with curated viewports', () => {
        const en = [
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5917', 'Class title': 'Capital' },
            { Level: '4', Code: '5917034', 'Class title': 'Victoria' },
            { Level: '3', Code: '5935', 'Class title': 'Central Okanagan' },
            { Level: '4', Code: '5935010', 'Class title': 'Kelowna' },
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3539', 'Class title': 'Middlesex' },
            { Level: '4', Code: '3539036', 'Class title': 'London' },
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

        const halton = result.places.find(place => place.id === 'sgc-cd-3524');
        expect(halton).toEqual(expect.objectContaining({
            slug: 'halton-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale', featured: true,
            latitude: 43.4900, longitude: -79.8800, defaultZoom: 9
        }));

        const oakville = result.places.find(place => place.id === 'sgc-csd-3524001');
        expect(oakville).toEqual(expect.objectContaining({
            slug: 'oakville-on', parentId: 'sgc-cd-3524', featured: true,
            typeEn: 'Town', defaultZoom: 10
        }));

        const burlington = result.places.find(place => place.id === 'sgc-csd-3524002');
        expect(burlington).toEqual(expect.objectContaining({
            slug: 'burlington-on', parentId: 'sgc-cd-3524', featured: true,
            typeEn: 'City', defaultZoom: 10
        }));

        const milton = result.places.find(place => place.id === 'sgc-csd-3524009');
        expect(milton).toEqual(expect.objectContaining({
            slug: 'milton-on', parentId: 'sgc-cd-3524', featured: true,
            typeEn: 'Town', defaultZoom: 10
        }));

        const haltonHills = result.places.find(place => place.id === 'sgc-csd-3524015');
        expect(haltonHills).toEqual(expect.objectContaining({
            slug: 'halton-hills-on', parentId: 'sgc-cd-3524', featured: true,
            typeEn: 'Town', defaultZoom: 9
        }));
    });

    test('merges Greater Sudbury census-division and subdivision into one single-tier city', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3553', 'Class title': 'Greater Sudbury / Grand Sudbury' },
            { Level: '4', Code: '3553005', 'Class title': 'Greater Sudbury' }
        ];
        const fr = [
            { Code: '35', 'Titres de classes': 'Ontario' },
            { Code: '3553', 'Titres de classes': 'Greater Sudbury / Grand Sudbury' },
            { Code: '3553005', 'Titres de classes': 'Grand Sudbury' }
        ];
        const result = normalize(en, fr);

        const sudbury = result.places.filter(place => place.id === 'sgc-cd-3553');
        expect(sudbury).toEqual([expect.objectContaining({
            id: 'sgc-cd-3553', slug: 'greater-sudbury-on', kind: 'municipality',
            parentId: 'ca-on', typeEn: 'City', typeFr: 'Ville', featured: true,
            nameEn: 'Greater Sudbury', nameFr: 'Grand Sudbury',
            latitude: 46.4900, longitude: -80.9900, defaultZoom: 9
        })]);
        expect(result.identifiers.filter(item => item.placeId === 'sgc-cd-3553')).toEqual([
            expect.objectContaining({ scheme: 'sgc-cd', value: '3553' }),
            expect.objectContaining({ scheme: 'sgc-csd', value: '3553005' })
        ]);
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

        expect(result.places.find(place => place.id === 'sgc-pr-47')).toEqual(expect.objectContaining({
            slug: 'saskatchewan', kind: 'province', parentId: 'ca', featured: false
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
            { Level: '4', Code: '3519038', 'Class title': 'Richmond Hill' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        const york = result.places.find(place => place.id === 'sgc-cd-3519');
        expect(york).toEqual(expect.objectContaining({
            slug: 'york-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', featured: true, latitude: 44.0000, longitude: -79.4667, defaultZoom: 9
        }));

        const markham = result.places.find(place => place.id === 'sgc-csd-3519036');
        expect(markham).toEqual(expect.objectContaining({
            slug: 'markham-on', parentId: 'sgc-cd-3519', featured: true,
            typeEn: 'City', defaultZoom: 10
        }));

        const newmarket = result.places.find(place => place.id === 'sgc-csd-3519048');
        expect(newmarket).toEqual(expect.objectContaining({
            slug: 'newmarket-on', parentId: 'sgc-cd-3519', featured: true,
            typeEn: 'Town', defaultZoom: 10
        }));
    });

    test('features Niagara Region cluster with curated viewports and lower-tier municipalities', () => {
        const en = [
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3526', 'Class title': 'Niagara' },
            { Level: '4', Code: '3526043', 'Class title': 'Niagara Falls' },
            { Level: '4', Code: '3526032', 'Class title': 'Welland' },
            { Level: '4', Code: '3526053', 'Class title': 'St. Catharines' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalize(en, fr);

        const niagara = result.places.find(place => place.id === 'sgc-cd-3526');
        expect(niagara).toEqual(expect.objectContaining({
            slug: 'niagara-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', featured: true, latitude: 43.0600, longitude: -79.3100, defaultZoom: 9
        }));

        const niagaraFalls = result.places.find(place => place.id === 'sgc-csd-3526043');
        expect(niagaraFalls).toEqual(expect.objectContaining({
            slug: 'niagara-falls-on', parentId: 'sgc-cd-3526', featured: true,
            typeEn: 'City', defaultZoom: 10
        }));

        const welland = result.places.find(place => place.id === 'sgc-csd-3526032');
        expect(welland).toEqual(expect.objectContaining({
            slug: 'welland-on', parentId: 'sgc-cd-3526', featured: true,
            typeEn: 'City', defaultZoom: 10
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
});
