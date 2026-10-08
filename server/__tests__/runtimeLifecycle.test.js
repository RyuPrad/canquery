const { EventEmitter } = require('node:events');
const { createShutdown } = require('../services/apiLifecycle');
const { attachMeteredResponse } = require('../middleware/meteredResponse');
const { drain, track } = require('../utils/runtimeWork');
const { startMaintenance } = require('../services/commercialMaintenance');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function response() {
    const res = new EventEmitter();
    Object.assign(res, { statusCode: 200, destroyed: false, writableFinished: false });
    res.end = jest.fn(() => { res.writableFinished = true; res.emit('close'); });
    res.destroy = jest.fn(() => { res.destroyed = true; res.emit('close'); });
    return res;
}

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

test('shutdown is idempotent and awaits request, maintenance and detached accounting before pools', async () => {
    const request = deferred();
    const maintenance = deferred();
    const accounting = deferred();
    track(accounting.promise);
    const server = { close: jest.fn(callback => request.promise.then(callback)), closeIdleConnections: jest.fn() };
    const closeResources = jest.fn(async () => {});
    const exit = jest.fn();
    const shutdown = createShutdown(server, { stopMaintenance: () => maintenance.promise, closeResources, exit,
        drainMs: 1000, cleanupMs: 1000, log: () => {} });
    const done = shutdown();
    expect(shutdown('SIGINT')).toBe(done);
    request.resolve();
    maintenance.resolve();
    await flush();
    expect(closeResources).not.toHaveBeenCalled();
    accounting.resolve();
    await done;
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
});

test('shutdown enforces a deadline without closing pools under unfinished work', async () => {
    const gate = deferred();
    const server = { close: jest.fn(), closeAllConnections: jest.fn() };
    const closeResources = jest.fn(async () => {});
    const exit = jest.fn();
    const shutdown = createShutdown(server, { drainWork: () => gate.promise, closeResources, exit,
        drainMs: 5, cleanupMs: 5, log: () => {} });
    await shutdown();
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(closeResources).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    gate.resolve();
});

test('real SIGTERM drains an active query, streaming export and maintenance pass', async () => {
    const { fork } = require('node:child_process');
    const http = require('node:http');
    const path = require('node:path');
    const child = fork(path.join(__dirname, 'fixtures/runtimeProcess.cjs'), { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const messages = [];
    const ready = new Promise(resolve => child.on('message', message => {
        messages.push(message);
        if (message.event === 'ready') resolve(message.port);
        if (message.event === 'request_started' && message.active === 2) child.kill('SIGTERM');
    }));
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    try {
        const port = await ready;
        const get = route => new Promise((resolve, reject) => {
            http.get({ hostname: '127.0.0.1', port, path: route }, res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => resolve(body));
                res.on('error', reject);
            }).on('error', reject);
        });
        expect(await Promise.all([get('/query'), get('/export')])).toEqual(['{"ok":true}', 'header\nrow\n']);
        expect(await exit).toEqual({ code: 0, signal: null });
        expect(messages.some(message => message.event === 'resources_closed')).toBe(true);
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
