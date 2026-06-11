// Ported from <other-project>'s pipeline scripts: retry 429 and 5xx with
// exponential backoff and a hard per-request timeout. Network errors retry
// on the same schedule; non-429 4xx responses return to the caller.
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithBackoff(url, options = {}, attempt = 0) {
    const {
        headers = {},
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES
    } = options;
    try {
        const res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (res.status === 429) {
            if (attempt >= maxRetries) throw new Error('Max retries on 429');
            const delay = Math.min(120_000, 5000 * 2 ** attempt);
            console.log(`  [429] backing off ${delay}ms`);
            await sleep(delay);
            return fetchWithBackoff(url, options, attempt + 1);
        }
        if (!res.ok && res.status >= 500) {
            if (attempt >= maxRetries) throw new Error(`5xx after retries: ${res.status}`);
            await sleep(2000 * 2 ** attempt);
            return fetchWithBackoff(url, options, attempt + 1);
        }
        return res;
    } catch (err) {
        if (attempt >= maxRetries) throw err;
        console.log(`  [retry] ${err.message}`);
        await sleep(2000 * 2 ** attempt);
        return fetchWithBackoff(url, options, attempt + 1);
    }
}

module.exports = { fetchWithBackoff, sleep };
