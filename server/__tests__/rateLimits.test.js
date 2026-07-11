const express = require('express');
const request = require('supertest');
const { profileLimiter, exportLimiter, aggregationLimiter } = require('../middleware/rateLimits');

function appFor(path, limiter) {
    const app = express();
    app.get(path, limiter, (req, res) => res.json({ ok: true }));
    return app;
}

describe('expensive endpoint rate limits', () => {
    it('limits profile requests below the general API allowance', async () => {
        const app = appFor('/profile', profileLimiter);
        for (let i = 0; i < 20; i++) {
            expect((await request(app).get('/profile')).status).toBe(200);
        }
        expect((await request(app).get('/profile')).status).toBe(429);
    });

    it('applies the tighter export allowance', async () => {
        const app = appFor('/export', exportLimiter);
        for (let i = 0; i < 10; i++) {
            expect((await request(app).get('/export')).status).toBe(200);
        }
        expect((await request(app).get('/export')).status).toBe(429);
    });

    it('limits aggregation but lets ordinary pagination bypass that bucket', async () => {
        const app = appFor('/query', aggregationLimiter);
        for (let i = 0; i < 30; i++) {
            expect((await request(app).get('/query?group_by=province&agg=count')).status).toBe(200);
        }
        expect((await request(app).get('/query?group_by=province&agg=count')).status).toBe(429);
        expect((await request(app).get('/query')).status).toBe(200);
    });
});
