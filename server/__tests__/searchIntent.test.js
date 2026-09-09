const { classifySearchIntent, classifyRows, summarizeIntent } = require('../services/searchIntent');

describe('Search Console intent classification', () => {
    test.each([
        ['positive labour market impact assessment list', 'semantic'],
        ['uxbridge ward map', 'semantic'],
        ['canquery', 'brand'],
        ['Can Query Canadian data', 'brand'],
        ['site:canquery.com "api docs" canquery', 'diagnostic'],
        ['"1f3f08ee-5c60-4c8d-8b70-bd5f0350f5e8" csv', 'diagnostic'],
        ['canquery github', 'diagnostic']
    ])('classifies %s as %s', (query, expected) => {
        expect(classifySearchIntent(query)).toBe(expected);
    });

    it('keeps raw rows while adding intent and summarizes their metrics', () => {
        const rows = classifyRows([
            { query: 'water data', clicks: 1, impressions: 10 },
            { query: 'canquery', clicks: 2, impressions: 5 },
            { query: 'site:canquery.com', clicks: 0, impressions: 20 }
        ], 'query');
        expect(rows.map(row => row.intent)).toEqual(['semantic', 'brand', 'diagnostic']);
        const summary = summarizeIntent(rows);
        expect(summary.find(row => row.intent === 'semantic')).toEqual(expect.objectContaining({
            queries: 1, clicks: 1, impressions: 10, ctr: 0.1
        }));
        expect(summary.find(row => row.intent === 'diagnostic').impressions).toBe(20);
    });
});
