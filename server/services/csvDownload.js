const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

async function downloadToTempFile(url, { maxFileBytes, fetchImpl, userAgent } = {}) {
    const doFetch = fetchImpl || fetch;
    const filePath = path.join(os.tmpdir(), 'opencanada-ingest-' + crypto.randomUUID() + '.csv');
    const controller = new AbortController();
    const res = await doFetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': userAgent || 'opencanada/1.0' }
    });
    if (!res.ok || !res.body) {
        throw new Error('download failed: HTTP ' + res.status);
    }
    const ws = fs.createWriteStream(filePath);
    try {
        const reader = res.body.getReader();
        let bytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            bytes += value.length;
            if (bytes > maxFileBytes) {
                controller.abort();
                const err = new Error('file exceeds size cap (' + maxFileBytes + ' bytes)');
                err.code = 'CAP_FILE';
                throw err;
            }
            if (!ws.write(Buffer.from(value))) {
                await new Promise((resolve) => ws.once('drain', resolve));
            }
        }
        await new Promise((resolve) => ws.end(resolve));
        return { filePath, bytes };
    } catch (err) {
        // Wait for the stream to fully close before unlinking: the lazy
        // open() can otherwise create the file *after* the unlink ran.
        await new Promise((resolve) => {
            ws.once('close', resolve);
            ws.destroy();
        });
        try {
            await fs.promises.unlink(filePath);
        } catch {
            // ignore
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

module.exports = { downloadToTempFile, sniffCsvMeta };
