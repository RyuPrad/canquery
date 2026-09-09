// A small, reviewed vocabulary for resident tasks. Expansion happens inside
// the existing search; it never changes geographic or publisher filters.
const TOPICS = [
    ['parks', 'park', 'parcs', 'parc', 'green spaces', 'green space', 'espaces verts', 'espace vert'],
    ['playgrounds', 'playground', 'play areas', 'play area', 'aires de jeux', 'aire de jeux'],
    ['building permits', 'building permit', 'permis de construction', 'permis de bâtir']
];
// Inflection is already handled by PostgreSQL. Repeating singular/plural
// alternatives inflates the planner's match estimate and can bypass the GIN index.
const SEARCH_TERMS = [
    ['parks', 'parcs', 'green spaces', 'espaces verts'],
    ['playgrounds', 'play areas', 'aires de jeux'],
    ['building permits', 'permis de construction', 'permis de bâtir']
];
const words = value => String(value || '').toLocaleLowerCase('fr-CA').match(/[\p{L}\p{N}]+/gu) || [];
const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '');
const aliases = TOPICS.flatMap(terms => terms.map(term => ({ term, terms, tokens: words(term) })))
    .sort((a, b) => b.tokens.length - a.tokens.length);

function searchGroups(query) {
    const tokens = words(query);
    const groups = [];
    for (let i = 0; i < tokens.length;) {
        const alias = aliases.find(item => item.tokens.every((token, j) =>
            fold(token) === fold(tokens[i + j] || '')));
        groups.push(alias ? alias.terms : [tokens[i]]);
        i += alias ? alias.tokens.length : 1;
    }
    return groups;
}

function searchExpression(query) {
    return searchGroups(query).map(group => SEARCH_TERMS[TOPICS.indexOf(group)] || group)
        .map(group => '(' + group.map(term =>
        words(term).map(token => "'" + token + "'").join(' <-> ')
    ).join(' | ') + ')').join(' & ');
}

function literalPatterns(query) {
    return searchGroups(query).map(group => '\\m(' + group.map(term =>
        words(term).join('[[:space:]]+')
    ).join('|') + ')\\M');
}

function oneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1 || a === b) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (a.length >= b.length) i++;
        if (b.length >= a.length) j++;
    }
    return edits + Number(i < a.length || j < b.length) === 1;
}

function spellingSuggestions(query) {
    const normalized = words(query).join(' ');
    if (normalized.length < 4 || aliases.some(item => fold(item.term) === fold(normalized))) return [];
    return [...new Set(aliases.filter(item => oneEdit(fold(normalized), fold(item.term)))
        .map(item => item.term))].slice(0, 3);
}

module.exports = { searchExpression, literalPatterns, spellingSuggestions };
