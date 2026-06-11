const fs = require('node:fs');
const os = require('node:os');
const { ReadableStream } = require('node:stream/web');
const { downloadToTempFile } = require('../services/csvDownload');
const { inferType, inferColumns, sanitizeColumnName } = require('../utils/csvTypes');

function fakeFetch(chunks, onAbort) {
    return async (url, opts) => {
        if (opts.signal && onAbort) {
            opts.signal.addEventListener('abort', onAbort);
        }
        return {
            ok: true,
            status: 200,
            body: new ReadableStream({
                start(controller) {
                    for (const c of chunks) {
                        controller.enqueue(typeof c === 'string' ? new TextEncoder().encode(c) : c);
                    }
                    controller.close();
                }
            })
        };
    };
}

describe('ingestion caps', () => {
    it('oversize downloads are aborted mid-stream and cleaned up', async () => {
        const abortSpy = jest.fn();
        const chunks = [];
        for (let i = 0; i < 20; i += 1) {
            chunks.push('x'.repeat(1024));
        }
        const before = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('opencanada-ingest-')));
        let thrown;
        try {
            await downloadToTempFile('https://example.org/big.csv', {
                maxFileBytes: 5 * 1024,
                fetchImpl: fakeFetch(chunks, abortSpy)
            });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('CAP_FILE');
        expect(abortSpy).toHaveBeenCalled();
        const leftover = fs.readdirSync(os.tmpdir())
            .filter(f => f.startsWith('opencanada-ingest-') && !before.has(f));
        expect(leftover).toHaveLength(0);
    });

    it('small downloads land fully on disk', async () => {
        const { filePath, bytes } = await downloadToTempFile('https://example.org/ok.csv', {
            maxFileBytes: 1024 * 1024,
            fetchImpl: fakeFetch(['a,b\n1,2\n'])
        });
        expect(bytes).toBe(8);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('a,b\n1,2\n');
        fs.unlinkSync(filePath);
    });

    it('type inference picks the narrowest type', () => {
        expect(inferType(['1', '42', '-7'])).toBe('INTEGER');
        expect(inferType(['1.5', '2'])).toBe('NUMERIC');
        expect(inferType(['2024-01-02'])).toBe('DATE');
        expect(inferType(['2024-01-02T10:00:00Z'])).toBe('TIMESTAMPTZ');
        expect(inferType(['abc', '1'])).toBe('TEXT');
        expect(inferType([])).toBe('TEXT');
    });

    it('inferColumns sanitizes and dedupes headers', () => {
        const cols = inferColumns(['', 'a', 'a'], [['1', 'x', '2024-01-01']]);
        expect(cols[0].id).toBe('column_1');
        expect(cols[1].id).toBe('a');
        expect(cols[2].id).not.toBe('a');
        expect(cols[0].type).toBe('INTEGER');
    });

    it('sanitizeColumnName strips double quotes and caps length', () => {
        const used = new Set();
        const out = sanitizeColumnName('we"ird"name' + 'y'.repeat(100), 0, used);
        expect(out.includes('"')).toBe(false);
        expect(out.length).toBeLessThanOrEqual(63);
    });
});
