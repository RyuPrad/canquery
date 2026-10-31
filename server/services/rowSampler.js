const { classifyResource } = require('./resourceCapabilities');
const { resourceVersion } = require('./resourceVersion');
const { datastoreTarget } = require('./queryService');
const { datastoreSearch } = require('./ckanClient');
const { downloadHead } = require('./csvDownload');
const { previewRecords } = require('./csvPreview');
const { fromDatastore, fromPreview, SAMPLE_ROWS } = require('./rowSamples');
const { toAbsoluteUrl } = require('../utils/resolveUrl');

// Reads the first rows of live DataStore tables and CSV files for the resource
// pages (services/rowSamples.js), politely: a run takes a bounded batch, at most
// two reads at a time, a gap between two reads of one host and a cap per host,
// and a host that answers 429 or Retry-After is left alone until it asks.
// Successful samples are rechecked after ROW_SAMPLE_REFRESH_DAYS, failures back
// off, and a resource whose version changes is read again.
const DAY_MS = 24 * 60 * 60 * 1000;

function integerSetting(name, fallback, min, max) {
    const raw = process.env[name];
    if (raw == null || String(raw).trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(name + ' must be an integer from ' + min + ' to ' + max);
    }
    return value;
}

function samplerSettings() {
    return {
        batch: integerSetting('ROW_SAMPLE_BATCH', 50, 1, 500),
        concurrency: integerSetting('ROW_SAMPLE_CONCURRENCY', 2, 1, 4),
        hostGapMs: integerSetting('ROW_SAMPLE_HOST_GAP_MS', 3000, 0, 60000),
        hostMax: integerSetting('ROW_SAMPLE_HOST_MAX', 10, 1, 500),
        headBytes: integerSetting('ROW_SAMPLE_HEAD_BYTES', 65536, 4096, 262144),
        timeoutMs: integerSetting('ROW_SAMPLE_TIMEOUT_MS', 10000, 1000, 30000),
        runMs: integerSetting('ROW_SAMPLE_RUN_MS', 600000, 10000, 3600000),
        refreshDays: integerSetting('ROW_SAMPLE_REFRESH_DAYS', 14, 1, 365),
        sweep: integerSetting('ROW_SAMPLE_SWEEP', 500, 1, 5000)
    };
}

// A live table, the start of a CSV file, or nothing (prepared copies already
// show their rows; Excel files cannot be read from their first bytes).
function sampleOrigin(row) {
    const capability = classifyResource(row).capability;
    if (capability === 'datastore') return 'datastore';
    if (capability === 'ingestable' && String(row.format || '').toUpperCase() === 'CSV') return 'file';
    return null;
}

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function sampleHost(row, origin) {
    if (origin === 'file') return hostOf(toAbsoluteUrl(row.url));
    const target = datastoreTarget(row);
    return hostOf(target.baseUrl || process.env.CKAN_BASE_URL || 'https://open.canada.ca/data/api/3/action');
}

class SampleFailure extends Error {
    constructor(status, code, cause, retryAfterMs = null) {
        super(code);
        this.status = status;
        this.code = code;
        this.cause = cause;
        this.retryAfterMs = retryAfterMs;
    }
}

function classifyFailure(error) {
    if (error instanceof SampleFailure) return error;
    const status = error && (error.upstreamStatus || error.httpStatus);
    const retryAfterMs = error && Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null;
    if (error && (error.code === 'DOWNLOAD_URL_BLOCKED' || error.code === 'DOWNLOAD_REDIRECT')) {
        return new SampleFailure('unsupported', 'blocked', error);
    }
    if (status === 429) return new SampleFailure('failed', 'rate_limited', error, retryAfterMs);
    if (status === 404 || status === 410) return new SampleFailure('failed', 'gone', error);
    if (status) return new SampleFailure('failed', 'upstream_http', error, retryAfterMs);
    const timedOut = error && (error.name === 'AbortError' || error.name === 'TimeoutError' ||
        error.code === 'DOWNLOAD_RESPONSE_STALL' || error.code === 'DOWNLOAD_BODY_STALL');
    return new SampleFailure('failed', timedOut ? 'timeout' : 'error', error);
}

const defaultReaders = {
    async datastore(row, { timeoutMs, signal }) {
        const target = datastoreTarget(row);
        const result = await datastoreSearch({ resourceId: target.resourceId, baseUrl: target.baseUrl,
            limit: SAMPLE_ROWS, maxRetries: 0, timeoutMs, signal });
        return { sample: fromDatastore(result || {}), bytesRead: null };
    },
    async file(row, { headBytes, timeoutMs, signal }) {
        const head = await downloadHead(toAbsoluteUrl(row.url), { maxBytes: headBytes, timeoutMs,
            userAgent: process.env.CKAN_USER_AGENT || 'canquery/1.0', signal });
        let preview;
        try {
            preview = await previewRecords(head.bytes, { complete: head.complete, maxRows: SAMPLE_ROWS });
        } catch (error) {
            throw new SampleFailure('unsupported', 'not_a_table', error);
        }
        return { sample: fromPreview(preview), bytesRead: head.bytes.length };
    }
};

// When to look again: a good sample after the refresh period, an unsupported
// file after 30 days (or sooner if its version changes), a failure after 1, 2,
// 4 … up to 30 days, and a rate-limited host when it asks (1 hour to 7 days).
function nextCheck(result, { now, refreshDays }) {
    const at = ms => new Date(now.getTime() + ms);
    if (result.status === 'ok') return at(refreshDays * DAY_MS);
    if (result.status === 'unsupported') return at(30 * DAY_MS);
    if (result.failureCode === 'rate_limited') {
        const asked = Number.isFinite(result.retryAfterMs) ? result.retryAfterMs : DAY_MS;
        return at(Math.min(7 * DAY_MS, Math.max(60 * 60 * 1000, asked)));
    }
    return at(Math.min(30, 2 ** Math.max(0, result.attempts - 1)) * DAY_MS);
}

