jest.mock('../db/commercialQueries', () => ({
    ...jest.requireActual('../db/commercialQueries'),
    authenticate: jest.fn(), reserve: jest.fn()
}));
const request = require('supertest');
const app = require('../app');
const commercial = require('../db/commercialQueries');
const savedEnv = { ...process.env };
beforeEach(() => { process.env.COMMERCIAL_API_ENABLED = 'false'; });
afterAll(() => { process.env = savedEnv; });

test.each(['/api/v1', '/web-api/v1', '/API/V1', '/WEB-API/V1'])('%s keeps API responses crawlable but nonindexable', async base => {
    const first = await request(app).get(base + '/blog/');
    expect(first.status).toBe(200);
    expect(first.headers['x-robots-tag']).toBe('noindex');
    const conditional = await request(app).get(base + '/blog/').set('If-None-Match', first.headers.etag);
    expect(conditional.status).toBe(304);
    expect(conditional.headers['x-robots-tag']).toBe('noindex');
    const missing = await request(app).get(base + '/blog/en/missing-guide');
    expect(missing.status).toBe(404);
    expect(missing.headers['x-robots-tag']).toBe('noindex');
    const cors = await request(app).get(base + '/blog').set('Origin', 'https://untrusted.example');
    expect(cors.status).toBe(403);
    expect(cors.headers['x-robots-tag']).toBe('noindex');
    const malformed = await request(app).post(base + '/resources/fixture/prepare').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.headers['x-robots-tag']).toBe('noindex');
});

test('authentication and metered rate failures retain noindex and private caching', async () => {
    process.env.COMMERCIAL_API_ENABLED = 'true';
    process.env.STRIPE_MODE = 'sandbox';
    process.env.BETTER_AUTH_SECRET = 'fixture-only-more-than-thirty-two-characters';
    const unauthorized = await request(app).get('/api/v1/blog').set('Authorization', 'invalid');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers['x-robots-tag']).toBe('noindex');
    commercial.authenticate.mockResolvedValue({});
    commercial.reserve.mockRejectedValue(commercial.failure('Rate limit', 'RATE_LIMIT', 429));
    const limited = await request(app).get('/API/V1/blog/').set('Authorization', 'Bearer fixture');
    expect(limited.status).toBe(429);
    expect(limited.headers['x-robots-tag']).toBe('noindex');
    expect(limited.headers['cache-control']).toBe('private, no-store');
});

test('does not extend the header to similar prefixes or public crawl files', async () => {
    for (const path of ['/api/v10/blog', '/web-api/v10/blog', '/robots.txt', '/sitemap-pages.xml']) {
        const response = await request(app).get(path);
        expect(response.headers['x-robots-tag']).toBeUndefined();
    }
});
