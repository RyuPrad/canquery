const { performance } = require('node:perf_hooks');
const { envNumber, numberSetting } = require('../config/numbers');

function createIngestDeadline(timeoutMs = envNumber('INGEST_DEADLINE_MS', 30 * 60_000,
    { min: 1, max: 2 ** 31 - 1, integer: true })) {
    numberSetting('INGEST_DEADLINE_MS', timeoutMs, undefined, { min: 1, max: 2 ** 31 - 1, integer: true });
    const controller = new AbortController();
    const expires = performance.now() + timeoutMs;
    const error = Object.assign(new Error('Preparation exceeded its processing deadline'), { code: 'INGEST_DEADLINE' });
    const timer = setTimeout(() => controller.abort(error), timeoutMs);
    timer.unref();
    return {
        signal: controller.signal,
        remainingMs() {
            if (performance.now() >= expires && !controller.signal.aborted) controller.abort(error);
            controller.signal.throwIfAborted();
            return Math.max(1, Math.ceil(expires - performance.now()));
        },
        dispose() { clearTimeout(timer); }
    };
}

// Cancel PostgreSQL work rather than abandoning its promise. The caller holds
// this client until cancellation settles, preventing cancellation of its next
// pool borrower. Rollback and connection cleanup use the original client.
function cancellableIngestClient(client, cancelDb, deadline) {
    let cancellation = null;
    let stopped = false;
    const cancel = () => {
        if (!stopped && !cancellation) {
            cancellation = cancelDb.query('SELECT pg_cancel_backend($1)', [client.processID]);
            cancellation.catch(() => {});
        }
    };
    deadline.signal.addEventListener('abort', cancel, { once: true });
    return {
        query(...args) {
            deadline.remainingMs();
            return client.query(...args);
        },
        async stop() {
            stopped = true;
            deadline.signal.removeEventListener('abort', cancel);
            if (cancellation) await cancellation;
        }
    };
}

module.exports = { createIngestDeadline, cancellableIngestClient };
