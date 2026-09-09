// Explicit ASCII word boundaries have the same meaning in JavaScript and
// PostgreSQL, unlike their locale-dependent \b / \y implementations.
const START = '(^|[^a-z0-9_])';
const END = '($|[^a-z0-9_])';
// ECMAScript whitespace, explicitly shared with PostgreSQL's regex engine.
const SPACE = '[\\t\\n\\v\\f\\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\uFEFF]';
const PATTERNS = Object.freeze({
    empty: '^' + SPACE + '*$',
    diagnostic: START + 'site' + SPACE + '*:|' + START +
        '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' + END +
        '|' + START + '[0-9a-f]{20,}' + END,
    brand: 'canquery|' + START + 'can query' + END,
    technical: START + '(github|api docs?|resource id|dataset id)' + END
});
const MATCHERS = Object.fromEntries(Object.entries(PATTERNS).map(([key, pattern]) => [key, new RegExp(pattern, 'i')]));
const INTENTS = ['semantic', 'brand', 'diagnostic'];

function classifySearchIntent(value) {
    const query = String(value == null ? '' : value).trim().toLowerCase();
    if (MATCHERS.empty.test(query) || MATCHERS.diagnostic.test(query)) {
        return 'diagnostic';
    }
    if (MATCHERS.brand.test(query) && MATCHERS.technical.test(query)) {
        return 'diagnostic';
    }
    if (MATCHERS.brand.test(query)) {
        return 'brand';
    }
    return 'semantic';
}

function searchIntentSql(column) {
    if (!['value', 'query_text'].includes(column)) throw new Error('Unsupported query column');
    const matches = key => `coalesce(${column}, '') ~* '${PATTERNS[key].replace(/'/g, "''")}'`;
    return `(CASE WHEN ${matches('empty')} OR ${matches('diagnostic')}
        OR (${matches('brand')} AND ${matches('technical')}) THEN 'diagnostic'
        WHEN ${matches('brand')} THEN 'brand' ELSE 'semantic' END)`;
}

function classifyRows(rows, key = 'value') {
    return (rows || []).map(row => ({ ...row, intent: classifySearchIntent(row[key]) }));
}

function summarizeIntent(rows) {
    const totals = new Map(['semantic', 'brand', 'diagnostic'].map(intent => [intent, {
        intent, queries: 0, clicks: 0, impressions: 0
    }]));
    for (const row of rows || []) {
        const intent = row.intent || classifySearchIntent(row.query || row.value);
        const total = totals.get(intent);
        total.queries += 1;
        total.clicks += Number(row.clicks) || 0;
        total.impressions += Number(row.impressions) || 0;
    }
    return Array.from(totals.values()).map(total => ({
        ...total,
        ctr: total.impressions ? total.clicks / total.impressions : 0
    }));
}

module.exports = { classifySearchIntent, classifyRows, summarizeIntent, searchIntentSql, INTENTS };
