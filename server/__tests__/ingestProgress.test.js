const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
jest.mock('pg-copy-streams', () => ({ from: sql => ({ copySql: sql }) }));
const { createProgressReporter } = require('../services/ingestProgress');
const { downloadToTempFile } = require('../services/csvDownload');
const { loadCsvIntoStore } = require('../services/csvLoad');

describe('progress reporter', () => {
    test('writes the first report, every phase change and otherwise at most once per interval, merging fields', async () => {
        let clock = 1000;
        const writes = [];
        const settle = () => new Promise(resolve => setImmediate(resolve));
        const reporter = createProgressReporter(async progress => { writes.push(progress); }, { minIntervalMs: 1000, now: () => clock });
        expect(reporter.report({ phase: 'downloading', bytes: 10, content_length: 100 })).toBe(true);
        await settle();
        clock += 200;
        expect(reporter.report({ phase: 'downloading', bytes: 20, content_length: 100 })).toBe(false);
        clock += 900;
        expect(reporter.report({ phase: 'downloading', bytes: 60, content_length: 100 })).toBe(true);
        await settle();
        clock += 10;
        expect(reporter.report({ phase: 'loading', rows: 0 })).toBe(true);
        expect(reporter.report({ phase: 'teleporting' })).toBe(false);
        await settle();
        expect(writes.map(w => [w.phase, w.bytes, w.rows, w.updated_at])).toEqual([
            ['downloading', 10, undefined, new Date(1000).toISOString()],
            ['downloading', 60, undefined, new Date(2100).toISOString()],
            ['loading', 60, 0, new Date(2110).toISOString()]
        ]);
        expect(reporter.last().content_length).toBe(100);
    });

    test('reports made while a write is in flight are coalesced into the latest one', async () => {
        let release;
        const writes = [];
        const reporter = createProgressReporter(progress => new Promise(resolve => { writes.push(progress); release = resolve; }), { minIntervalMs: 0 });
        reporter.report({ phase: 'downloading', bytes: 1 });
        reporter.report({ phase: 'downloading', bytes: 2 });
        reporter.report({ phase: 'loading', rows: 5 });
        release();
        await new Promise(resolve => setImmediate(resolve));
        expect(writes.map(w => [w.phase, w.bytes, w.rows])).toEqual([['downloading', 1, undefined], ['loading', 2, 5]]);
    });

    test('a failing write is swallowed and later reports still go through', async () => {
        const write = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
        const reporter = createProgressReporter(write, { minIntervalMs: 0 });
        reporter.report({ phase: 'downloading', bytes: 1 });
        await new Promise(resolve => setImmediate(resolve));
        reporter.report({ phase: 'loading', rows: 1 });
        await new Promise(resolve => setImmediate(resolve));
        expect(write).toHaveBeenCalledTimes(2);
    });
});

describe('progress callbacks', () => {
    let directory;
    beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canquery-progress-')); });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

    test('the download reports received bytes against the declared length and the final size', async () => {
        const body = Buffer.from('a,b\n1,2\n3,4\n');
        const fetchImpl = jest.fn(async () => ({
            status: 200,
            headers: { get: name => (name.toLowerCase() === 'content-length' ? String(body.length) : null) },
            body: new ReadableStream({ start(controller) { controller.enqueue(body.subarray(0, 5)); controller.enqueue(body.subarray(5)); controller.close(); } })
        }));
        const onProgress = jest.fn();
        const { filePath, bytes } = await downloadToTempFile('https://example.org/file.csv', { maxFileBytes: 1024, fetchImpl, onProgress });
        await fs.unlink(filePath);
        expect(bytes).toBe(body.length);
        expect(onProgress.mock.calls).toEqual([[5, body.length], [body.length, body.length], [body.length, body.length]]);
    });

    test('the loader reports the row count when the copy finishes', async () => {
        const filePath = path.join(directory, 'data.csv');
        await fs.writeFile(filePath, 'a,b\n' + Array.from({ length: 7 }, (_, i) => i + ',x').join('\n') + '\n');
        const client = { query: jest.fn(sql => sql.copySql
            ? new Writable({ write(chunk, encoding, callback) { callback(); } })
            : Promise.resolve({ rows: [{}] })) };
        const onRows = jest.fn();
        const { rowCount } = await loadCsvIntoStore(client, { filePath, tableName: 'r_t', delimiter: ',', encoding: 'utf8', maxRows: 100, maxCols: 10, onRows });
        expect(rowCount).toBe(7);
        expect(onRows).toHaveBeenLastCalledWith(7, 1);
    });

    test.each(['utf8', 'utf16le'])('the loader reports the share of a %s file read as rows load, and finishing before the type checks', async encoding => {
        const filePath = path.join(directory, 'large-' + encoding + '.csv');
        const text = 'a,b\n' + Array.from({ length: 12000 }, (_, i) => i + ',' + 'x'.repeat(40)).join('\n') + '\n';
        await fs.writeFile(filePath, encoding === 'utf16le' ? Buffer.from('\uFEFF' + text, 'utf16le') : text);
        const events = [];
        const client = { query: jest.fn(sql => {
            if (sql.copySql) return new Writable({ write(chunk, chunkEncoding, callback) { callback(); } });
            events.push(String(sql).split(' ').slice(0, 2).join(' '));
            return Promise.resolve({ rows: [{ cast_0: true }] });
        }) };
        const onRows = jest.fn();
        const onCopied = jest.fn(rows => events.push('copied ' + rows));
        const { rowCount } = await loadCsvIntoStore(client, { filePath, tableName: 'r_t', delimiter: ',', encoding, maxRows: 100000, maxCols: 10, onRows, onCopied });
        expect(rowCount).toBe(12000);
        const fractions = onRows.mock.calls.map(([rows, fraction]) => [rows, fraction]);
        expect(fractions.map(([rows]) => rows)).toEqual([5000, 10000, 12000]);
        expect(fractions[0][1]).toBeGreaterThan(0);
        expect(fractions[0][1]).toBeLessThan(fractions[1][1]);
        expect(fractions[1][1]).toBeLessThanOrEqual(1);
        expect(fractions[2][1]).toBe(1);
        expect(onCopied).toHaveBeenCalledTimes(1);
        const copiedAt = events.indexOf('copied 12000');
        expect(copiedAt).toBeGreaterThan(-1);
        expect(events.slice(copiedAt + 1)).toEqual(['SELECT coalesce(bool_and(pg_input_is_valid(nullif("a",', 'ALTER TABLE', 'CREATE UNIQUE']);
    });
});
