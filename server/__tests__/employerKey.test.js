const { employerKey } = require('../utils/employerKey');

test('spellings of one employer share a key', () => {
    const key = employerKey('Danchar Ltd');
    expect(key).toBe('danchar');
    for (const spelling of ['DANCHAR LTD.', 'Danchar Limited', '  danchar   ltd ', 'Danchar, Ltd.', 'Danchar Ltée', 'Danchar Inc.'])
        expect(employerKey(spelling)).toBe(key);
});

test('numbered companies keep their number and jurisdiction', () => {
    expect(employerKey('1001498633 Ontario Inc')).toBe('1001498633 ontario');
    expect(employerKey('1001498633 ONTARIO INC.')).toBe('1001498633 ontario');
    expect(employerKey('1001498634 Ontario Inc')).not.toBe(employerKey('1001498633 Ontario Inc'));
});

test('accents, ampersands, apostrophes and dotted abbreviations normalize', () => {
    expect(employerKey('Boulangerie Saint-Méthode Inc.')).toBe('boulangerie saint methode');
    expect(employerKey('Smith & Sons Construction Ltd.')).toBe('smith and sons construction');
    expect(employerKey('Smith and Sons Construction Limited')).toBe('smith and sons construction');
    expect(employerKey("Joe's Pizza")).toBe('joes pizza');
    expect(employerKey('Joe’s Pizza')).toBe('joes pizza');
    expect(employerKey('Tremblay & Fils S.E.N.C.')).toBe('tremblay and fils');
    expect(employerKey('Acme Holdings Limited Partnership')).toBe('acme holdings');
});

test('legal words inside a name stay; only trailing ones go', () => {
    expect(employerKey('Inc Designs Ltd')).toBe('inc designs');
    expect(employerKey('The Co-operators General Insurance Company')).toBe('the co operators general insurance');
    expect(employerKey('Inc.')).toBe('inc');
});

test('the key is stable, bounded and safe for missing values', () => {
    for (const name of ['Danchar Ltd', 'Boulangerie Saint-Méthode Inc.', 'Smith & Sons'])
        expect(employerKey(employerKey(name))).toBe(employerKey(name));
    expect(employerKey('a'.repeat(500))).toHaveLength(200);
    expect(employerKey('')).toBe('');
    expect(employerKey('   ')).toBe('');
    expect(employerKey(null)).toBe('');
    expect(employerKey(42)).toBe('');
});
