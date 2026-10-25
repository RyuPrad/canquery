const request = require('supertest');
const app = require('../app');
const { indexNowKey, submitChanges, changedUrls, ENDPOINT, BATCH_SIZE, MAX_BATCHES } = require('../services/indexNow');
const { listArticles } = require('../services/blogContent');

const KEY = '0123456789abcdef0123456789abcdef';
const saved = process.env.INDEXNOW_KEY;
afterEach(() => {
    if (saved === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = saved;
});

describe('IndexNow key', () => {
    it('is off when unset and rejects a malformed value', () => {
        expect(indexNowKey('')).toBeNull();
        expect(indexNowKey(undefined)).toBeNull();
        expect(indexNowKey(' ' + KEY + ' ')).toBe(KEY);
        expect(indexNowKey('abc-DEF-123')).toBe('abc-DEF-123');
        for (const bad of ['short', 'has space inside', 'x'.repeat(129), 'dots.not.allowed', '../etc']) {
            expect(() => indexNowKey(bad)).toThrow('INDEXNOW_KEY must be 8 to 128 letters, digits or hyphens');
        }
    });

    it('serves the key file only for the configured key', async () => {
        process.env.INDEXNOW_KEY = KEY;
        const res = await request(app).get('/' + KEY + '.txt');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/plain/);
        expect(res.text).toBe(KEY);
        expect((await request(app).get('/ffffffffffffffffffffffffffffffff.txt')).status).toBe(404);
        expect((await request(app).get('/robots.txt')).text).toContain('User-agent: *');
    });

    it('serves no key file when IndexNow is off', async () => {
        delete process.env.INDEXNOW_KEY;
        expect((await request(app).get('/' + KEY + '.txt')).status).toBe(404);
    });
});

describe('IndexNow submission', () => {
    const now = new Date('2026-10-26T07:45:00Z');
    const changes = { datasets: [{ id: 'd1', name: 'roads' }, { id: 'd/2', name: null }], resources: [{ id: 'r1' }] };
    const accepted = status => jest.fn().mockResolvedValue({ status });
    // First-run window: two days back. Guides updated inside it join the list.
    const firstRunUrls = () => changedUrls(changes, new Date('2026-10-24T07:45:00Z')).length;
    const run = (overrides = {}) => {
        const writeProgress = jest.fn().mockResolvedValue();
        const readChanges = jest.fn().mockResolvedValue(changes);
        const deps = { key: KEY, now, readProgress: jest.fn().mockResolvedValue(null), writeProgress, readChanges,
            fetchImpl: accepted(200), log: () => {}, ...overrides };
        return { deps, promise: submitChanges(deps) };
    };

    it('sends the canonical URLs changed in the window and moves the watermark', async () => {
        const { deps, promise } = run({ readProgress: jest.fn().mockResolvedValue({ submitted_through: '2026-10-25T07:45:00Z' }) });
        const result = await promise;
        // One day of overlap behind the last run catches sources that sync once a day.
        expect(deps.readChanges).toHaveBeenCalledWith({ since: new Date('2026-10-24T07:45:00Z'), until: now, limit: BATCH_SIZE * MAX_BATCHES + 1 });
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = deps.fetchImpl.mock.calls[0];
        expect(url).toBe(ENDPOINT);
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ host: 'canquery.com', key: KEY, keyLocation: 'https://canquery.com/' + KEY + '.txt' });
        expect(body.urlList.slice(0, 3)).toEqual(['https://canquery.com/datasets/roads', 'https://canquery.com/datasets/d%2F2',
            'https://canquery.com/resources/r1']);
        expect(deps.writeProgress).toHaveBeenCalledWith({ submitted_through: now.toISOString(), urls: body.urlList.length });
        expect(result.submitted).toBe(body.urlList.length);
    });

    it('starts two days back on the first run and includes guides updated in the window', async () => {
        const { deps, promise } = run();
        await promise;
        const since = new Date('2026-10-24T07:45:00Z');
        expect(deps.readChanges.mock.calls[0][0].since).toEqual(since);
        const guides = ['en', 'fr'].flatMap(lang => listArticles({ lang })).filter(article => article.updated >= '2026-10-24');
        const urls = changedUrls(changes, since);
        for (const article of guides) expect(urls).toContain('https://canquery.com' + article.path);
        expect(JSON.parse(deps.fetchImpl.mock.calls[0][1].body).urlList).toEqual(urls);
    });

    it('accepts 202 and keeps the watermark when IndexNow refuses a batch', async () => {
        await expect(run({ fetchImpl: accepted(202) }).promise).resolves.toMatchObject({ submitted: firstRunUrls() });
        for (const status of [400, 403, 422, 429, 500]) {
            const { deps, promise } = run({ fetchImpl: accepted(status) });
            await expect(promise).rejects.toThrow('IndexNow answered HTTP ' + status);
            expect(deps.writeProgress).not.toHaveBeenCalled();
        }
    });

    it('sends nothing and keeps the watermark in a dry run', async () => {
        const log = jest.fn();
        const { deps, promise } = run({ dryRun: true, log });
        await expect(promise).resolves.toMatchObject({ urls: firstRunUrls(), submitted: 0 });
        expect(deps.fetchImpl).not.toHaveBeenCalled();
        expect(deps.writeProgress).not.toHaveBeenCalled();
        expect(log.mock.calls[0][0]).toContain('would submit ' + firstRunUrls() + ' URLs');
    });

    it('splits a large window into 10,000-URL batches and refuses one beyond the cap', async () => {
        const many = { datasets: Array.from({ length: 15000 }, (_, i) => ({ id: 'd' + i, name: null })), resources: [] };
        const { deps, promise } = run({ readChanges: jest.fn().mockResolvedValue(many) });
        await promise;
        expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
        expect(JSON.parse(deps.fetchImpl.mock.calls[0][1].body).urlList).toHaveLength(10000);

        const tooMany = { datasets: Array.from({ length: BATCH_SIZE * MAX_BATCHES + 1 }, (_, i) => ({ id: 'd' + i, name: null })), resources: [] };
        const refused = run({ readChanges: jest.fn().mockResolvedValue(tooMany) });
        await expect(refused.promise).rejects.toThrow('more than 50000 changed URLs');
        expect(refused.deps.fetchImpl).not.toHaveBeenCalled();
        expect(refused.deps.writeProgress).not.toHaveBeenCalled();
    });
});
