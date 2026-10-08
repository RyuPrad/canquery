const { setTimeout: delay } = require('node:timers/promises');
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 4;

function sleep(ms, signal) {
    return delay(ms, undefined, { signal });
}

// One attempt budget covers network, 429 and 5xx failures. Retry responses are
// disposed before waiting; caller cancellation also interrupts backoff/body I/O.
async function fetchWithBackoff(url, options = {}, attempt = 0) {
    const { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = DEFAULT_MAX_RETRIES, signal } = options;
    for (let current = attempt; ; current++) {
        signal?.throwIfAborted();
        let response;
        try {
            const timeout = AbortSignal.timeout(timeoutMs);
            response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        } catch (error) {
            signal?.throwIfAborted();
            if (current >= maxRetries) throw error;
            await sleep(2000 * 2 ** current, signal);
            continue;
        }
        if (response.status !== 429 && response.status < 500) return response;
        await response.body?.cancel();
        if (current >= maxRetries) throw new Error('Upstream retry limit reached: ' + response.status);
        const wait = response.status === 429 ? Math.min(120000, 5000 * 2 ** current) : 2000 * 2 ** current;
        await sleep(wait, signal);
    }
}
module.exports = { fetchWithBackoff, sleep };
