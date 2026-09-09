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
