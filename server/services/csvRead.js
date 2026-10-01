const fs = require('node:fs');
const { Readable } = require('node:stream');

function decodeUtf16(decoder, bytes, options) {
    try {
        return decoder.decode(bytes, options);
    } catch (cause) {
        const error = new Error('CSV has invalid or incomplete UTF-16 data', { cause });
        error.code = 'CSV_ENCODING';
        throw error;
    }
}

function decodeCsvSample(bytes, encoding, complete) {
    if (encoding !== 'utf16le' && encoding !== 'utf16be') return bytes.toString(encoding);
    const decoder = new TextDecoder(encoding === 'utf16le' ? 'utf-16le' : 'utf-16be', { fatal: true });
    return decodeUtf16(decoder, bytes, { stream: !complete });
}

// Decode marked UTF-16 streams incrementally: a byte, code unit or surrogate
// pair can span file chunks. I/O errors retain their infrastructure error code.
function createCsvReadStream(filePath, encoding, options = {}) {
    if (encoding !== 'utf16le' && encoding !== 'utf16be') {
        return fs.createReadStream(filePath, { ...options, encoding });
    }
    return Readable.from((async function* () {
        const input = fs.createReadStream(filePath, options);
        const decoder = new TextDecoder(encoding === 'utf16le' ? 'utf-16le' : 'utf-16be', { fatal: true });
        try {
            for await (const bytes of input) {
                const text = decodeUtf16(decoder, bytes, { stream: true });
                if (text) yield text;
            }
            const tail = decodeUtf16(decoder);
            if (tail) yield tail;
        } finally {
            input.destroy();
        }
    })(), { objectMode: false });
}

module.exports = { createCsvReadStream, decodeCsvSample };
