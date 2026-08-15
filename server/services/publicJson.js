const { openValidatedResponse } = require('./csvDownload');

function publicJsonError(message, code = 'UPSTREAM_JSON') {
    const err = new Error(message);
    err.code = code;
    return err;
}

async function readResponse(response, maxBytes) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
            response.destroy();
            throw publicJsonError('upstream JSON exceeded the response limit', 'UPSTREAM_JSON_CAP');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes);
}

async function fetchPublicBuffer(url, {
    timeoutMs = 30_000,
    maxBytes = 25 * 1024 * 1024,
    maxRetries = 1,
    userAgent = process.env.CKAN_USER_AGENT || 'canquery/1.0',
    lookupImpl,
    requestImpl
} = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('upstream JSON timed out')), timeoutMs);
        try {
            const { response } = await openValidatedResponse(url, {
                signal: controller.signal,
                userAgent,
                lookupImpl,
                requestImpl,
                maxRedirects: 5
            });
            const status = Number(response.statusCode);
            if (status === 429 || status >= 500) {
                response.destroy();
                throw publicJsonError('upstream JSON returned ' + status, 'UPSTREAM_JSON_RETRY');
            }
            if (status < 200 || status >= 300) {
                response.destroy();
                throw publicJsonError('upstream JSON returned ' + status, 'UPSTREAM_JSON_STATUS');
            }
            return await readResponse(response, maxBytes);
        } catch (err) {
            lastError = err;
            if (attempt >= maxRetries || !['UPSTREAM_JSON_RETRY'].includes(err && err.code)) throw err;
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError;
}

async function fetchPublicJson(url, options = {}) {
    const buffer = await fetchPublicBuffer(url, options);
    try {
        return JSON.parse(buffer.toString('utf8'));
    } catch {
        throw publicJsonError('upstream returned invalid JSON', 'UPSTREAM_JSON_PARSE');
    }
}

module.exports = { fetchPublicJson, fetchPublicBuffer, publicJsonError };
