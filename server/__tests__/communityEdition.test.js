// The open-source edition must work on its own: without an installed extension
// there are no hosted pages, account routes or credit wording anywhere.
const path = require('path');
const request = require('supertest');

const ENTRY = path.join(__dirname, '..', 'enterprise', 'index.js');

function community() {
    let modules;
    jest.isolateModules(() => {
        const fs = require('fs');
        const exists = fs.existsSync.bind(fs);
        jest.spyOn(fs, 'existsSync').mockImplementation(target => target !== ENTRY && exists(target));
        jest.doMock('../db/catalogReadQueries', () => new Proxy({}, {
            get: (target, name) => (target[name] ||= jest.fn(async () => (/^(count|get)/.test(String(name)) ? null : [])))
        }));
        modules = {
            app: require('../app'),
            seo: require('../services/seoMeta'),
            spa: require('../controllers/spaController'),
            routeAssets: require('../services/routeAssets')
        };
    });
    return modules;
}

afterEach(() => jest.restoreAllMocks());

test('hosted page types do not exist', async () => {
    const { seo, spa, routeAssets } = community();
    for (const page of ['/pricing', '/terms', '/account', '/login', '/signup', '/forgot-password', '/reset-password']) {
        expect(seo.classifyRoute(page).type).toBe('other');
        expect((await spa.resolvePage(page)).status).toBe(404);
        expect(routeAssets.routeAssets(page, { 'src/pages/PricingPage.jsx': { file: 'assets/PricingPage.js' } })).toEqual([]);
    }
});

test('documentation and FAQ describe anonymous use without accounts or credits', async () => {
    const { seo, spa } = community();
    const docs = await spa.resolvePage('/docs');
    expect(docs.status).toBe(200);
    expect(docs.body).toContain('Read metadata before querying rows');
    expect(docs.body).toContain('Distinguish PREPARATION_BUSY, PREPARATION_COOLDOWN and AUTOMATED_CLIENT.');
    // The endpoint reference renders the OpenAPI descriptions; check the written sections.
    const written = docs.body.slice(0, docs.body.indexOf('<section id="reference">')) +
        docs.body.slice(docs.body.indexOf('<section id="reliability">'));
    for (const hosted of ['Authorization: Bearer', 'href="/pricing"', 'href="/account"', 'Create an API key', 'credits', 'QUOTA_EXCEEDED']) {
        expect(written).not.toContain(hosted);
    }
    expect(seo.staticMeta('docs', '/docs').description).not.toContain('API keys');
    const faq = await spa.resolvePage('/faq');
    expect(faq.status).toBe(200);
    expect(faq.body).toContain('Working with data');
    for (const hosted of ['Do I need an account?', 'Accounts and the API', 'href="/pricing"', 'href="/terms"']) {
        expect(faq.body).not.toContain(hosted);
    }
    expect(seo.staticMeta('faq', '/faq').description).not.toContain('developer accounts');
});

test('crawl files list no hosted pages and hosted endpoints are absent', async () => {
    const { app } = community();
    const sitemap = await request(app).get('/sitemap-pages.xml');
    expect(sitemap.text).toContain('https://canquery.com/about');
    expect(sitemap.text).toContain('https://canquery.com/privacy');
    expect(sitemap.text).not.toContain('/pricing');
    expect(sitemap.text).not.toContain('/terms');
    expect((await request(app).post('/api/stripe/webhook').send('{}')).status).toBe(404);
    expect((await request(app).get('/api/auth/get-session')).status).toBe(404);
    expect((await request(app).get('/api/account/plans')).status).toBe(404);
});
