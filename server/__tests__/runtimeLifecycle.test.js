const { createShutdown } = require('../services/apiLifecycle');
const { track } = require('../utils/runtimeWork');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

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
