const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const zlib = require('node:zlib');

const MAX_REDIRECTS = 5;

// Treat "public" conservatively. These ranges are either locally scoped,
// special-purpose, documentation-only, multicast, or can embed a non-public
// IPv4 destination. A catalogue download never has a legitimate reason to use
// any of them.
const blockedAddresses = new net.BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
]) {
    blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
    ['::', 96],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
    ['5f00::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8]
]) {
    blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

function downloadError(message, code = 'DOWNLOAD_URL_BLOCKED') {
    const err = new Error(message);
    err.code = code;
    return err;
}

function validateDownloadUrl(value) {
    let url;
    try {
        url = value instanceof URL ? new URL(value.href) : new URL(value);
    } catch {
        throw downloadError('download URL is invalid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw downloadError('download URL must use http or https');
    }
    if (url.username || url.password) {
        throw downloadError('download URL credentials are not allowed');
    }
    // URL normalizes an explicitly supplied default port to an empty string.
    // Anything left here is a non-default port and is rejected.
    if (url.port) {
        throw downloadError('download URL uses a disallowed port');
    }
    if (!url.hostname) {
        throw downloadError('download URL has no hostname');
    }
    return url;
}

function isPublicAddress(address, family = net.isIP(address)) {
    const normalizedFamily = family === 4 || family === 'IPv4' || family === 'ipv4' ? 4
        : family === 6 || family === 'IPv6' || family === 'ipv6' ? 6
            : net.isIP(address);
    if (normalizedFamily !== 4 && normalizedFamily !== 6) return false;
    // BlockList represents IPv4 entries internally as IPv4-mapped IPv6. Adding
    // ::ffff:0:0/96 to the list would therefore match every ordinary IPv4
    // address too, so reject mapped literals explicitly instead.
    if (normalizedFamily === 6 && /^(?:::ffff:|0:0:0:0:0:ffff:)/i.test(address)) return false;
    try {
        return !blockedAddresses.check(address, normalizedFamily === 4 ? 'ipv4' : 'ipv6');
    } catch {
        return false;
    }
}

async function resolvePublicTarget(hostname, lookupImpl = dns.lookup) {
    const lookupHostname = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
    const literalFamily = net.isIP(lookupHostname);
    const records = literalFamily
        ? [{ address: lookupHostname, family: literalFamily }]
        : await lookupImpl(lookupHostname, { all: true, verbatim: true });

    if (!Array.isArray(records) || records.length === 0) {
        throw downloadError('download hostname did not resolve');
    }
    const normalized = records.map((record) => ({
        address: record.address,
        family: record.family === 4 || record.family === 'IPv4' ? 4 : 6
    }));
    if (normalized.some(record => !isPublicAddress(record.address, record.family))) {
        throw downloadError('download hostname resolves to a non-public address');
    }
    // Prefer IPv4 when both families are public. Many catalogue hosts publish
    // AAAA records even though a particular worker host has no IPv6 route.
    return normalized.find(record => record.family === 4) || normalized[0];
}

function withAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason || new Error('download aborted'));
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(signal.reason || new Error('download aborted'));
        };
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(
            value => { cleanup(); resolve(value); },
            err => { cleanup(); reject(err); }
        );
    });
}

function requestPinned(url, target, { signal, userAgent, requestImpl } = {}) {
    const requester = requestImpl || (url.protocol === 'https:' ? https.request : http.request);
    return new Promise((resolve, reject) => {
        const lookup = (hostname, options, callback) => {
            if (options && options.all) {
                callback(null, [{ address: target.address, family: target.family }]);
                return;
            }
            callback(null, target.address, target.family);
        };
        const req = requester(url, {
            method: 'GET',
            agent: false,
            family: target.family,
            lookup,
            signal,
            servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
            headers: {
                Accept: '*/*',
                'Accept-Encoding': 'identity',
                'User-Agent': userAgent || 'canquery/1.0'
            }
        }, resolve);
        req.once('error', reject);
        req.end();
    });
}

