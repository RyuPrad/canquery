// A matching key for an employer or other organization name, so the same
// employer is recognized across publisher files that spell it differently:
// "DANCHAR LTD.", "Danchar Ltd" and "Danchar Limited" share the key "danchar".
// The key is for comparison only; always display the publisher's own name.

// Legal-form words dropped from the end of a name (English and French).
const LEGAL_SUFFIXES = new Set([
    'inc', 'incorporated', 'incorporee', 'ltd', 'limited', 'ltee', 'limitee', 'corp', 'corporation',
    'co', 'company', 'cie', 'compagnie', 'llc', 'llp', 'lp', 'ulc', 'plc', 'partnership', 'senc', 'sencrl', 'enr'
]);
const MAX_KEY_LENGTH = 200;

function employerKey(name) {
    if (typeof name !== 'string') return '';
    const words = name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        // Periods and apostrophes join their neighbours: "S.E.N.C." is senc, "Joe's" is joes.
        .replace(/[.'’`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    // A name that is only a legal form ("Inc.") keeps it rather than becoming empty.
    while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1))) words.pop();
    return words.join(' ').slice(0, MAX_KEY_LENGTH).trimEnd();
}

module.exports = { employerKey, LEGAL_SUFFIXES };
