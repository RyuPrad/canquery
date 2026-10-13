// Metered responses and the hosted maintenance loop: settlement, reversal on
// disconnect or deadline, heartbeat failure and serial maintenance shutdown.
const { EventEmitter } = require('node:events');
const express = require('express');
const request = require('supertest');
const { requestLifetime } = require('../../middleware/requestLifetime');
const { requestSignal } = require('../../utils/requestContext');
const catchAsync = require('../../utils/catchAsync');
const { drain } = require('../../utils/runtimeWork');
const { attachMeteredResponse } = require('../middleware/meteredResponse');
const { startMaintenance } = require('../services/commercialMaintenance');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function waitForAbort(signal) {
    return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

function response() {
    const res = new EventEmitter();
    Object.assign(res, { statusCode: 200, destroyed: false, writableFinished: false });
    res.end = jest.fn(() => { res.writableFinished = true; res.emit('close'); });
    res.destroy = jest.fn(() => { res.destroyed = true; res.emit('close'); });
    return res;
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

test('double end charges once, and disconnect during settlement reverses afterward', async () => {
    const gate = deferred();
    const res = response();
    const queries = { settle: jest.fn(() => gate.promise), abortRequest: jest.fn(async () => {}) };
    attachMeteredResponse(res, { id: 'request' }, { queries, pool: { query: jest.fn() } });
    res.end('first');
    res.end('duplicate');
    await flush();
    expect(queries.settle).toHaveBeenCalledTimes(1);
    res.destroy();
    expect(queries.abortRequest).not.toHaveBeenCalled();
    gate.resolve();
    await drain();
    expect(queries.abortRequest).toHaveBeenCalledTimes(1);
});

test('successful completion is charged and ordinary error response is released', async () => {
    for (const status of [200, 400]) {
        const res = response();
        res.statusCode = status;
        const queries = { settle: jest.fn(async () => {}), abortRequest: jest.fn(async () => {}) };
        attachMeteredResponse(res, { id: 'request' }, { queries, pool: { query: jest.fn() } });
        res.end();
        await drain();
        await flush();
        expect(queries.settle).toHaveBeenCalledWith('request', status === 200);
        expect(queries.abortRequest).not.toHaveBeenCalled();
    }
});

test('deadline closes a partial stream and reverses its reservation', async () => {
    const res = response();
    const queries = { settle: jest.fn(), abortRequest: jest.fn(async () => {}) };
    attachMeteredResponse(res, { id: 'request' }, { queries, pool: { query: jest.fn() }, deadlineMs: 5 });
    await new Promise(resolve => setTimeout(resolve, 15));
    await drain();
    expect(res.destroy).toHaveBeenCalledTimes(1);
    expect(queries.abortRequest).toHaveBeenCalledWith('request');
});

test('heartbeat failure aborts; overlapping renewals are suppressed', async () => {
    const gate = deferred();
    const res = response();
    const pool = { query: jest.fn(() => gate.promise.then(() => { throw new Error('private connection detail'); })) };
    const queries = { settle: jest.fn(), abortRequest: jest.fn(async () => {}) };
    attachMeteredResponse(res, { id: 'request' }, { queries, pool, heartbeatMs: 5 });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(pool.query).toHaveBeenCalledTimes(1);
    gate.resolve();
    await drain();
    await flush();
    expect(res.destroy).toHaveBeenCalledTimes(1);
    expect(queries.abortRequest).toHaveBeenCalledTimes(1);
});

test('maintenance stop awaits the current serial pass and logs only named sanitized outcomes', async () => {
    const gate = deferred();
    const entries = [];
    const later = jest.fn(async () => { throw new Error('secret test payload'); });
    const stop = startMaintenance({ intervalMs: 1, log: entry => entries.push(entry), tasks: [
        { name: 'held', run: () => gate.promise }, { name: 'later', run: later }
    ] });
    let stopped = false;
    const done = stop().then(() => { stopped = true; });
    await flush();
    expect(stopped).toBe(false);
    gate.resolve();
    await done;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(later).toHaveBeenCalledTimes(1);
    expect(entries.map(entry => [entry.task, entry.outcome])).toEqual([['held', 'ok'], ['later', 'failed']]);
    expect(JSON.stringify(entries)).not.toContain('secret test payload');
});