function responseHeader(response, name) {
    if (response.headers && typeof response.headers.get === 'function') {
        return response.headers.get(name);
    }
    const value = response.headers && response.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function destroyResponse(response) {
    if (response && typeof response.destroy === 'function') response.destroy();
    else if (response && response.body && typeof response.body.cancel === 'function') {
        response.body.cancel().catch(() => {});
    }
}

async function openValidatedResponse(initialUrl, {
    signal,
    userAgent,
    lookupImpl,
    requestImpl,
    maxRedirects = MAX_REDIRECTS
} = {}) {
    let url = validateDownloadUrl(initialUrl);
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
        // dns.lookup has no AbortSignal option. Race it with the download's
        // inactivity controller so a wedged resolver cannot strand the worker.
        const target = await withAbort(resolvePublicTarget(url.hostname, lookupImpl), signal);
        const response = await requestPinned(url, target, { signal, userAgent, requestImpl });
        const status = Number(response.statusCode);
        if (![301, 302, 303, 307, 308].includes(status)) {
            return { response, url };
        }
        const location = responseHeader(response, 'location');
        destroyResponse(response);
        if (!location) throw downloadError('download redirect has no location', 'DOWNLOAD_REDIRECT');
        if (redirects === maxRedirects) {
            throw downloadError('download exceeded redirect limit', 'DOWNLOAD_REDIRECT');
        }
        try {
            url = validateDownloadUrl(new URL(location, url));
        } catch (err) {
            if (err && err.code) throw err;
            throw downloadError('download redirect URL is invalid', 'DOWNLOAD_REDIRECT');
        }
    }
    throw downloadError('download exceeded redirect limit', 'DOWNLOAD_REDIRECT');
}

// Test seam for deterministic stream/cap tests. Production never supplies a
// fetch implementation; URL and redirect validation still stays active here so
// the seam cannot accidentally regress those invariants.
async function openInjectedResponse(initialUrl, fetchImpl, {
    signal,
    userAgent,
    maxRedirects = MAX_REDIRECTS
} = {}) {
    let url = validateDownloadUrl(initialUrl);
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
        const response = await fetchImpl(url.href, {
            redirect: 'manual',
            signal,
            headers: {
                Accept: '*/*',
                'Accept-Encoding': 'identity',
                'User-Agent': userAgent || 'canquery/1.0'
            }
        });
        const status = Number(response.status);
        if (![301, 302, 303, 307, 308].includes(status)) return { response, url };
        const location = responseHeader(response, 'location');
        destroyResponse(response);
        if (!location) throw downloadError('download redirect has no location', 'DOWNLOAD_REDIRECT');
        if (redirects === maxRedirects) {
            throw downloadError('download exceeded redirect limit', 'DOWNLOAD_REDIRECT');
        }
        url = validateDownloadUrl(new URL(location, url));
    }
    throw downloadError('download exceeded redirect limit', 'DOWNLOAD_REDIRECT');
}

function decodedResponseBody(response) {
    const encoding = String(responseHeader(response, 'content-encoding') || 'identity').trim().toLowerCase();
    if (encoding === '' || encoding === 'identity') return response;
    if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(zlib.createGunzip());
    if (encoding === 'deflate') return response.pipe(zlib.createInflate());
    if (encoding === 'br') return response.pipe(zlib.createBrotliDecompress());
    destroyResponse(response);
    throw downloadError('download uses unsupported content encoding', 'DOWNLOAD_ENCODING');
}

async function *chunksFromBody(body) {
    if (body && typeof body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of body) yield chunk;
        return;
    }
    if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    }
    throw downloadError('download response body is not readable', 'DOWNLOAD_BODY');
}

// Wraps a writable stream so the single ingest worker can never be taken down by
// an unhandled 'error'. Two failure modes did exactly that:
//   - a write-side ENOSPC (the tmpfs fills) emits 'error', and a plain
//     `once('drain')` would then hang forever (drain never comes);
//   - destroying the stream on the cap/stall path while a write is still in
//     flight makes the late fs callback throw ERR_STREAM_DESTROYED, which with
//     no 'error' listener crashes the process (this is what wedged job 10).
// A persistent listener captures the error; write()/end() re-throw it so the
// caller's try/catch cleans up, and backpressure waits wake on 'error' too.
function makeSafeWriter(ws) {
    let error = null;
    ws.on('error', (err) => { if (!error) error = err; });
    return {
        async write(chunk) {
            if (error) throw error;
            if (!ws.write(chunk)) {
                await new Promise((resolve) => {
                    const settle = () => {
                        ws.removeListener('drain', settle);
                        ws.removeListener('error', settle);
                        resolve();
                    };
                    ws.once('drain', settle);
                    ws.once('error', settle);
                });
                if (error) throw error;
            }
        },
        async end() {
            if (error) throw error;
            await new Promise((resolve, reject) => {
                ws.once('error', reject);
                ws.end(resolve);
            });
        }
    };
}

