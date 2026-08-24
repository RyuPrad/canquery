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
});
