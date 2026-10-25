const { searchExpression, literalPatterns, spellingSuggestions } = require('../services/localSearch');

test('expands resident topics while retaining other query words', () => {
    expect(searchExpression('parks school')).toContain("'parcs'");
    expect(searchExpression('parks school')).toMatch(/ & \('school'\)$/);
    expect(searchExpression('permis de construction')).toContain("'building' <-> 'permits'");
    expect(searchExpression('parking permits')).not.toContain("'construction'");
});

test('builds literal whole-word patterns so parks does not mean parking', () => {
    const [pattern] = literalPatterns('parks');
    expect(pattern.startsWith('\\m(')).toBe(true);
    expect(pattern.endsWith(')\\M')).toBe(true);
    expect(literalPatterns("parks' | ! ; DROP TABLE")).toHaveLength(3);
});

test('suggests one-edit vocabulary corrections without replacing valid queries', () => {
    expect(spellingSuggestions('playgrouds')).toContain('playgrounds');
    expect(spellingSuggestions('parc')).toEqual([]);
    expect(spellingSuggestions('parks')).toEqual([]);
    expect(spellingSuggestions('xx')).toEqual([]);
    expect(spellingSuggestions('completely unrelated')).toEqual([]);
});

test('pairs the guide topics across English and French without swallowing other words', () => {
    expect(searchExpression("permis d'entreprise toronto")).toBe(
        "('business' <-> 'licences' | 'business' <-> 'licenses' | 'permis' <-> 'd' <-> 'entreprise') & ('toronto')");
    expect(searchExpression('EIMT')).toBe("('lmia' | 'eimt')");
    expect(searchExpression('séismes')).toContain("'earthquakes'");
    expect(searchExpression('earthquake')).toContain("'tremblements' <-> 'de' <-> 'terre'");
    expect(searchExpression('organismes de bienfaisance')).toContain("'charities'");
    expect(searchExpression('maladies à déclaration obligatoire')).toContain("'notifiable' <-> 'diseases'");
    expect(searchExpression('natural health products')).toContain("'produits' <-> 'de' <-> 'santé' <-> 'naturels'");
    expect(searchExpression('zoning bylaw')).toBe("('zoning' | 'zonage') & ('bylaw')");
    expect(searchExpression('flood map calgary')).toMatch(/'zones' <-> 'inondables'\) & \('calgary'\)$/);
    // A word that merely contains a topic stays a plain word.
    expect(searchExpression('electoral districts')).toBe("('electoral') & ('districts')");
    expect(spellingSuggestions('earthquaks')).toContain('earthquakes');
});
