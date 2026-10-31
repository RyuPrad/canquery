const { runSampler, sampleOrigin, classifyFailure, nextCheck, createHostGate, SampleFailure } = require('../services/rowSampler');
const { resourceVersion } = require('../services/resourceVersion');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-31T12:00:00Z');
const settings = { batch: 50, concurrency: 1, hostGapMs: 3000, hostMax: 10, headBytes: 65536, timeoutMs: 10000,
    runMs: 600000, refreshDays: 14, sweep: 500 };
const csv = (id, host = 'files.example.test', extra = {}) => ({ id, format: 'CSV', url: 'https://' + host + '/' + id + '.csv',
    datastore_active: false, size_bytes: 1000, raw: {}, ...extra });
const live = (id, extra = {}) => ({ id, format: 'CSV', url: 'https://example.test/' + id + '.csv', datastore_active: true,
    raw: { source_id: 'open-canada' }, ...extra });
const sample = { fields: [{ id: 'a', label: 'a', type: 'TEXT' }], records: [['1']], columns_total: 1, upstream_total: null };

function harness({ shown = [], due = [], swept = [], readers, progress = {} } = {}) {
    let clock = NOW.getTime();
    const saved = [];
    const writes = [];
    const waits = [];
    const deps = {
        readProgress: async () => progress,
        writeProgress: async value => { writes.push(value); },
        listShown: async () => shown,
        listDue: async () => due,
        listSweep: jest.fn(async () => swept),
        saveSample: async result => { saved.push(result); },
        readers: readers || { file: jest.fn(async () => ({ sample, bytesRead: 512 })), datastore: jest.fn(async () => ({ sample, bytesRead: null })) },
        clock: () => clock,
        wait: async ms => { waits.push(ms); clock += ms; }
    };
    return { deps, saved, writes, waits };
}

