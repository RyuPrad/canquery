const express = require('express');
const request = require('supertest');
const { authAbuseLimiter, webhookLimiter } = require('../middleware/abuseLimits');

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
