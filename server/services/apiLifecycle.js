const { drain } = require('../utils/runtimeWork');

function positiveDuration(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
    return value;
}
function beforeDeadline(work, milliseconds) {
    let timer;
    return Promise.race([work.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })])
        .finally(() => clearTimeout(timer));
}
function createShutdown(server, { stopMaintenance = async () => {}, closeResources = async () => {},
    drainWork = drain, drainMs = positiveDuration('API_SHUTDOWN_DRAIN_MS', 270000),
    cleanupMs = positiveDuration('API_SHUTDOWN_CLEANUP_MS', 10000),
    exit = code => process.exit(code), log = entry => console.log(JSON.stringify(entry)) } = {}) {
    let shuttingDown;
    // Connections busy when close() starts can become idle afterward. Reap
    // them after each response finishes rather than waiting for keep-alive.
    server.on?.('request', (_req, res) => res.once('finish', () => {
        if (shuttingDown) setImmediate(() => server.closeIdleConnections?.());
    }));
    return function shutdown(signal = 'SIGTERM') {
        if (shuttingDown) return shuttingDown;
        shuttingDown = (async () => {
            log({ event: 'api_shutdown', phase: 'draining', signal });
            const closed = new Promise(resolve => server.close(resolve));
            server.closeIdleConnections?.();
            const maintenance = Promise.resolve().then(stopMaintenance);
            const drained = await beforeDeadline(Promise.all([closed, maintenance, drainWork()]), drainMs);
            if (!drained) {
                log({ event: 'api_shutdown', phase: 'deadline' });
                server.closeAllConnections?.();
            }
            // Socket closure may enqueue reversals; drain them before pools.
            const cleaned = await beforeDeadline((async () => {
                await Promise.all([maintenance, drainWork()]);
                await closeResources();
            })(), cleanupMs);
            log({ event: 'api_shutdown', phase: 'stopped', drained, cleaned });
            exit(drained && cleaned && signal !== 'listen_error' ? 0 : 1);
        })().catch(() => {
            log({ event: 'api_shutdown', phase: 'failed' });
            server.closeAllConnections?.();
            exit(1);
        });
        return shuttingDown;
    };
}
module.exports = { createShutdown };