// Serializes reads of one host with a gap between their starts, caps reads per
// host per run, and honours cooldowns (host -> epoch ms).
function createHostGate({ gapMs, maxPerHost, cooldowns, clock = Date.now, wait }) {
    const chains = new Map();
    const counts = new Map();
    const last = new Map();
    return {
        available(host) {
            return host && (cooldowns.get(host) || 0) <= clock() && (counts.get(host) || 0) < maxPerHost;
        },
        async take(host) {
            const previous = chains.get(host) || Promise.resolve();
            let granted = false;
            const turn = previous.then(async () => {
                if (!this.available(host)) return;
                const since = clock() - (last.get(host) || 0);
                if (last.has(host) && since < gapMs) await wait(gapMs - since);
                if (!this.available(host)) return;
                last.set(host, clock());
                counts.set(host, (counts.get(host) || 0) + 1);
                granted = true;
            });
            chains.set(host, turn.catch(() => {}));
            await turn;
            return granted;
        },
        coolDown(host, untilMs) {
            cooldowns.set(host, Math.max(cooldowns.get(host) || 0, untilMs));
        }
    };
}

function isDue(row, version, now) {
    if (!row.sample_checked_version) return true;
    if (row.sample_checked_version !== version) return true;
    return row.sample_next_check_at != null && new Date(row.sample_next_check_at).getTime() <= now.getTime();
}

// One run. `deps` supplies the database reads and writes, readers, progress and
// timing so tests can drive every step; the script passes the real ones.
async function runSampler({ dryRun = false, limit, settings = samplerSettings(), now = new Date(), deps }) {
    const batch = limit || settings.batch;
    const progress = (await deps.readProgress()) || {};
    const cooldowns = new Map(Object.entries(progress.cooldowns || {})
        .map(([host, until]) => [host, Date.parse(until)])
        .filter(([, until]) => Number.isFinite(until) && until > now.getTime()));
    const seen = new Set();
    const work = [];
    const consider = rows => {
        for (const row of rows) {
            if (work.length >= batch) return false;
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            const origin = sampleOrigin(row);
            if (!origin) continue;
            const version = resourceVersion(row);
            if (isDue(row, version, now)) work.push({ row, origin, version });
        }
        return work.length < batch;
    };
    consider(await deps.listShown());
    if (work.length < batch) consider(await deps.listDue({ limit: batch }));
    let cursor = progress.cursor || '';
    if (work.length < batch) {
        const swept = await deps.listSweep({ after: cursor, limit: settings.sweep });
        let index = 0;
        for (; index < swept.length && work.length < batch; index += 1) consider([swept[index]]);
        // Continue after the last row looked at; wrap once the sweep reached the end.
        cursor = index < swept.length ? swept[index - 1].id : swept.length < settings.sweep ? '' : swept[swept.length - 1].id;
    }
    const summary = { candidates: work.length, ok: 0, unsupported: 0, failed: 0, skipped_hosts: 0, by_origin: {} };
    for (const item of work) summary.by_origin[item.origin] = (summary.by_origin[item.origin] || 0) + 1;
    if (dryRun) {
        summary.sample = work.slice(0, 10).map(item => item.row.id);
        return summary;
    }

    const clock = deps.clock || Date.now;
    const deadline = clock() + settings.runMs;
    const gate = createHostGate({ gapMs: settings.hostGapMs, maxPerHost: settings.hostMax, cooldowns, clock, wait: deps.wait });
    const queue = work.slice();
    async function worker() {
        while (queue.length && clock() < deadline) {
            const item = queue.shift();
            let host;
            try { host = sampleHost(item.row, item.origin); } catch { host = null; }
            if (!host || !(await gate.take(host))) { summary.skipped_hosts += 1; continue; }
            const attempts = (item.row.sample_attempts || 0);
            let result;
            try {
                const read = await deps.readers[item.origin](item.row, { headBytes: settings.headBytes, timeoutMs: settings.timeoutMs });
                result = read.sample
                    ? { status: 'ok', sample: read.sample, bytesRead: read.bytesRead, attempts: 0 }
                    : { status: 'unsupported', failureCode: 'empty', attempts: attempts + 1 };
            } catch (error) {
                const failure = classifyFailure(error);
                result = { status: failure.status, failureCode: failure.code, retryAfterMs: failure.retryAfterMs, attempts: attempts + 1 };
                if (failure.code === 'rate_limited') gate.coolDown(host, nextCheck(result, { now: new Date(clock()), refreshDays: settings.refreshDays }).getTime());
            }
            await deps.saveSample({ ...result, resourceId: item.row.id, origin: item.origin, version: item.version,
                nextCheckAt: nextCheck(result, { now: new Date(clock()), refreshDays: settings.refreshDays }) });
            summary[result.status] += 1;
        }
    }
    await Promise.all(Array.from({ length: settings.concurrency }, worker));
    await deps.writeProgress({ cursor, cooldowns: Object.fromEntries(Array.from(cooldowns)
        .filter(([, until]) => until > clock()).map(([host, until]) => [host, new Date(until).toISOString()])) });
    return summary;
}

module.exports = { runSampler, samplerSettings, sampleOrigin, sampleHost, classifyFailure, nextCheck, createHostGate,
    defaultReaders, SampleFailure, PROGRESS_KEY: 'row-samples' };
