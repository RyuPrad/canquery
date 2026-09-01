const { escapeHtml, renderSearchGrowthReport } = require('../services/searchGrowthReport');

function sample() {
    return {
        latestDate: '2026-08-19',
        lastSyncedAt: '2026-08-20T10:00:00Z',
        summary: {
            current_clicks: 20, prior_clicks: 10,
            current_impressions: 200, prior_impressions: 100,
            current_ctr: 0.1, prior_ctr: 0.1,
            current_position: 4, prior_position: 5
        },
        daily: [
            { data_date: '2026-08-18', clicks: 8 },
            { data_date: '2026-08-19', clicks: 12 }
        ],
        topQueries: [{ value: '<img src=x onerror=alert(1)>', clicks: 2, impressions: 10, ctr: 0.2, position: 3 }],
        topPages: [], zeroClickQueries: [],
        pageOpportunities: [{ value: 'https://canquery.com/datasets/roads', clicks: 0, impressions: 200, ctr: 0, position: 5 }],
        queryPageOpportunities: [{
            query: '<script>alert(1)</script>',
            page: 'https://canquery.com/resources/r1?x=<bad>',
            clicks: 0, impressions: 12, ctr: 0, position: 4
        }],
        countries: [], devices: [], routes: [{
            value: 'Resource pages', pages_with_impressions: 870, pages_with_clicks: 11,
            clicks: 16, impressions: 6269, ctr: 0.0026, position: 10.1
        }]
    };
}

it('escapes imported Search Console text and emits no executable scripts', () => {
    const html = renderSearchGrowthReport(sample(), new Date('2026-08-20T12:00:00Z'));
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script');
    expect(html).toContain('noindex,nofollow,noarchive');
    expect(html).toContain('Finalized through 2026-08-19');
    expect(html).toContain('High-impression, low-CTR pages');
    expect(html).toContain('https://canquery.com/datasets/roads');
    expect(html).toContain('Query-to-page opportunities');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Page-family visibility');
    expect(html).toContain('870');
});

it('renders a safe empty report before the first import', () => {
    const html = renderSearchGrowthReport({
        latestDate: null, lastSyncedAt: null, summary: null, daily: [],
        topQueries: [], topPages: [], zeroClickQueries: [], pageOpportunities: [],
        queryPageOpportunities: [], countries: [], devices: [], routes: []
    });
    expect(html).toContain('No imported data');
    expect(html).toContain('Run the Search Console import');
});

it('escapes all HTML metacharacters', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
});
