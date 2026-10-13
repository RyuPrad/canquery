jest.mock('../db/commercialQueries', () => ({
    ...jest.requireActual('../db/commercialQueries'),
    authenticate: jest.fn(), reserve: jest.fn()
}));
const request = require('supertest');
const app = require('../../app');
const commercial = require('../db/commercialQueries');
const savedEnv = { ...process.env };
afterAll(() => { process.env = savedEnv; });

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