describe('row sampler classification', () => {
    test('samples live tables and preparable CSV files only', () => {
        expect(sampleOrigin(live('a'))).toBe('datastore');
        expect(sampleOrigin(csv('b'))).toBe('file');
        expect(sampleOrigin(csv('c', 'x.test', { format: 'XLSX', url: 'https://x.test/c.xlsx' }))).toBeNull();
        expect(sampleOrigin(csv('d', 'x.test', { ingest_status: 'ready' }))).toBeNull();
        expect(sampleOrigin(csv('e', 'x.test', { url: 'https://x.test/e.zip' }))).toBeNull();
        expect(sampleOrigin({ id: 'f', format: 'PDF', url: 'https://x.test/f.pdf' })).toBeNull();
    });

    test('names each failure and keeps a host\'s Retry-After', () => {
        expect(classifyFailure(Object.assign(new Error('x'), { httpStatus: 429, retryAfterMs: 120000 })))
            .toMatchObject({ status: 'failed', code: 'rate_limited', retryAfterMs: 120000 });
        expect(classifyFailure(Object.assign(new Error('x'), { upstreamStatus: 429 }))).toMatchObject({ code: 'rate_limited', retryAfterMs: null });
        expect(classifyFailure(Object.assign(new Error('x'), { httpStatus: 404 }))).toMatchObject({ status: 'failed', code: 'gone' });
        expect(classifyFailure(Object.assign(new Error('x'), { upstreamStatus: 503 }))).toMatchObject({ code: 'upstream_http' });
        expect(classifyFailure(Object.assign(new Error('x'), { code: 'DOWNLOAD_URL_BLOCKED' }))).toMatchObject({ status: 'unsupported', code: 'blocked' });
        expect(classifyFailure(Object.assign(new Error('x'), { code: 'DOWNLOAD_RESPONSE_STALL' }))).toMatchObject({ code: 'timeout' });
        expect(classifyFailure(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toMatchObject({ code: 'timeout' });
        expect(classifyFailure(new Error('boom'))).toMatchObject({ status: 'failed', code: 'error' });
        const known = new SampleFailure('unsupported', 'not_a_table');
        expect(classifyFailure(known)).toBe(known);
    });

    test('schedules the next look: refresh, unsupported, backoff and rate limits', () => {
        const at = result => (nextCheck(result, { now: NOW, refreshDays: 14 }).getTime() - NOW.getTime()) / DAY;
        expect(at({ status: 'ok' })).toBe(14);
        expect(at({ status: 'unsupported' })).toBe(30);
        expect([1, 2, 3, 4, 5, 6, 9].map(attempts => at({ status: 'failed', failureCode: 'timeout', attempts }))).toEqual([1, 2, 4, 8, 16, 30, 30]);
        expect(at({ status: 'failed', failureCode: 'rate_limited', retryAfterMs: 1000 })).toBeCloseTo(1 / 24);
        expect(at({ status: 'failed', failureCode: 'rate_limited', retryAfterMs: 30 * DAY })).toBe(7);
        expect(at({ status: 'failed', failureCode: 'rate_limited', retryAfterMs: null })).toBe(1);
    });
});

describe('host gate', () => {
    test('spaces two reads of one host, caps a host per run and honours cooldowns', async () => {
        let clock = 0;
        const waits = [];
        const gate = createHostGate({ gapMs: 3000, maxPerHost: 2, cooldowns: new Map([['cool.test', 5000]]), clock: () => clock,
            wait: async ms => { waits.push(ms); clock += ms; } });
        expect(await gate.take('a.test')).toBe(true);
        expect(await gate.take('b.test')).toBe(true);
        expect(await gate.take('a.test')).toBe(true);
        expect(waits).toEqual([3000]);
        expect(await gate.take('a.test')).toBe(false);
        expect(await gate.take('cool.test')).toBe(false);
        clock = 6000;
        expect(await gate.take('cool.test')).toBe(true);
        gate.coolDown('b.test', clock + 60000);
        expect(await gate.take('b.test')).toBe(false);
    });
});

describe('row sampler runs', () => {
    test('takes Search Console pages first, then due samples, then the sweep, once each', async () => {
        const a = csv('a'); const b = csv('b', 'other.test'); const c = live('c');
        const fresh = { ...csv('fresh'), sample_checked_version: resourceVersion(csv('fresh')),
            sample_next_check_at: new Date(NOW.getTime() + DAY).toISOString() };
        const { deps, saved, writes } = harness({ shown: [a, fresh], due: [b, a], swept: [c, csv('x', 'x.test', { format: 'XLSX', url: 'https://x.test/x.xlsx' })] });
        const summary = await runSampler({ settings, now: NOW, deps });
        expect(saved.map(result => [result.resourceId, result.origin, result.status])).toEqual([
            ['a', 'file', 'ok'], ['b', 'file', 'ok'], ['c', 'datastore', 'ok']]);
        expect(saved[0]).toMatchObject({ version: resourceVersion(a), attempts: 0, bytesRead: 512 });
        expect(saved[0].nextCheckAt.getTime()).toBe(NOW.getTime() + 14 * DAY);
        expect(summary).toMatchObject({ candidates: 3, ok: 3, failed: 0, by_origin: { file: 2, datastore: 1 } });
        expect(writes).toEqual([{ cursor: '', cooldowns: {} }]);
    });

    test('reads a sample again when its resource changed version', async () => {
        const changed = { ...csv('a'), sample_checked_version: 'old', sample_next_check_at: new Date(NOW.getTime() + DAY).toISOString() };
        const { deps, saved } = harness({ shown: [changed] });
        await runSampler({ settings, now: NOW, deps });
        expect(saved.map(result => result.resourceId)).toEqual(['a']);
    });

    test('stops at the batch and continues the sweep after the last row it took', async () => {
        const swept = ['a', 'b', 'c', 'd'].map(id => csv(id, id + '.test'));
        const { deps, saved, writes } = harness({ swept });
        await runSampler({ settings: { ...settings, sweep: 4 }, limit: 2, now: NOW, deps });
        expect(saved.map(result => result.resourceId)).toEqual(['a', 'b']);
        expect(writes[0].cursor).toBe('b');
        const full = harness({ swept, progress: { cursor: 'b' } });
        await runSampler({ settings: { ...settings, sweep: 4 }, limit: 10, now: NOW, deps: full.deps });
        expect(full.deps.listSweep).toHaveBeenCalledWith({ after: 'b', limit: 4 });
        expect(full.writes[0].cursor).toBe('d');
        const end = harness({ swept: swept.slice(0, 3) });
        await runSampler({ settings: { ...settings, sweep: 4 }, limit: 10, now: NOW, deps: end.deps });
        expect(end.writes[0].cursor).toBe('');
    });

    test('a dry run lists the batch and reads or writes nothing', async () => {
        const { deps, saved, writes } = harness({ shown: [csv('a'), live('b')] });
        const summary = await runSampler({ dryRun: true, settings, now: NOW, deps });
        expect(summary).toMatchObject({ candidates: 2, sample: ['a', 'b'], by_origin: { file: 1, datastore: 1 } });
        expect(saved).toEqual([]);
        expect(writes).toEqual([]);
        expect(deps.readers.file).not.toHaveBeenCalled();
    });

    test('leaves a host alone after a 429 and remembers it for later runs', async () => {
        const readers = {
            file: jest.fn(async row => {
                if (row.id === 'a') throw Object.assign(new Error('busy'), { httpStatus: 429, retryAfterMs: 2 * 60 * 60 * 1000 });
                return { sample, bytesRead: 1 };
            }),
            datastore: jest.fn()
        };
        const { deps, saved, writes } = harness({ shown: [csv('a', 'busy.test'), csv('b', 'busy.test'), csv('c', 'calm.test')], readers });
        const summary = await runSampler({ settings, now: NOW, deps });
        expect(saved.map(result => [result.resourceId, result.status, result.failureCode || null])).toEqual([
            ['a', 'failed', 'rate_limited'], ['c', 'ok', null]]);
        expect(saved[0].attempts).toBe(1);
        expect(summary.skipped_hosts).toBe(1);
        expect(Object.keys(writes[0].cooldowns)).toEqual(['busy.test']);
        const later = harness({ shown: [csv('b', 'busy.test')], progress: { cooldowns: writes[0].cooldowns } });
        await runSampler({ settings, now: NOW, deps: later.deps });
        expect(later.saved).toEqual([]);
    });

    test('counts an empty table as unsupported and a failure as one more attempt', async () => {
        const readers = { file: jest.fn(async () => ({ sample: null })), datastore: jest.fn(async () => { throw new Error('boom'); }) };
        const { deps, saved } = harness({ shown: [csv('a'), live('b', { sample_attempts: 2, sample_checked_version: 'old' })], readers });
        await runSampler({ settings, now: NOW, deps });
        expect(saved.map(result => [result.resourceId, result.status, result.failureCode, result.attempts])).toEqual([
            ['a', 'unsupported', 'empty', 1], ['b', 'failed', 'error', 3]]);
        expect(saved[1].nextCheckAt.getTime()).toBe(NOW.getTime() + 4 * DAY);
    });
});
