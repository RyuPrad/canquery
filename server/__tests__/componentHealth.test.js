jest.mock('../db/catalogReadQueries', () => ({ pingDb: jest.fn() }));
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { pingDb } = require('../db/catalogReadQueries');
const { sanitizeComponent } = require('../services/componentHealth');
const app = require('../app');
let directory;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-ops-'));
    process.env.OPS_STATUS_PATH = path.join(directory, 'status.json');
    pingDb.mockResolvedValue(true);
});
afterEach(async () => { delete process.env.OPS_STATUS_PATH; await fs.rm(directory, { recursive: true, force: true }); });

test('readiness checks only the database and is public, unmetered and no-store', async () => {
    const response = await request(app).get('/readyz').set('Authorization', 'Bearer invalid');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, db: true });
    expect(response.headers['cache-control']).toBe('no-store');
    pingDb.mockRejectedValueOnce(new Error('secret database error'));
    const failed = await request(app).get('/readyz');
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ ok: false, db: false });
});

test.each(['/api/v1/ops/components/preparation', '/web-api/v1/ops/components/preparation', '/API/V1/OPS/COMPONENTS/PREPARATION/'])('component %s remains available with an invalid supplied key', async route => {
    await fs.writeFile(process.env.OPS_STATUS_PATH, JSON.stringify({ version: 1, generated_at: new Date().toISOString(),
        components: { preparation: { ok: true, status: 'ok', checks: { service_active: true, stale_running: 0, account_id: 'private', error: 'secret' } } } }));
    const response = await request(app).get(route).set('Authorization', 'Bearer invalid');
    expect(response.status).toBe(200);
    expect(response.body.data.checks).toEqual({ service_active: true, stale_running: 0 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.headers['x-canquery-credits-limit']).toBeUndefined();
    const head = await request(app).head(route).set('Authorization', 'Bearer invalid');
    expect(head.status).toBe(200);
});

test.each([null, 'malformed', { version: 1, generated_at: 'invalid' },
    { version: 1, generated_at: new Date(Date.now() - 181_000).toISOString(), components: {} }])('missing or invalid observation fails closed: %p', async contents => {
    if (contents !== null) await fs.writeFile(process.env.OPS_STATUS_PATH, typeof contents === 'string' ? contents : JSON.stringify(contents));
    const response = await request(app).get('/api/v1/ops/components/backups');
    expect(response.status).toBe(503);
    expect(response.body.data.ok).toBe(false);
    expect(response.body.data.checks).toEqual({});
});

test('unknown names are 404 and file content is bounded', async () => {
    expect((await request(app).get('/api/v1/ops/components/unknown')).status).toBe(404);
    await fs.writeFile(process.env.OPS_STATUS_PATH, ' '.repeat(65537));
    expect((await request(app).get('/api/v1/ops/components/storage')).status).toBe(503);
});

test('future observations, contradictory state and unapproved/nonfinite metrics never imply health', () => {
    const doc = { version: 1, generated_at: new Date(1000).toISOString(), components: { maps: { ok: true, status: 'degraded' } } };
    expect(sanitizeComponent(doc, 'maps', 1000).status).toBe('unavailable');
    expect(sanitizeComponent(doc, 'maps', -40_000).status).toBe('stale');
    doc.components.maps = { ok: false, status: 'degraded', checks: { failed_resources: 1, error: 'private', free_bytes: Infinity, stale_running: -1 } };
    expect(sanitizeComponent(doc, 'maps', 1000).checks).toEqual({ failed_resources: 1 });
});
