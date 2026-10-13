// What the installed hosted extension adds on top of the core pages and checks.
const request = require('supertest');
const snapshot = require('../../services/seoSnapshot');

test('the installed hosted extension skips the database edition check', async () => {
    const { extension, assertEditionMatchesDatabase } = require('../../extensions');
    expect(extension().edition).toBe('enterprise');
    const db = { query: jest.fn() };
    await assertEditionMatchesDatabase(db);
    expect(db.query).not.toHaveBeenCalled();
});

test('the FAQ adds the accounts section with credit and refund answers', () => {
    const html = snapshot.staticSnapshot('faq');
    expect(html.match(/<details>/g)).toHaveLength(11);
    expect(html.match(/<summary>/g)).toHaveLength(11);
    expect(html).toContain('<h2>Accounts and the API</h2>');
    expect(html).toContain('original payer and allowance period');
    expect(html).toContain('These are account credits, not cash refunds.');
    for (const path of ['/pricing', '/terms']) expect(html).toContain('href="' + path + '"');
});

test('the pages sitemap lists pricing and terms but no account pages', async () => {
    let app;
    jest.isolateModules(() => {
        jest.doMock('../../db/catalogReadQueries', () => new Proxy({}, {
            get: (target, name) => (target[name] ||= jest.fn(async () => (/^(count|get)/.test(String(name)) ? null : [])))
        }));
        app = require('../../app');
    });
    const res = await request(app).get('/sitemap-pages.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<loc>https://canquery.com/pricing</loc>');
    expect(res.text).toContain('<loc>https://canquery.com/terms</loc>');
    expect(res.text).not.toMatch(/\/account|\/signup|\/api\/v1/);
});
