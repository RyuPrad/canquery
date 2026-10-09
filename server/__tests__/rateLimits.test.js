const express = require('express');
const request = require('supertest');
const {
    authAbuseLimiter, webhookLimiter, profileLimiter, exportLimiter, mapLimiter, aggregationLimiter
} = require('../middleware/rateLimits');

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

    it('bounds live map viewport requests', async () => {
        const app = appFor('/map', mapLimiter);
        for (let i = 0; i < 60; i++) {
            expect((await request(app).get('/map')).status).toBe(200);
        }
        expect((await request(app).get('/map')).status).toBe(429);
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

describe('pre-database abuse limits', () => {
    it.each([
        ['authentication', authAbuseLimiter],
        ['webhook', webhookLimiter]
    ])('bounds %s requests before expensive processing', async (_name, limiter) => {
        const app = express();
        app.post('/target', limiter, (_req, res) => res.json({ ok: true }));
        for (let i = 0; i < 120; i++) {
            expect((await request(app).post('/target')).status).toBe(200);
        }
        expect((await request(app).post('/target')).status).toBe(429);
    });
});
