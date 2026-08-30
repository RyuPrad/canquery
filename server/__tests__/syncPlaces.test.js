const {
    normalizePlaces,
    planAliases,
    slugify
} = require('../scripts/sync-places');

describe('sync-places normalization and alias planning', () => {
    test('slugify strips accents, special characters, and punctuation', () => {
        expect(slugify('Montréal')).toBe('montreal');
        expect(slugify('Québec')).toBe('quebec');
        expect(slugify('Trois-Rivières')).toBe('trois-rivieres');
        expect(slugify('Greater Sudbury / Grand Sudbury')).toBe('greater-sudbury-grand-sudbury');
        expect(slugify("St. John's")).toBe('st-johns');
    });

    test('normalizes Canada root, provinces, regions, and municipalities', () => {
        const enRows = [
            { Level: '1', Code: '01', 'Class title': 'Canada' },
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3520', 'Class title': 'Toronto' },
            { Level: '4', Code: '3520005', 'Class title': 'Toronto' },
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2466', 'Class title': 'Montréal' },
            { Level: '4', Code: '2466023', 'Class title': 'Montréal' },
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5915', 'Class title': 'Greater Vancouver' },
            { Level: '4', Code: '5915022', 'Class title': 'Vancouver' },
            { Level: '2', Code: '61', 'Class title': 'Northwest Territories' },
            { Level: '3', Code: '6106', 'Class title': 'Region 6' },
            { Level: '4', Code: '6106023', 'Class title': 'Yellowknife' }
        ];

        const frRows = [
            { Level: '1', Code: '01', 'Titres de classes': 'Canada' },
            { Level: '2', Code: '35', 'Titres de classes': 'Ontario' },
            { Level: '3', Code: '3520', 'Titres de classes': 'Toronto' },
            { Level: '4', Code: '3520005', 'Titres de classes': 'Toronto' },
            { Level: '2', Code: '24', 'Titres de classes': 'Québec' },
            { Level: '3', Code: '2466', 'Titres de classes': 'Montréal' },
            { Level: '4', Code: '2466023', 'Titres de classes': 'Montréal' },
            { Level: '2', Code: '59', 'Titres de classes': 'Colombie-Britannique' },
            { Level: '3', Code: '5915', 'Titres de classes': 'Greater Vancouver' },
            { Level: '4', Code: '5915022', 'Titres de classes': 'Vancouver' },
            { Level: '2', Code: '61', 'Titres de classes': 'Territoires du Nord-Ouest' },
            { Level: '3', Code: '6106', 'Titres de classes': 'Région 6' },
            { Level: '4', Code: '6106023', 'Titres de classes': 'Yellowknife' }
        ];

        const result = normalizePlaces(enRows, frRows);

        expect(result.places.find(place => place.id === 'ca')).toEqual(expect.objectContaining({
            slug: 'canada', kind: 'country', nameEn: 'Canada', nameFr: 'Canada', parentId: null, featured: false
        }));

        expect(result.places.find(place => place.id === 'ca-on')).toEqual(expect.objectContaining({
            slug: 'ontario', kind: 'province', nameEn: 'Ontario', nameFr: 'Ontario', parentId: 'ca', featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-pr-24')).toEqual(expect.objectContaining({
            slug: 'quebec', kind: 'province', nameEn: 'Quebec', nameFr: 'Québec', parentId: 'ca', featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-pr-61')).toEqual(expect.objectContaining({
            slug: 'northwest-territories', kind: 'territory', nameEn: 'Northwest Territories', nameFr: 'Territoires du Nord-Ouest', parentId: 'ca', featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-3520')).toEqual(expect.objectContaining({
            slug: 'toronto-on', kind: 'region', parentId: 'ca-on', featured: true
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2466023')).toEqual(expect.objectContaining({
            slug: 'montreal-qc', kind: 'municipality', parentId: 'sgc-cd-2466', featured: true
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5915022')).toEqual(expect.objectContaining({
            slug: 'vancouver-bc', kind: 'municipality', parentId: 'sgc-cd-5915', featured: true
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-6106023')).toEqual(expect.objectContaining({
            slug: 'yellowknife-nt', kind: 'municipality', parentId: 'sgc-cd-6106', featured: true
        }));
    });

    test('normalizes 9 Données Québec municipal places with correct slugs, parents, and featured flags', () => {
        const enRows = [
            { Level: '2', Code: '24', 'Class title': 'Quebec' },
            { Level: '3', Code: '2481', 'Class title': 'Les Collines-de-l\'Outaouais' },
            { Level: '4', Code: '2481017', 'Class title': 'Gatineau' },
            { Level: '3', Code: '2437', 'Class title': 'Francheville' },
            { Level: '4', Code: '2437067', 'Class title': 'Trois-Rivières' },
            { Level: '3', Code: '2460', 'Class title': 'L\'Assomption' },
            { Level: '4', Code: '2460013', 'Class title': 'Repentigny' },
            { Level: '3', Code: '2458', 'Class title': 'Longueuil' },
            { Level: '4', Code: '2458227', 'Class title': 'Longueuil' },
            { Level: '3', Code: '2494', 'Class title': 'Le Saguenay-et-son-Fjord' },
            { Level: '4', Code: '2494068', 'Class title': 'Saguenay' },
            { Level: '3', Code: '2410', 'Class title': 'Rimouski-Neigette' },
            { Level: '4', Code: '2410043', 'Class title': 'Rimouski' },
            { Level: '3', Code: '2436', 'Class title': 'Shawinigan' },
            { Level: '4', Code: '2436033', 'Class title': 'Shawinigan' },
            { Level: '3', Code: '2425', 'Class title': 'Lévis' },
            { Level: '4', Code: '2425213', 'Class title': 'Lévis' },
            { Level: '3', Code: '2443', 'Class title': 'Sherbrooke' },
            { Level: '4', Code: '2443027', 'Class title': 'Sherbrooke' }
        ];

        const frRows = enRows.map(row => ({
            Level: row.Level,
            Code: row.Code,
            'Titres de classes': row['Class title']
        }));

        const result = normalizePlaces(enRows, frRows);

        expect(result.places.find(place => place.id === 'sgc-csd-2481017')).toEqual(expect.objectContaining({
            slug: 'gatineau-qc', kind: 'municipality', parentId: 'sgc-cd-2481',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 45.4765, longitude: -75.7013, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2437067')).toEqual(expect.objectContaining({
            slug: 'trois-rivieres-qc', kind: 'municipality', parentId: 'sgc-cd-2437',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 46.3432, longitude: -72.5421, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2460013')).toEqual(expect.objectContaining({
            slug: 'repentigny-qc', kind: 'municipality', parentId: 'sgc-cd-2460',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 45.7423, longitude: -73.4497, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2458227')).toEqual(expect.objectContaining({
            slug: 'longueuil-qc', kind: 'municipality', parentId: 'sgc-cd-2458',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 45.5312, longitude: -73.5181, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2494068')).toEqual(expect.objectContaining({
            slug: 'saguenay-qc', kind: 'municipality', parentId: 'sgc-cd-2494',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 48.4284, longitude: -71.0684, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2410043')).toEqual(expect.objectContaining({
            slug: 'rimouski-qc', kind: 'municipality', parentId: 'sgc-cd-2410',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 48.4488, longitude: -68.5240, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2436033')).toEqual(expect.objectContaining({
            slug: 'shawinigan-qc', kind: 'municipality', parentId: 'sgc-cd-2436',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 46.5667, longitude: -72.7500, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2425213')).toEqual(expect.objectContaining({
            slug: 'levis-qc', kind: 'municipality', parentId: 'sgc-cd-2425',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 46.8033, longitude: -71.1779, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-2443027')).toEqual(expect.objectContaining({
            slug: 'sherbrooke-qc', kind: 'municipality', parentId: 'sgc-cd-2443',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 45.4042, longitude: -71.8929, defaultZoom: 10
        }));
    });

    test('normalizes Saint John (NB) with correct slug, parent, and featured flag', () => {
        const enRows = [
            { Level: '2', Code: '13', 'Class title': 'New Brunswick' },
            { Level: '3', Code: '1301', 'Class title': 'Saint John' },
            { Level: '4', Code: '1301006', 'Class title': 'Saint John' }
        ];

        const frRows = [
            { Level: '2', Code: '13', 'Titres de classes': 'Nouveau-Brunswick' },
            { Level: '3', Code: '1301', 'Titres de classes': 'Saint John' },
            { Level: '4', Code: '1301006', 'Titres de classes': 'Saint John' }
        ];

        const result = normalizePlaces(enRows, frRows);

        expect(result.places.find(place => place.id === 'sgc-cd-1301')).toEqual(expect.objectContaining({
            slug: 'saint-john-county-nb', kind: 'region', parentId: 'sgc-pr-13',
            typeEn: 'Census division', typeFr: 'Division de recensement', featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1301006')).toEqual(expect.objectContaining({
            slug: 'saint-john-nb', kind: 'municipality', parentId: 'sgc-cd-1301',
            typeEn: 'City', typeFr: 'Cité', featured: true, latitude: 45.2733, longitude: -66.0633, defaultZoom: 10
        }));
    });

    test('normalizes 10 v34 capital and municipal expansion places with correct slugs and viewports', () => {
        const enRows = [
            { Level: '2', Code: '60', 'Class title': 'Yukon' },
            { Level: '3', Code: '6001', 'Class title': 'Yukon' },
            { Level: '4', Code: '6001009', 'Class title': 'Whitehorse' },
            { Level: '2', Code: '10', 'Class title': 'Newfoundland and Labrador' },
            { Level: '3', Code: '1001', 'Class title': 'Division No. 1' },
            { Level: '4', Code: '1001519', 'Class title': 'St. John\'s' },
            { Level: '2', Code: '11', 'Class title': 'Prince Edward Island' },
            { Level: '3', Code: '1102', 'Class title': 'Queens' },
            { Level: '4', Code: '1102075', 'Class title': 'Charlottetown' },
            { Level: '2', Code: '47', 'Class title': 'Saskatchewan' },
            { Level: '3', Code: '4706', 'Class title': 'Division No. 6' },
            { Level: '4', Code: '4706027', 'Class title': 'Regina' },
            { Level: '2', Code: '35', 'Class title': 'Ontario' },
            { Level: '3', Code: '3537', 'Class title': 'Essex' },
            { Level: '4', Code: '3537039', 'Class title': 'Windsor' },
            { Level: '3', Code: '3510', 'Class title': 'Frontenac' },
            { Level: '4', Code: '3510010', 'Class title': 'Kingston' },
            { Level: '2', Code: '48', 'Class title': 'Alberta' },
            { Level: '3', Code: '4808', 'Class title': 'Division No. 8' },
            { Level: '4', Code: '4808011', 'Class title': 'Red Deer' },
            { Level: '2', Code: '59', 'Class title': 'British Columbia' },
            { Level: '3', Code: '5933', 'Class title': 'Thompson-Nicola' },
            { Level: '4', Code: '5933042', 'Class title': 'Kamloops' },
            { Level: '3', Code: '5921', 'Class title': 'Nanaimo' },
            { Level: '4', Code: '5921007', 'Class title': 'Nanaimo' },
            { Level: '3', Code: '5909', 'Class title': 'Fraser Valley' },
            { Level: '4', Code: '5909052', 'Class title': 'Abbotsford' }
        ];

        const frRows = enRows.map(row => ({
            Level: row.Level,
            Code: row.Code,
            'Titres de classes': row['Class title']
        }));

        const result = normalizePlaces(enRows, frRows);

        expect(result.places.find(place => place.id === 'sgc-csd-6001009')).toEqual(expect.objectContaining({
            slug: 'whitehorse-yt', kind: 'municipality', parentId: 'sgc-cd-6001',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 60.7212, longitude: -135.0568, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1001519')).toEqual(expect.objectContaining({
            slug: 'st-johns-nl', kind: 'municipality', parentId: 'sgc-cd-1001',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 47.5615, longitude: -52.7126, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-1102075')).toEqual(expect.objectContaining({
            slug: 'charlottetown-pe', kind: 'municipality', parentId: 'sgc-cd-1102',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 46.2382, longitude: -63.1311, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4706027')).toEqual(expect.objectContaining({
            slug: 'regina-sk', kind: 'municipality', parentId: 'sgc-cd-4706',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 50.4452, longitude: -104.6189, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3537039')).toEqual(expect.objectContaining({
            slug: 'windsor-on', kind: 'municipality', parentId: 'sgc-cd-3537',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 42.3149, longitude: -83.0364, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-3510010')).toEqual(expect.objectContaining({
            slug: 'kingston-on', kind: 'municipality', parentId: 'sgc-cd-3510',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 44.2312, longitude: -76.4860, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-4808011')).toEqual(expect.objectContaining({
            slug: 'red-deer-ab', kind: 'municipality', parentId: 'sgc-cd-4808',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 52.2690, longitude: -113.8116, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5933042')).toEqual(expect.objectContaining({
            slug: 'kamloops-bc', kind: 'municipality', parentId: 'sgc-cd-5933',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 50.6745, longitude: -120.3273, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5921007')).toEqual(expect.objectContaining({
            slug: 'nanaimo-bc', kind: 'municipality', parentId: 'sgc-cd-5921',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 49.1659, longitude: -123.9401, defaultZoom: 10
        }));

        expect(result.places.find(place => place.id === 'sgc-cd-5921')).toEqual(expect.objectContaining({
            slug: 'nanaimo-region-bc', kind: 'region', parentId: 'sgc-pr-59',
            typeEn: 'Regional district', typeFr: 'District régional', featured: false
        }));

        expect(result.places.find(place => place.id === 'sgc-csd-5909052')).toEqual(expect.objectContaining({
            slug: 'abbotsford-bc', kind: 'municipality', parentId: 'sgc-cd-5909',
            typeEn: 'City', typeFr: 'Ville', featured: true, latitude: 49.0504, longitude: -122.3045, defaultZoom: 10
        }));
    });

    test('plans aliases when canonical slug changes for an existing place', () => {
        const existingPlaces = [
            { id: 'ca-on-durham', slug: 'durham-on', kind: 'region' },
            { id: 'sgc-csd-3518013', slug: 'oshawa', kind: 'municipality' }
        ];

        const canonicalPlaces = [
            { id: 'ca-on-durham', slug: 'durham-on', kind: 'region' },
            { id: 'sgc-csd-3518013', slug: 'oshawa-on', kind: 'municipality' }
        ];

        const plan = planAliases(existingPlaces, canonicalPlaces, []);

        expect(plan.conflicts).toHaveLength(0);
        expect(plan.aliasesToAdd).toEqual([
            { placeId: 'sgc-csd-3518013', slug: 'oshawa' }
        ]);
    });

    test('detects alias collisions when an old slug is now canonical for another place', () => {
        const existingPlaces = [
            { id: 'place-1', slug: 'shared-slug', kind: 'municipality' }
        ];

        const canonicalPlaces = [
            { id: 'place-1', slug: 'new-slug-1', kind: 'municipality' },
            { id: 'place-2', slug: 'shared-slug', kind: 'municipality' }
        ];

        const plan = planAliases(existingPlaces, canonicalPlaces, []);

        expect(plan.conflicts).toHaveLength(1);
        expect(plan.conflicts[0]).toEqual(expect.objectContaining({
            placeId: 'place-1',
            slug: 'shared-slug',
            reason: 'canonical-claimed',
            existingPlaceId: 'place-2'
        }));
    });
});
