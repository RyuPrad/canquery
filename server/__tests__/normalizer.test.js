const { pickTranslated, normalizePackage } = require('../services/catalogNormalizer');

describe('catalogNormalizer.pickTranslated', () => {
    it('prefers the translated values and trims them', () => {
        expect(pickTranslated({ en: ' Water quality ', fr: ' Qualité de l’eau ' }, 'fallback'))
            .toEqual({ en: 'Water quality', fr: 'Qualité de l’eau' });
    });

    it('falls back to the untranslated title when EN is missing', () => {
        expect(pickTranslated({ fr: 'Qualité' }, 'Water quality'))
            .toEqual({ en: 'Water quality', fr: 'Qualité' });
    });

    // Regression: an explicit null in the payload was String()-coerced into a
    // literal "null" title instead of falling back.
    it('treats an explicit null like a missing translation', () => {
        expect(pickTranslated({ en: null, fr: 'Qualité' }, 'Water quality'))
            .toEqual({ en: 'Water quality', fr: 'Qualité' });
        expect(pickTranslated({ en: 'Water quality', fr: null }, null))
            .toEqual({ en: 'Water quality', fr: null });
    });

    it('handles a missing object', () => {
        expect(pickTranslated(undefined, 'x')).toEqual({ en: null, fr: null });
    });
});

describe('catalogNormalizer.normalizePackage', () => {
    it('never emits a literal "null" title for a package with null translations', () => {
        const pkg = {
            id: 'd1',
            name: 'water-quality',
            title: 'Water quality',
            title_translated: { en: null, fr: null },
            notes_translated: { en: null },
            keywords: {},
            resources: [],
        };
        const n = normalizePackage(pkg);
        expect(n.dataset.titleEn).toBe('Water quality');
        expect(n.dataset.titleFr).toBeNull();
        expect(n.dataset.notesEn).not.toBe('null');
    });
});