async function downloadToTempFile(url, {
    maxFileBytes,
    fetchImpl,
    userAgent,
    stallTimeoutMs,
    lookupImpl,
    requestImpl,
    maxRedirects
} = {}) {
    const stallMs = Number(stallTimeoutMs) > 0 ? Number(stallTimeoutMs) : 60000;
    const filePath = path.join(os.tmpdir(), 'canquery-ingest-' + crypto.randomUUID() + '.csv');
    const controller = new AbortController();

    // Inactivity guard. Every other outbound fetch goes through
    // fetchWithBackoff's hard timeout, but this raw download had none, so a
    // stalled upstream (one that accepts the socket and never replies, or dies
    // mid-stream) wedged the single ingest worker forever. Abort if no progress
    // is made within stallMs - armed before the response so a server that never
    // replies is covered, and reset on each chunk so a slow-but-advancing large
    // download is not killed.
    let stalled = false;
    let timer = null;
    const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs);
    };
    const disarm = () => { if (timer) { clearTimeout(timer); timer = null; } };

    arm();
    let res;
    const injectedFetch = Boolean(fetchImpl);
    try {
        const opened = fetchImpl
            ? await openInjectedResponse(url, fetchImpl, {
                signal: controller.signal,
                userAgent,
                maxRedirects
            })
            : await openValidatedResponse(url, {
                signal: controller.signal,
                userAgent,
                lookupImpl,
                requestImpl,
                maxRedirects
            });
        res = opened.response;
    } catch (err) {
        disarm();
        if (stalled) throw new Error('download stalled (no response within ' + stallMs + 'ms)', { cause: err });
        throw err;
    }
    const status = Number(injectedFetch ? res.status : res.statusCode);
    const responseBody = injectedFetch ? res.body : res;
    if (status < 200 || status >= 300 || !responseBody) {
        disarm();
        destroyResponse(res);
        throw new Error('download failed: HTTP ' + status);
    }
    const contentLength = Number(responseHeader(res, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxFileBytes) {
        disarm();
        controller.abort();
        destroyResponse(res);
        const err = new Error('file exceeds size cap (' + maxFileBytes + ' bytes)');
        err.code = 'CAP_FILE';
        throw err;
    }
    const ws = fs.createWriteStream(filePath);
    const writer = makeSafeWriter(ws);
    try {
        const body = injectedFetch ? responseBody : decodedResponseBody(res);
        let bytes = 0;
        for await (const value of chunksFromBody(body)) {
            arm();
            bytes += value.length;
            if (bytes > maxFileBytes) {
                controller.abort();
                destroyResponse(res);
                const err = new Error('file exceeds size cap (' + maxFileBytes + ' bytes)');
                err.code = 'CAP_FILE';
                throw err;
            }
            await writer.write(Buffer.from(value));
        }
        disarm();
        await writer.end();
        return { filePath, bytes };
    } catch (err) {
        disarm();
        controller.abort();
        destroyResponse(res);
        // ws carries a persistent 'error' listener (makeSafeWriter), so
        // destroying it with a write still in flight no longer crashes the
        // worker. Wait for full close before unlinking: the lazy open() can
        // otherwise recreate the file *after* the unlink ran.
        await new Promise((resolve) => {
            ws.once('close', resolve);
            ws.destroy();
        });
        try {
            await fs.promises.unlink(filePath);
        } catch {
            // ignore
        }
        if (stalled && err && err.code !== 'CAP_FILE') {
            throw new Error('download stalled (no data within ' + stallMs + 'ms)', { cause: err });
        }
        throw err;
    }
}

async function sniffCsvMeta(filePath) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(65536);
        const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
        let encoding = 'utf8';
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(
                buf.subarray(0, Math.max(0, bytesRead - 3))
            );
            encoding = 'utf8';
        } catch {
            encoding = 'latin1';
        }
        const slice = buf.subarray(0, bytesRead);
        let text = slice.toString(encoding);
        if (text.charCodeAt(0) === 0xFEFF) {
            text = text.slice(1);
        }
        const firstNewline = text.indexOf('\n');
        const firstLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
        let inQuotes = false;
        const counts = { ',': 0, ';': 0, '\t': 0 };
        for (const ch of firstLine) {
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (!inQuotes) {
                if (ch === ',') counts[',']++;
                else if (ch === ';') counts[';']++;
                else if (ch === '\t') counts['\t']++;
            }
        }
        let delimiter = ',';
        let maxCount = counts[','];
        if (counts[';'] > maxCount) {
            maxCount = counts[';'];
            delimiter = ';';
        }
        if (counts['\t'] > maxCount) {
            delimiter = '\t';
        }
        return { delimiter, encoding };
    } finally {
        await fd.close();
    }
}

module.exports = {
    downloadToTempFile,
    sniffCsvMeta,
    makeSafeWriter,
    validateDownloadUrl,
    isPublicAddress,
    resolvePublicTarget,
    openValidatedResponse
};
