const { normalizePlaces, slugify } = require('../scripts/sync-places');

describe('Statistics Canada SGC place normalization', () => {
    test('builds stable province, region and municipality ancestry', () => {
        const en = [
            { Code: '35', Level: '2', 'Class title': 'Ontario' },
            { Code: '3518', Level: '3', 'Class title': 'Durham' },
            { Code: '3518013', Level: '4', 'Class title': 'Oshawa' }
        ];
        const fr = [
            { Code: '35', 'Titres de classes': 'Ontario' },
            { Code: '3518', 'Titres de classes': 'Durham' },
            { Code: '3518013', 'Titres de classes': 'Oshawa' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'ca', slug: 'canada', kind: 'country', parentId: null }),
            expect.objectContaining({ id: 'ca-on', slug: 'ontario', kind: 'province', parentId: 'ca' }),
            expect.objectContaining({ id: 'sgc-cd-3518', slug: 'durham-on', kind: 'region', parentId: 'ca-on' }),
            expect.objectContaining({ id: 'sgc-csd-3518013', slug: 'oshawa-on', kind: 'municipality', parentId: 'sgc-cd-3518' })
        ]));
    });

    test('features the eight Durham municipalities with their official municipal types', () => {
        const en = [
            { Code: '3518', Level: '3', 'Class title': 'Durham' },
            { Code: '3518001', Level: '4', 'Class title': 'Pickering' },
            { Code: '3518005', Level: '4', 'Class title': 'Ajax' },
            { Code: '3518009', Level: '4', 'Class title': 'Whitby' },
            { Code: '3518013', Level: '4', 'Class title': 'Oshawa' },
            { Code: '3518017', Level: '4', 'Class title': 'Clarington' },
            { Code: '3518020', Level: '4', 'Class title': 'Scugog' },
            { Code: '3518029', Level: '4', 'Class title': 'Uxbridge' },
            { Code: '3518039', Level: '4', 'Class title': 'Brock' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        const durhamPlaces = result.places.filter(place => place.id.startsWith('sgc-csd-3518') || place.id === 'sgc-cd-3518');
        expect(durhamPlaces).toHaveLength(9);
        expect(durhamPlaces.every(place => place.featured)).toBe(true);

        const clarington = result.places.find(place => place.id === 'sgc-csd-3518017');
        expect(clarington).toEqual(expect.objectContaining({
            slug: 'clarington-on',
            typeEn: 'Municipality',
            typeFr: 'Municipalité'
        }));
    });

    test('features Peel and all three lower-tier municipalities with curated viewports', () => {
        const en = [
            { Code: '3521', Level: '3', 'Class title': 'Peel' },
            { Code: '3521005', Level: '4', 'Class title': 'Mississauga' },
            { Code: '3521010', Level: '4', 'Class title': 'Brampton' },
            { Code: '3521024', Level: '4', 'Class title': 'Caledon' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3521')).toEqual(expect.objectContaining({
            slug: 'peel-on-3521',
            typeEn: 'Regional municipality',
            typeFr: 'Municipalité régionale',
            featured: true,
            latitude: 43.75,
            longitude: -79.78,
            defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3521005')).toEqual(expect.objectContaining({
            slug: 'mississauga-on',
            parentId: 'sgc-cd-3521',
            featured: true,
            latitude: 43.589,
            longitude: -79.644,
            defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3521010')).toEqual(expect.objectContaining({
            slug: 'brampton-on',
            parentId: 'sgc-cd-3521',
            featured: true,
            latitude: 43.7315,
            longitude: -79.7624,
            defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3521024')).toEqual(expect.objectContaining({
            slug: 'caledon-on',
            parentId: 'sgc-cd-3521',
            featured: true,
            latitude: 43.8668,
            longitude: -79.867,
            defaultZoom: 9
        }));
    });

    test('decodes CSV buffers and produces URL-safe accents', () => {
        expect(slugify('Montréal')).toBe('montreal');
        expect(slugify("St. John's")).toBe('st-johns');
    });

    test('keeps Montréal region and city distinct and features only the city', () => {
        const en = [
            { Code: '2466', Level: '3', 'Class title': 'Montréal' },
            { Code: '2466023', Level: '4', 'Class title': 'Montréal' }
        ];
        const fr = [
            { Code: '2466', 'Titres de classes': 'Montréal' },
            { Code: '2466023', 'Titres de classes': 'Montréal' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-2466')).toEqual(expect.objectContaining({
            slug: 'montreal-region-qc',
            kind: 'region',
            parentId: 'sgc-pr-24',
            featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2466023')).toEqual(expect.objectContaining({
            slug: 'montreal-qc',
            kind: 'municipality',
            parentId: 'sgc-cd-2466',
            featured: true,
            latitude: 45.5019,
            longitude: -73.5674,
            defaultZoom: 10
        }));
    });

    test('keeps the Québec census division distinct from its featured city', () => {
        const en = [
            { Code: '2423', Level: '3', 'Class title': 'Québec' },
            { Code: '2423027', Level: '4', 'Class title': 'Québec' }
        ];
        const fr = [
            { Code: '2423', 'Titres de classes': 'Québec' },
            { Code: '2423027', 'Titres de classes': 'Québec' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-2423')).toEqual(expect.objectContaining({
            slug: 'quebec-region-qc',
            kind: 'region',
            parentId: 'sgc-pr-24',
            featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2423027')).toEqual(expect.objectContaining({
            slug: 'quebec-qc',
            kind: 'municipality',
            parentId: 'sgc-cd-2423',
            featured: true,
            latitude: 46.8139,
            longitude: -71.208,
            defaultZoom: 10
        }));
    });

    test('merges Laval census-division and subdivision identities into one city', () => {
        const en = [
            { Code: '2465', Level: '3', 'Class title': 'Laval' },
            { Code: '2465005', Level: '4', 'Class title': 'Laval' }
        ];
        const fr = [
            { Code: '2465', 'Titres de classes': 'Laval' },
            { Code: '2465005', 'Titres de classes': 'Laval' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.filter(place => place.id.includes('2465'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-2465')).toEqual(expect.objectContaining({
            slug: 'laval-qc',
            kind: 'region',
            typeEn: 'Census division',
            typeFr: 'Division de recensement',
            parentId: 'sgc-pr-24',
            featured: true,
            latitude: 45.6066,
            longitude: -73.7124,
            defaultZoom: 10
        }));
    });

    test('features Vancouver as a canonical city beneath Greater Vancouver', () => {
        const en = [
            { Code: '5915', Level: '3', 'Class title': 'Greater Vancouver' },
            { Code: '5915022', Level: '4', 'Class title': 'Vancouver' }
        ];
        const fr = [
            { Code: '5915', 'Titres de classes': 'Greater Vancouver' },
            { Code: '5915022', 'Titres de classes': 'Vancouver' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5915022')).toEqual(expect.objectContaining({
            slug: 'vancouver-bc',
            kind: 'municipality',
            parentId: 'sgc-cd-5915',
            featured: true,
            latitude: 49.2827,
            longitude: -123.1207,
            defaultZoom: 10
        }));
    });

    test('features Surrey as a canonical city beneath Greater Vancouver', () => {
        const en = [
            { Code: '5915', Level: '3', 'Class title': 'Greater Vancouver' },
            { Code: '5915004', Level: '4', 'Class title': 'Surrey' }
        ];
        const fr = [
            { Code: '5915', 'Titres de classes': 'Greater Vancouver' },
            { Code: '5915004', 'Titres de classes': 'Surrey' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5915004')).toEqual(expect.objectContaining({
            slug: 'surrey-bc',
            kind: 'municipality',
            parentId: 'sgc-cd-5915',
            featured: true,
            latitude: 49.1913,
            longitude: -122.849,
            defaultZoom: 10
        }));
    });

    test('keeps the Halifax census division and featured regional municipality distinct', () => {
        const en = [
            { Code: '1209', Level: '3', 'Class title': 'Halifax' },
            { Code: '1209034', Level: '4', 'Class title': 'Halifax' }
        ];
        const fr = [
            { Code: '1209', 'Titres de classes': 'Halifax' },
            { Code: '1209034', 'Titres de classes': 'Halifax' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-1209')).toEqual(expect.objectContaining({
            slug: 'halifax-region-ns',
            kind: 'region',
            parentId: 'sgc-pr-12',
            featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1209034')).toEqual(expect.objectContaining({
            slug: 'halifax-ns',
            kind: 'municipality',
            parentId: 'sgc-cd-1209',
            featured: true,
            latitude: 44.6488,
            longitude: -63.5752,
            defaultZoom: 8
        }));
    });

    test('features Calgary beneath Division No. 6 with its curated viewport', () => {
        const en = [
            { Code: '4806', Level: '3', 'Class title': 'Division No. 6' },
            { Code: '4806016', Level: '4', 'Class title': 'Calgary' }
        ];
        const fr = [
            { Code: '4806', 'Titres de classes': 'Division No. 6' },
            { Code: '4806016', 'Titres de classes': 'Calgary' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-4806016')).toEqual(expect.objectContaining({
            slug: 'calgary-ab',
            kind: 'municipality',
            parentId: 'sgc-cd-4806',
            featured: true,
            latitude: 51.0447,
            longitude: -114.0719,
            defaultZoom: 9
        }));
    });

    test('features Edmonton and Winnipeg beneath their separate Division No. 11 parents', () => {
        const en = [
            { Code: '4811', Level: '3', 'Class title': 'Division No. 11' },
            { Code: '4811061', Level: '4', 'Class title': 'Edmonton' },
            { Code: '4611', Level: '3', 'Class title': 'Division No. 11' },
            { Code: '4611040', Level: '4', 'Class title': 'Winnipeg' }
        ];
        const fr = [
            { Code: '4811', 'Titres de classes': 'Division No. 11' },
            { Code: '4811061', 'Titres de classes': 'Edmonton' },
            { Code: '4611', 'Titres de classes': 'Division No. 11' },
            { Code: '4611040', 'Titres de classes': 'Winnipeg' }
        ];
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-4811061')).toEqual(expect.objectContaining({
            slug: 'edmonton-ab',
            kind: 'municipality',
            parentId: 'sgc-cd-4811',
            featured: true,
            latitude: 53.5461,
            longitude: -113.4938,
            defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4611040')).toEqual(expect.objectContaining({
            slug: 'winnipeg-mb',
            kind: 'municipality',
            parentId: 'sgc-cd-4611',
            featured: true,
            latitude: 49.8954,
            longitude: -97.1385,
            defaultZoom: 9
        }));
    });

    test('plans former-slug aliases and fails closed on ownership conflicts', () => {
        const { planAliases } = require('../scripts/sync-places');
        const existingPlaces = [
            { id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality' },
            { id: 'sgc-csd-3518013', slug: 'oshawa-on-3518013', kind: 'municipality' }
        ];
        const canonicalPlaces = [
            { id: 'sgc-csd-3518013', slug: 'oshawa-on', kind: 'municipality' }
        ];

        const planned = planAliases(existingPlaces, canonicalPlaces, []);
        expect(planned.aliasesToAdd).toEqual([
            { placeId: 'sgc-csd-3518013', slug: 'oshawa-on-3518013' }
        ]);
        expect(planned.conflicts).toEqual([]);
    });

    test('merges Ottawa census-division and subdivision identities into one city', () => {
        const en = [
            { Code: '3506', Level: '3', 'Class title': 'Ottawa' },
            { Code: '3506008', Level: '4', 'Class title': 'Ottawa' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.filter(place => place.id.includes('3506'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3506')).toEqual(expect.objectContaining({
            slug: 'ottawa-on',
            kind: 'region',
            typeEn: 'Census division',
            typeFr: 'Division de recensement',
            parentId: 'ca-on',
            featured: true,
            latitude: 45.4215,
            longitude: -75.6972,
            defaultZoom: 9
        }));
    });

    test('merges Toronto census-division and subdivision identities into one city', () => {
        const en = [
            { Code: '3520', Level: '3', 'Class title': 'Toronto' },
            { Code: '3520005', Level: '4', 'Class title': 'Toronto' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.filter(place => place.id.includes('3520'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3520')).toEqual(expect.objectContaining({
            slug: 'toronto-on',
            kind: 'region',
            typeEn: 'Census division',
            typeFr: 'Division de recensement',
            parentId: 'ca-on',
            featured: true,
            latitude: 43.6532,
            longitude: -79.3832,
            defaultZoom: 10
        }));
    });

    test('merges the City of Hamilton while disambiguating Hamilton Township', () => {
        const en = [
            { Code: '3525', Level: '3', 'Class title': 'Hamilton' },
            { Code: '3525005', Level: '4', 'Class title': 'Hamilton' },
            { Code: '3514019', Level: '4', 'Class title': 'Hamilton' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.filter(place => place.id.includes('3525'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3525')).toEqual(expect.objectContaining({
            slug: 'hamilton-on',
            kind: 'region',
            typeEn: 'Census division',
            typeFr: 'Division de recensement',
            parentId: 'ca-on',
            featured: true,
            latitude: 43.2557,
            longitude: -79.8711,
            defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3514019')).toEqual(expect.objectContaining({
            slug: 'hamilton-township-on',
            typeEn: 'Township',
            typeFr: 'Canton',
            featured: false
        }));
    });

    test('features Waterloo Region and all seven lower-tier municipalities with curated viewports', () => {
        const en = [
            { Code: '3530', Level: '3', 'Class title': 'Waterloo' },
            { Code: '3530013', Level: '4', 'Class title': 'Kitchener' },
            { Code: '3530016', Level: '4', 'Class title': 'Waterloo' },
            { Code: '3530010', Level: '4', 'Class title': 'Cambridge' },
            { Code: '3530035', Level: '4', 'Class title': 'Woolwich' },
            { Code: '3530020', Level: '4', 'Class title': 'Wilmot' },
            { Code: '3530027', Level: '4', 'Class title': 'Wellesley' },
            { Code: '3530004', Level: '4', 'Class title': 'North Dumfries' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3530')).toEqual(expect.objectContaining({
            slug: 'waterloo-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 43.4643, longitude: -80.5204, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530013')).toEqual(expect.objectContaining({
            slug: 'kitchener-on', parentId: 'sgc-cd-3530', featured: true,
            latitude: 43.4516, longitude: -80.4925, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530016')).toEqual(expect.objectContaining({
            slug: 'waterloo-on', parentId: 'sgc-cd-3530', featured: true,
            latitude: 43.4643, longitude: -80.5204, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530010')).toEqual(expect.objectContaining({
            slug: 'cambridge-on', parentId: 'sgc-cd-3530', featured: true,
            latitude: 43.3616, longitude: -80.3144, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530035')).toEqual(expect.objectContaining({
            slug: 'woolwich-on', parentId: 'sgc-cd-3530', typeEn: 'Township', featured: true
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530020')).toEqual(expect.objectContaining({
            slug: 'wilmot-on', parentId: 'sgc-cd-3530', typeEn: 'Township', featured: true
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530027')).toEqual(expect.objectContaining({
            slug: 'wellesley-on', parentId: 'sgc-cd-3530', typeEn: 'Township', featured: true
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3530004')).toEqual(expect.objectContaining({
            slug: 'north-dumfries-on', parentId: 'sgc-cd-3530', typeEn: 'Township', featured: true
        }));
    });

    test('features Victoria, London, Kelowna, and Fredericton with curated viewports', () => {
        const en = [
            { Code: '5917034', Level: '4', 'Class title': 'Victoria' },
            { Code: '3539036', Level: '4', 'Class title': 'London' },
            { Code: '5935010', Level: '4', 'Class title': 'Kelowna' },
            { Code: '1310032', Level: '4', 'Class title': 'Fredericton' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5917034')).toEqual(expect.objectContaining({
            slug: 'victoria-bc', kind: 'municipality', parentId: 'sgc-cd-5917',
            featured: true, latitude: 48.4284, longitude: -123.3656, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3539036')).toEqual(expect.objectContaining({
            slug: 'london-on', kind: 'municipality', parentId: 'sgc-cd-3539',
            featured: true, latitude: 42.9849, longitude: -81.2453, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5935010')).toEqual(expect.objectContaining({
            slug: 'kelowna-bc', kind: 'municipality', parentId: 'sgc-cd-5935',
            featured: true, latitude: 49.8880, longitude: -119.4960, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1310032')).toEqual(expect.objectContaining({
            slug: 'fredericton-nb', kind: 'municipality', parentId: 'sgc-cd-1310',
            featured: true, latitude: 45.9636, longitude: -66.6431, defaultZoom: 10
        }));
    });

    test('configures Halton Region as a regional cluster with Oakville, Burlington, Milton, and Halton Hills', () => {
        const en = [
            { Code: '3524', Level: '3', 'Class title': 'Halton' },
            { Code: '3524001', Level: '4', 'Class title': 'Oakville' },
            { Code: '3524002', Level: '4', 'Class title': 'Burlington' },
            { Code: '3524009', Level: '4', 'Class title': 'Milton' },
            { Code: '3524015', Level: '4', 'Class title': 'Halton Hills' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3524')).toEqual(expect.objectContaining({
            slug: 'halton-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 43.4900, longitude: -79.8800, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524001')).toEqual(expect.objectContaining({
            slug: 'oakville-on', parentId: 'sgc-cd-3524', featured: true,
            latitude: 43.4675, longitude: -79.6877, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524002')).toEqual(expect.objectContaining({
            slug: 'burlington-on', parentId: 'sgc-cd-3524', featured: true,
            latitude: 43.3255, longitude: -79.7990, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524009')).toEqual(expect.objectContaining({
            slug: 'milton-on', parentId: 'sgc-cd-3524', featured: true,
            latitude: 43.5183, longitude: -79.8774, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3524015')).toEqual(expect.objectContaining({
            slug: 'halton-hills-on', parentId: 'sgc-cd-3524', featured: true,
            latitude: 43.6300, longitude: -79.9500, defaultZoom: 9
        }));
    });

    test('merges Greater Sudbury census-division and subdivision into one single-tier city', () => {
        const en = [
            { Code: '3553', Level: '3', 'Class title': 'Greater Sudbury' },
            { Code: '3553005', Level: '4', 'Class title': 'Greater Sudbury / Grand Sudbury' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.filter(place => place.id.includes('3553'))).toHaveLength(1);
        expect(result.places.find(place => place.id === 'sgc-cd-3553')).toEqual(expect.objectContaining({
            slug: 'greater-sudbury-on',
            kind: 'region',
            typeEn: 'City',
            typeFr: 'Ville',
            parentId: 'ca-on',
            featured: true,
            latitude: 46.4900,
            longitude: -80.9900,
            defaultZoom: 9
        }));
    });

    test('features Burnaby beneath Greater Vancouver and Saskatoon beneath Saskatchewan', () => {
        const en = [
            { Code: '5915025', Level: '4', 'Class title': 'Burnaby' },
            { Code: '4711066', Level: '4', 'Class title': 'Saskatoon' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-5915025')).toEqual(expect.objectContaining({
            slug: 'burnaby-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
            featured: true, latitude: 49.2488, longitude: -122.9805, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4711066')).toEqual(expect.objectContaining({
            slug: 'saskatoon-sk', kind: 'municipality', parentId: 'sgc-cd-4711',
            featured: true, latitude: 52.1332, longitude: -106.6700, defaultZoom: 10
        }));
    });

    test('features York Region cluster with curated viewports and lower-tier municipalities', () => {
        const en = [
            { Code: '3519', Level: '3', 'Class title': 'York' },
            { Code: '3519036', Level: '4', 'Class title': 'Markham' },
            { Code: '3519048', Level: '4', 'Class title': 'Newmarket' },
            { Code: '3519028', Level: '4', 'Class title': 'Vaughan' },
            { Code: '3519038', Level: '4', 'Class title': 'Richmond Hill' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3519')).toEqual(expect.objectContaining({
            slug: 'york-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 44.0000, longitude: -79.4667, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3519036')).toEqual(expect.objectContaining({
            slug: 'markham-on', parentId: 'sgc-cd-3519', featured: true,
            latitude: 43.8561, longitude: -79.3370, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3519048')).toEqual(expect.objectContaining({
            slug: 'newmarket-on', parentId: 'sgc-cd-3519', featured: true,
            latitude: 44.0592, longitude: -79.4613, defaultZoom: 10
        }));
    });

    test('features Niagara Region cluster with curated viewports and lower-tier municipalities', () => {
        const en = [
            { Code: '3526', Level: '3', 'Class title': 'Niagara' },
            { Code: '3526043', Level: '4', 'Class title': 'Niagara Falls' },
            { Code: '3526032', Level: '4', 'Class title': 'Welland' },
            { Code: '3526053', Level: '4', 'Class title': 'St. Catharines' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-cd-3526')).toEqual(expect.objectContaining({
            slug: 'niagara-region-on', kind: 'region', parentId: 'ca-on',
            typeEn: 'Regional municipality', typeFr: 'Municipalité régionale',
            featured: true, latitude: 43.0600, longitude: -79.3100, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3526043')).toEqual(expect.objectContaining({
            slug: 'niagara-falls-on', parentId: 'sgc-cd-3526', featured: true,
            latitude: 43.0896, longitude: -79.0849, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3526032')).toEqual(expect.objectContaining({
            slug: 'welland-on', parentId: 'sgc-cd-3526', featured: true,
            latitude: 42.9922, longitude: -79.2483, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3526053')).toEqual(expect.objectContaining({
            slug: 'st-catharines-on', parentId: 'sgc-cd-3526', featured: true,
            latitude: 43.1594, longitude: -79.2469, defaultZoom: 10
        }));
    });

    test('features Moncton, Guelph, Saanich, and Belleville municipal anchors', () => {
        const en = [
            { Code: '1307019', Level: '4', 'Class title': 'Moncton' },
            { Code: '1307022', Level: '4', 'Class title': 'Moncton' },
            { Code: '3523008', Level: '4', 'Class title': 'Guelph' },
            { Code: '5917021', Level: '4', 'Class title': 'Saanich' },
            { Code: '3512005', Level: '4', 'Class title': 'Belleville' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-1307019')).toEqual(expect.objectContaining({
            slug: 'moncton-parish-nb', kind: 'municipality', parentId: 'sgc-cd-1307',
            featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1307022')).toEqual(expect.objectContaining({
            slug: 'moncton-nb', kind: 'municipality', parentId: 'sgc-cd-1307',
            featured: true, latitude: 46.0878, longitude: -64.7782, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3523008')).toEqual(expect.objectContaining({
            slug: 'guelph-on', kind: 'municipality', parentId: 'sgc-cd-3523',
            featured: true, latitude: 43.5448, longitude: -80.2482, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5917021')).toEqual(expect.objectContaining({
            slug: 'saanich-bc', kind: 'municipality', parentId: 'sgc-cd-5917',
            featured: true, latitude: 48.4841, longitude: -123.3822, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3512005')).toEqual(expect.objectContaining({
            slug: 'belleville-on', kind: 'municipality', parentId: 'sgc-cd-3512',
            featured: true, latitude: 44.1628, longitude: -77.3832, defaultZoom: 10
        }));
    });

    test('features Yellowknife, Barrie, Thunder Bay, Chatham-Kent, Kawartha Lakes, Summerland, Norfolk, and Haldimand', () => {
        const en = [
            { Code: '6106023', Level: '4', 'Class title': 'Yellowknife' },
            { Code: '3543042', Level: '4', 'Class title': 'Barrie' },
            { Code: '3558004', Level: '4', 'Class title': 'Thunder Bay' },
            { Code: '3536020', Level: '4', 'Class title': 'Chatham-Kent' },
            { Code: '3536', Level: '3', 'Class title': 'Chatham-Kent' },
            { Code: '3516010', Level: '4', 'Class title': 'Kawartha Lakes' },
            { Code: '3516', Level: '3', 'Class title': 'Kawartha Lakes' },
            { Code: '5907035', Level: '4', 'Class title': 'Summerland' },
            { Code: '3528052', Level: '4', 'Class title': 'Norfolk County' },
            { Code: '4802012', Level: '4', 'Class title': 'Lethbridge' },
            { Code: '4801006', Level: '4', 'Class title': 'Medicine Hat' },
            { Code: '4806021', Level: '4', 'Class title': 'Airdrie' },
            { Code: '4815023', Level: '4', 'Class title': 'Canmore' },
            { Code: '5907041', Level: '4', 'Class title': 'Penticton' },
            { Code: '5915001', Level: '4', 'Class title': 'Langley' },
            { Code: '3540', Level: '3', 'Class title': 'Huron' },
            { Code: '1211', Level: '3', 'Class title': 'Cumberland' },
            { Code: '3528018', Level: '4', 'Class title': 'Haldimand County' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-6106023')).toEqual(expect.objectContaining({
            slug: 'yellowknife-nt', kind: 'municipality', parentId: 'sgc-cd-6106',
            featured: true, latitude: 62.4540, longitude: -114.3718, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3543042')).toEqual(expect.objectContaining({
            slug: 'barrie-on', kind: 'municipality', parentId: 'sgc-cd-3543',
            featured: true, latitude: 44.3894, longitude: -79.6903, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3558004')).toEqual(expect.objectContaining({
            slug: 'thunder-bay-on', kind: 'municipality', parentId: 'sgc-cd-3558',
            featured: true, latitude: 48.3809, longitude: -89.2477, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3536')).toEqual(expect.objectContaining({
            slug: 'chatham-kent-on', kind: 'region', parentId: 'ca-on',
            featured: true, latitude: 42.4048, longitude: -82.1910, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3516')).toEqual(expect.objectContaining({
            slug: 'kawartha-lakes-on', kind: 'region', parentId: 'ca-on',
            featured: true, latitude: 44.3564, longitude: -78.7408, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5907035')).toEqual(expect.objectContaining({
            slug: 'summerland-bc', kind: 'municipality', parentId: 'sgc-cd-5907',
            featured: true, latitude: 49.6006, longitude: -119.6778, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3528052')).toEqual(expect.objectContaining({
            slug: 'norfolk-county-on', kind: 'municipality', parentId: 'sgc-cd-3528',
            featured: true, latitude: 42.8333, longitude: -80.3833, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4802012')).toEqual(expect.objectContaining({
            slug: 'lethbridge-ab', kind: 'municipality', parentId: 'sgc-cd-4802',
            featured: true, latitude: 49.6956, longitude: -112.8451, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4801006')).toEqual(expect.objectContaining({
            slug: 'medicine-hat-ab', kind: 'municipality', parentId: 'sgc-cd-4801',
            featured: true, latitude: 50.0417, longitude: -110.6775, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4806021')).toEqual(expect.objectContaining({
            slug: 'airdrie-ab', kind: 'municipality', parentId: 'sgc-cd-4806',
            featured: true, latitude: 51.2917, longitude: -114.0144, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4815023')).toEqual(expect.objectContaining({
            slug: 'canmore-ab', kind: 'municipality', parentId: 'sgc-cd-4815',
            featured: true, latitude: 51.0890, longitude: -115.3590, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5907041')).toEqual(expect.objectContaining({
            slug: 'penticton-bc', kind: 'municipality', parentId: 'sgc-cd-5907',
            featured: true, latitude: 49.4991, longitude: -119.5937, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5915001')).toEqual(expect.objectContaining({
            slug: 'langley-bc', kind: 'municipality', parentId: 'sgc-cd-5915',
            featured: true, latitude: 49.1044, longitude: -122.6580, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3540')).toEqual(expect.objectContaining({
            slug: 'huron-county-on', kind: 'region', parentId: 'ca-on',
            featured: true, latitude: 43.5833, longitude: -81.5000, defaultZoom: 9
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-1211')).toEqual(expect.objectContaining({
            slug: 'cumberland-county-ns', kind: 'region', parentId: 'sgc-pr-12',
            featured: true, latitude: 45.7500, longitude: -64.0000, defaultZoom: 8
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3528018')).toEqual(expect.objectContaining({
            slug: 'haldimand-county-on', kind: 'municipality', parentId: 'sgc-cd-3528',
            featured: true, latitude: 42.9333, longitude: -79.8667, defaultZoom: 9
        }));
    });

    test('features Gatineau, Trois-Rivières, Repentigny, Longueuil, Saguenay, Rimouski, Shawinigan, Lévis, Sherbrooke, and Saint John', () => {
        const en = [
            { Code: '2481017', Level: '4', 'Class title': 'Gatineau' },
            { Code: '2437067', Level: '4', 'Class title': 'Trois-Rivières' },
            { Code: '2460013', Level: '4', 'Class title': 'Repentigny' },
            { Code: '2458227', Level: '4', 'Class title': 'Longueuil' },
            { Code: '2494068', Level: '4', 'Class title': 'Saguenay' },
            { Code: '2410043', Level: '4', 'Class title': 'Rimouski' },
            { Code: '2436033', Level: '4', 'Class title': 'Shawinigan' },
            { Code: '2425213', Level: '4', 'Class title': 'Lévis' },
            { Code: '2443027', Level: '4', 'Class title': 'Sherbrooke' },
            { Code: '1301006', Level: '4', 'Class title': 'Saint John' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-2481017')).toEqual(expect.objectContaining({
            slug: 'gatineau-qc', kind: 'municipality', parentId: 'sgc-cd-2481',
            featured: true, latitude: 45.4765, longitude: -75.7013, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2437067')).toEqual(expect.objectContaining({
            slug: 'trois-rivieres-qc', kind: 'municipality', parentId: 'sgc-cd-2437',
            featured: true, latitude: 46.3432, longitude: -72.5421, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2460013')).toEqual(expect.objectContaining({
            slug: 'repentigny-qc', kind: 'municipality', parentId: 'sgc-cd-2460',
            featured: true, latitude: 45.7423, longitude: -73.4497, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2458227')).toEqual(expect.objectContaining({
            slug: 'longueuil-qc', kind: 'municipality', parentId: 'sgc-cd-2458',
            featured: true, latitude: 45.5312, longitude: -73.5181, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2494068')).toEqual(expect.objectContaining({
            slug: 'saguenay-qc', kind: 'municipality', parentId: 'sgc-cd-2494',
            featured: true, latitude: 48.4284, longitude: -71.0684, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2410043')).toEqual(expect.objectContaining({
            slug: 'rimouski-qc', kind: 'municipality', parentId: 'sgc-cd-2410',
            featured: true, latitude: 48.4488, longitude: -68.5240, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2436033')).toEqual(expect.objectContaining({
            slug: 'shawinigan-qc', kind: 'municipality', parentId: 'sgc-cd-2436',
            featured: true, latitude: 46.5667, longitude: -72.7500, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2425213')).toEqual(expect.objectContaining({
            slug: 'levis-qc', kind: 'municipality', parentId: 'sgc-cd-2425',
            featured: true, latitude: 46.8033, longitude: -71.1779, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2443027')).toEqual(expect.objectContaining({
            slug: 'sherbrooke-qc', kind: 'municipality', parentId: 'sgc-cd-2443',
            featured: true, latitude: 45.4042, longitude: -71.8929, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1301006')).toEqual(expect.objectContaining({
            slug: 'saint-john-nb', kind: 'municipality', parentId: 'sgc-cd-1301',
            featured: true, latitude: 45.2733, longitude: -66.0633, defaultZoom: 10
        }));
    });

    test('features Whitehorse, St. John\'s, Charlottetown, Regina, Windsor, Kingston, Red Deer, Kamloops, Nanaimo, and Abbotsford', () => {
        const en = [
            { Code: '6001009', Level: '4', 'Class title': 'Whitehorse' },
            { Code: '1001519', Level: '4', 'Class title': "St. John's" },
            { Code: '1102075', Level: '4', 'Class title': 'Charlottetown' },
            { Code: '4706027', Level: '4', 'Class title': 'Regina' },
            { Code: '3537039', Level: '4', 'Class title': 'Windsor' },
            { Code: '3510010', Level: '4', 'Class title': 'Kingston' },
            { Code: '4808011', Level: '4', 'Class title': 'Red Deer' },
            { Code: '5933042', Level: '4', 'Class title': 'Kamloops' },
            { Code: '5921007', Level: '4', 'Class title': 'Nanaimo' },
            { Code: '5909052', Level: '4', 'Class title': 'Abbotsford' }
        ];
        const fr = en.map(row => ({ Code: row.Code, 'Titres de classes': row['Class title'] }));
        const result = normalizePlaces(en, fr);

        expect(result.places.find(place => place.id === 'sgc-csd-6001009')).toEqual(expect.objectContaining({
            slug: 'whitehorse-yt', kind: 'municipality', parentId: 'sgc-cd-6001',
            featured: true, latitude: 60.7212, longitude: -135.0568, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1001519')).toEqual(expect.objectContaining({
            slug: 'st-johns-nl', kind: 'municipality', parentId: 'sgc-cd-1001',
            featured: true, latitude: 47.5615, longitude: -52.7126, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1102075')).toEqual(expect.objectContaining({
            slug: 'charlottetown-pe', kind: 'municipality', parentId: 'sgc-cd-1102',
            featured: true, latitude: 46.2382, longitude: -63.1311, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4706027')).toEqual(expect.objectContaining({
            slug: 'regina-sk', kind: 'municipality', parentId: 'sgc-cd-4706',
            featured: true, latitude: 50.4452, longitude: -104.6189, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3537039')).toEqual(expect.objectContaining({
            slug: 'windsor-on', kind: 'municipality', parentId: 'sgc-cd-3537',
            featured: true, latitude: 42.3149, longitude: -83.0364, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3510010')).toEqual(expect.objectContaining({
            slug: 'kingston-on', kind: 'municipality', parentId: 'sgc-cd-3510',
            featured: true, latitude: 44.2312, longitude: -76.4860, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4808011')).toEqual(expect.objectContaining({
            slug: 'red-deer-ab', kind: 'municipality', parentId: 'sgc-cd-4808',
            featured: true, latitude: 52.2690, longitude: -113.8116, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5933042')).toEqual(expect.objectContaining({
            slug: 'kamloops-bc', kind: 'municipality', parentId: 'sgc-cd-5933',
            featured: true, latitude: 50.6745, longitude: -120.3273, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5921007')).toEqual(expect.objectContaining({
            slug: 'nanaimo-bc', kind: 'municipality', parentId: 'sgc-cd-5921',
            featured: true, latitude: 49.1659, longitude: -123.9401, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5909052')).toEqual(expect.objectContaining({
            slug: 'abbotsford-bc', kind: 'municipality', parentId: 'sgc-cd-5909',
            featured: true, latitude: 49.0504, longitude: -122.3045, defaultZoom: 10
        }));
    });
});
