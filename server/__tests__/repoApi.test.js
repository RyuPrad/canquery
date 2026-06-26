// Mock the service so the test never calls the real GitHub API.
jest.mock('../services/repoService', () => ({ getRepoStats: jest.fn() }));
const request = require('supertest');
const repoService = require('../services/repoService');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/v1/repo', () => {
    it('returns the live star count in the standard envelope', async () => {
        repoService.getRepoStats.mockResolvedValue({ stars: 28 });
        const res = await request(app).get('/api/v1/repo');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ stars: 28 });
        expect(res.body.meta.upstream).toBe('api.github.com');
        expect(res.body.meta.source).toBe('github');
        expect(res.headers['cache-control']).toBe('public, max-age=300');
    });

    it('returns data: null (graceful fallback) when GitHub is unreachable', async () => {
        repoService.getRepoStats.mockResolvedValue(null);
        const res = await request(app).get('/api/v1/repo');
        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
        expect(repoService.getRepoStats).toHaveBeenCalledTimes(1);
    });

    it('passes upstream errors to the central error handler', async () => {
        repoService.getRepoStats.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 502 }));
        const res = await request(app).get('/api/v1/repo');
        expect(res.status).toBe(502);
    });
});
