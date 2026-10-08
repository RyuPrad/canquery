const express = require('express');
const http = require('node:http');
const request = require('supertest');
const { requestLifetime } = require('../middleware/requestLifetime');
const { requestSignal } = require('../utils/requestContext');
const catchAsync = require('../utils/catchAsync');
const { fetchWithBackoff } = require('../utils/fetchWithBackoff');
const { createCache } = require('../utils/cache');
const { attachMeteredResponse } = require('../middleware/meteredResponse');
const { drain } = require('../utils/runtimeWork');

const flush = () => new Promise(resolve => setImmediate(resolve));
function waitForAbort(signal) {
    return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

test('no-progress timeout returns504, cancels upstream work and refunds keyed reservations', async () => {
    const app = express();
    const queries = { settle: jest.fn(async () => {}), abortRequest: jest.fn(async () => {}) };
    let signal, completed = false;
    app.use(requestLifetime({ idleMs: 25 }));
    app.get('/', (req, res, next) => {
        attachMeteredResponse(res, { id: 'fixture' }, { queries, pool: { query: jest.fn() } }); next();
    }, catchAsync(async () => {
        signal = requestSignal();
        try { await waitForAbort(signal); } finally { completed = true; }
    }));
    const result = await request(app).get('/');
    expect(result.status).toBe(504);
    expect(result.body.code).toBe('REQUEST_TIMEOUT');
    await drain();
    expect(signal.aborted).toBe(true);
    expect(completed).toBe(true);
    expect(queries.settle).toHaveBeenCalledWith('fixture', false);
});

test('stream writes reset the progress deadline and completion clears it', async () => {
    const app = express();
    app.use(requestLifetime({ idleMs: 60 }));
    app.get('/', catchAsync(async (req, res) => {
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
            req.signal.throwIfAborted();
            res.write('row\n');
        }
        res.end();
    }));
    const result = await request(app).get('/');
    expect(result.status).toBe(200);
    expect(result.text).toBe('row\n'.repeat(5));
});

test('client disconnect cancels ongoing work before the idle deadline', async () => {
    const app = express();
    let start, signal;
    const started = new Promise(resolve => { start = resolve; });
    app.use(requestLifetime({ idleMs: 5000 }));
    app.get('/', catchAsync(async () => {
        signal = requestSignal(); start(); await waitForAbort(signal);
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const client = http.get('http://127.0.0.1:' + server.address().port);
    client.on('error', () => {});
    try {
        await started;
        client.destroy();
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        await drain();
        expect(signal.aborted).toBe(true);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a cancelled retry disposes its body and does not issue another upstream attempt', async () => {
    const original = global.fetch;
    const controller = new AbortController();
    const cancel = jest.fn(async () => {});
    global.fetch = jest.fn(async () => ({ status: 503, body: { cancel } }));
    try {
        const pending = fetchWithBackoff('https://example.test', { signal: controller.signal });
        await flush();
        controller.abort(new Error('request ended'));
        await expect(pending).rejects.toThrow();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(1);
    } finally { global.fetch = original; }
});

test('a stalled fetch gets the caller signal and never retries its cancellation', async () => {
    const original = global.fetch;
    const controller = new AbortController();
    global.fetch = jest.fn((_url, options) => waitForAbort(options.signal));
    try {
        const pending = fetchWithBackoff('https://example.test', { signal: controller.signal });
        controller.abort(new Error('closed'));
        await expect(pending).rejects.toThrow('closed');
        expect(fetch).toHaveBeenCalledTimes(1);
    } finally { global.fetch = original; }
});

test('request-owned cache misses cannot cancel another request and still cache completed results', async () => {
    const cache = createCache({ ttlMs: 1000, maxEntries: 10 });
    const controller = new AbortController();
    const first = cache.get('same', () => waitForAbort(controller.signal), { deduplicate: false });
    const second = cache.get('same', async () => 'completed', { deduplicate: false });
    controller.abort(new Error('closed'));
    await expect(first).rejects.toThrow('closed');
    await expect(second).resolves.toBe('completed');
    expect(await cache.get('same', () => { throw new Error('cache miss'); })).toBe('completed');
});

test('a partial stalled export closes the stream and reverses its request once', async () => {
    const app = express();
    const queries = { settle: jest.fn(async () => {}), abortRequest: jest.fn(async () => {}) };
    let closed;
    app.use(requestLifetime({ idleMs: 25 }));
    app.get('/', (req, res, next) => {
        closed = new Promise(resolve => res.once('close', resolve));
        attachMeteredResponse(res, { id: 'export' }, { queries, pool: { query: jest.fn() } }); next();
    }, catchAsync(async (req, res) => {
        res.write('header\n');
        await waitForAbort(req.signal);
    }));
    await expect(request(app).get('/')).rejects.toThrow();
    await closed;
    await drain();
    expect(queries.settle).not.toHaveBeenCalled();
    expect(queries.abortRequest).toHaveBeenCalledTimes(1);
});

test('caller cancellation interrupts reading a stalled response body', async () => {
    let connected;
    const connection = new Promise(resolve => { connected = resolve; });
    const upstream = http.createServer((_req, res) => { res.write('{'); connected(); });
    upstream.listen(0, '127.0.0.1');
    await new Promise(resolve => upstream.once('listening', resolve));
    const controller = new AbortController();
    try {
        const pending = fetchWithBackoff('http://127.0.0.1:' + upstream.address().port, { signal: controller.signal });
        await connection;
        const response = await pending;
        const body = response.json();
        controller.abort(new Error('caller ended'));
        await expect(body).rejects.toThrow();
    } finally {
        upstream.closeAllConnections();
        await new Promise(resolve => upstream.close(resolve));
    }
});
