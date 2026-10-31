const { pickTranslated, normalizePackage, normalizeJurisdiction } = require('../services/catalogNormalizer');

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

describe('catalogNormalizer.normalizeJurisdiction', () => {
    it('keeps the three declared levels of government and nothing else', () => {
        expect(normalizeJurisdiction(' Provincial ')).toBe('provincial');
        expect(normalizeJurisdiction('federal')).toBe('federal');
        expect(normalizeJurisdiction('municipal')).toBe('municipal');
        for (const value of [undefined, null, '', 'regional', 42, ['federal']]) expect(normalizeJurisdiction(value)).toBeNull();
    });

    it('records the declared jurisdiction on the normalized dataset', () => {
        const pkg = { id: 'd2', name: 'roads', title: 'Roads', jurisdiction: 'provincial', resources: [] };
        expect(normalizePackage(pkg).dataset.jurisdiction).toBe('provincial');
        expect(normalizePackage({ ...pkg, jurisdiction: undefined }).dataset.jurisdiction).toBeNull();
    });
});

describe('catalogNormalizer provincial publishers', () => {
    const pkg = (organization, jurisdiction) => ({
        id: 'd-' + organization + '-' + jurisdiction, name: 'n', title: 'T', jurisdiction, resources: [],
        organization: { id: 'org-' + organization, name: organization, title: 'Publisher | Éditeur' }
    });

    it('places a provincial government\'s provincial record in its province, without inheritance', () => {
        const n = normalizePackage(pkg('ab', 'provincial'));
        expect(n.organization.placeId).toBe('sgc-pr-48');
        expect(n.places).toEqual([{ datasetId: 'd-ab-provincial', placeId: 'sgc-pr-48', relationship: 'direct',
            includesDescendants: false, assignmentMethod: 'source' }]);
        expect(normalizePackage(pkg('on', 'provincial')).places[0].placeId).toBe('ca-on');
    });

    it('gives Québec its place but leaves its municipal records unplaced', () => {
        const n = normalizePackage(pkg('qc', 'municipal'));
        expect(n.organization.placeId).toBe('sgc-pr-24');
        expect(n.places).toEqual([]);
    });

    it('leaves federal publishers and provincial records from unlisted publishers unplaced', () => {
        for (const n of [normalizePackage(pkg('ec', 'federal')), normalizePackage(pkg('ec', 'provincial'))]) {
            expect(n.organization.placeId).toBeNull();
            expect(n.places).toEqual([]);
        }
        expect(normalizePackage({ id: 'x', name: 'x', title: 'X', jurisdiction: 'provincial', resources: [] }).places).toEqual([]);
        // Inherited object properties are not publishers.
        expect(normalizePackage(pkg('constructor', 'provincial')).places).toEqual([]);
    });
});
