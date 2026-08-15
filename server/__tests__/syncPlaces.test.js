const { normalize, slugify, rowsFrom } = require('../scripts/sync-places');

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
        expect(result.places.find(place => place.id === 'ca-on-durham')).toEqual(expect.objectContaining({ parentId: 'ca-on', slug: 'durham-on' }));
        expect(result.places.find(place => place.id === 'ca-on-oshawa')).toEqual(expect.objectContaining({ parentId: 'ca-on-durham', slug: 'oshawa-on' }));
    });

    test('decodes CSV buffers and produces URL-safe accents', () => {
        const parsed = rowsFrom(Buffer.from('Level,Code,Class title\n2,35,Ontario\n'), 'utf-8');
        expect(parsed[0].Code).toBe('35');
        expect(slugify('Montréal')).toBe('montreal');
    });
});
