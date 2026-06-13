const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

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

async function downloadToTempFile(url, { maxFileBytes, fetchImpl, userAgent, stallTimeoutMs } = {}) {
    const doFetch = fetchImpl || fetch;
    const stallMs = Number(stallTimeoutMs) > 0 ? Number(stallTimeoutMs) : 60000;
    const filePath = path.join(os.tmpdir(), 'opencanada-ingest-' + crypto.randomUUID() + '.csv');
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
    try {
        res = await doFetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': userAgent || 'opencanada/1.0' }
        });
    } catch (err) {
        disarm();
        if (stalled) throw new Error('download stalled (no response within ' + stallMs + 'ms)', { cause: err });
        throw err;
    }
    if (!res.ok || !res.body) {
        disarm();
        throw new Error('download failed: HTTP ' + res.status);
    }
    const ws = fs.createWriteStream(filePath);
    const writer = makeSafeWriter(ws);
    try {
        const reader = res.body.getReader();
        let bytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            arm();
            bytes += value.length;
            if (bytes > maxFileBytes) {
                controller.abort();
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

module.exports = { downloadToTempFile, sniffCsvMeta, makeSafeWriter };
