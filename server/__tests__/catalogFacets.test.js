jest.mock('../db/catalogFacetQueries', () => ({ readDatasetFacets: jest.fn() }));

const { readDatasetFacets } = require('../db/catalogFacetQueries');
const { datasetFacets, refreshDatasetFacets, startFacetWarming, shapeDatasetFacets, facetKey, createFacetLimiter,
    facetStore, WARM_INTERVAL_MS } = require('../services/catalogFacets');

const row = (facet, value, count, labelEn = null, labelFr = null) => ({ facet, value, count, label_en: labelEn, label_fr: labelFr });

beforeEach(() => {
    facetStore.clear();
    jest.resetAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('shapeDatasetFacets', () => {
    test('groups rows, keeps selected values, and orders each group', () => {
        const shaped = shapeDatasetFacets([
            row('total', null, 12),
            row('level', 'municipal', 4), row('level', 'federal', 8),
            row('access', 'mappable', 2),
            row('organization', 'b-org', 3, 'B', 'B fr'), row('organization', 'a-org', 3, 'A', 'A fr'), row('organization', 'c-org', 9, 'C', null),
            row('organization-label', 'gone-org', 0, 'Gone', 'Disparu'),
            row('source', 'portal', 12, 'Portal', 'Portail'),
            row('format', 'CSV', 7), row('format', 'PDF', 7), row('format', 'CSV', 7),
            row('keyword', 'parks', 5), row('keyword-selected', 'parcs', 2)
        ], { org: ['gone-org', 'a-org'], format: ['ZIP'], keyword: ['parcs'], level: ['provincial'] });
        expect(shaped.total).toBe(12);
        expect(shaped.facets.level).toEqual([{ value: 'federal', count: 8 }, { value: 'provincial', count: 0 }, { value: 'municipal', count: 4 }]);
        expect(shaped.facets.access).toEqual([{ value: 'queryable', count: 0 }, { value: 'mappable', count: 2 }]);
        expect(shaped.facets.organization.map(item => item.value)).toEqual(['c-org', 'a-org', 'b-org', 'gone-org']);
        expect(shaped.facets.organization[3]).toEqual({ value: 'gone-org', label: { en: 'Gone', fr: 'Disparu' }, count: 0 });
        expect(shaped.facets.source).toEqual([{ value: 'portal', label: { en: 'Portal', fr: 'Portail' }, count: 12 }]);
        expect(shaped.facets.format).toEqual([{ value: 'CSV', count: 7 }, { value: 'PDF', count: 7 }, { value: 'ZIP', count: 0 }]);
        expect(shaped.facets.keyword).toEqual([{ value: 'parks', count: 5 }, { value: 'parcs', count: 2 }]);
    });

    test('caps long groups but always keeps selected values', () => {
        const rows = Array.from({ length: 45 }, (_, i) => row('format', 'F' + String(i).padStart(2, '0'), 100 - i));
        const shaped = shapeDatasetFacets(rows, { format: ['F44'] });
        expect(shaped.facets.format).toHaveLength(41);
        expect(shaped.facets.format.at(-1)).toEqual({ value: 'F44', count: 56 });
    });
});

test('keys ignore search spelling, paging and order, but not filters or language', () => {
    const base = { q: 'Parks', format: ['CSV'], lang: 'en' };
    expect(facetKey(base)).toBe(facetKey({ ...base, q: 'parks', sort: 'title', limit: 50, offset: 100 }));
    expect(facetKey(base)).not.toBe(facetKey({ ...base, lang: 'fr' }));
    expect(facetKey(base)).not.toBe(facetKey({ ...base, format: ['PDF'] }));
    expect(facetKey(base)).not.toBe(facetKey({ ...base, queryable: true }));
});

test('the limiter runs two computations, queues briefly, then refuses', async () => {
    jest.useFakeTimers();
    try {
        const limiter = createFacetLimiter({ concurrency: 2, queueLimit: 1, waitMs: 1000 });
        const gates = [];
        const slow = () => new Promise(resolve => gates.push(resolve));
        const first = limiter.run(slow);
        const second = limiter.run(slow);
        const third = limiter.run(() => 'third');
        await expect(limiter.run(() => 'refused')).resolves.toEqual({ skipped: true });
        expect(limiter.stats()).toEqual({ active: 2, queued: 1 });
        gates[0]('one');
        await expect(first).resolves.toEqual({ value: 'one' });
        await expect(third).resolves.toEqual({ value: 'third' });
        const fourth = limiter.run(slow);
        const late = limiter.run(() => 'late');
        expect(limiter.stats()).toEqual({ active: 2, queued: 1 });
        jest.advanceTimersByTime(1000);
        await expect(late).resolves.toEqual({ skipped: true });
        gates[1]('two');
        gates[2]('four');
        await expect(second).resolves.toEqual({ value: 'two' });
        await expect(fourth).resolves.toEqual({ value: 'four' });
        expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
    } finally {
        jest.useRealTimers();
    }
});

describe('datasetFacets', () => {
    test('caches shaped counts and never throws', async () => {
        readDatasetFacets.mockResolvedValue([row('total', null, 2)]);
        const filters = { format: ['CSV'], lang: 'en' };
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 2 });
        await expect(datasetFacets({ ...filters, sort: 'updated' })).resolves.toMatchObject({ total: 2 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(1);
        readDatasetFacets.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));
        await expect(datasetFacets({ lang: 'fr' })).resolves.toBeNull();
        expect(console.warn).toHaveBeenCalledWith('[catalog-facets] counts unavailable: error XX000');
    });

    test('a timeout is not cached but cools that key down', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
        readDatasetFacets.mockRejectedValueOnce(Object.assign(new Error('canceling statement'), { code: '57014' }));
        const filters = { keyword: ['slow'], lang: 'en' };
        await expect(datasetFacets(filters)).resolves.toBeNull();
        readDatasetFacets.mockResolvedValue([row('total', null, 5)]);
        await expect(datasetFacets(filters)).resolves.toBeNull();
        expect(readDatasetFacets).toHaveBeenCalledTimes(1);
        clock.mockReturnValue(1000 + 30 * 1000);
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 5 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
    });

    test('after five minutes the previous counts are served while one background refresh replaces them', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
        let release;
        readDatasetFacets.mockResolvedValueOnce([row('total', null, 1)]);
        const filters = { lang: 'en' };
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 1 });
        clock.mockReturnValue(5 * 60 * 1000);
        readDatasetFacets.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 1 });
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 1 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
        release([row('total', null, 2)]);
        await new Promise((resolve) => setImmediate(resolve));
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 2 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
    });

    test('a failed refresh keeps the previous counts until they expire after an hour', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
        readDatasetFacets.mockResolvedValueOnce([row('total', null, 7)]);
        const filters = { lang: 'fr' };
        await datasetFacets(filters);
        clock.mockReturnValue(10 * 60 * 1000);
        readDatasetFacets.mockRejectedValueOnce(Object.assign(new Error('canceling statement'), { code: '57014' }));
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 7 });
        await new Promise((resolve) => setImmediate(resolve));
        expect(console.warn).toHaveBeenCalledWith('[catalog-facets] counts unavailable: timeout');
        // The timeout cooled the key down: stale counts, but no new computation.
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 7 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
        clock.mockReturnValue(61 * 60 * 1000);
        readDatasetFacets.mockResolvedValueOnce([row('total', null, 8)]);
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 8 });
    });
});

describe('refreshDatasetFacets', () => {
    test('waits for missing or stale counts and leaves fresh counts alone', async () => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
        readDatasetFacets.mockResolvedValueOnce([row('total', null, 1)]);
        const filters = { lang: 'en' };
        await expect(refreshDatasetFacets(filters)).resolves.toMatchObject({ total: 1 });
        await expect(refreshDatasetFacets(filters)).resolves.toMatchObject({ total: 1 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(1);
        clock.mockReturnValue(5 * 60 * 1000);
        readDatasetFacets.mockResolvedValueOnce([row('total', null, 2)]);
        // A request would get the stale counts at once; a refresh waits for new ones.
        await expect(refreshDatasetFacets(filters)).resolves.toMatchObject({ total: 2 });
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 2 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
    });

    test('never throws and keeps the previous counts when a refresh times out', async () => {
        // Later than the earlier tests, whose warnings and cooldowns persist in the module.
        const start = 3 * 60 * 60 * 1000;
        const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
        readDatasetFacets.mockResolvedValueOnce([row('total', null, 3)]);
        const filters = { lang: 'fr' };
        await refreshDatasetFacets(filters);
        clock.mockReturnValue(start + 10 * 60 * 1000);
        readDatasetFacets.mockRejectedValueOnce(Object.assign(new Error('canceling statement'), { code: '57014' }));
        await expect(refreshDatasetFacets(filters)).resolves.toBeNull();
        expect(console.warn).toHaveBeenCalledWith('[catalog-facets] counts unavailable: timeout');
        // The key is cooling down: the previous counts, and no new computation.
        await expect(refreshDatasetFacets(filters)).resolves.toMatchObject({ total: 3 });
        await expect(datasetFacets(filters)).resolves.toMatchObject({ total: 3 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(2);
    });
});

describe('startFacetWarming', () => {
    const settle = () => jest.advanceTimersByTimeAsync(0);
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('computes each search in turn as soon as it starts', async () => {
        const gates = [];
        readDatasetFacets.mockImplementation(filters => new Promise(resolve =>
            gates.push(() => resolve([row('total', null, filters.lang === 'fr' ? 2 : 1)]))));
        const stop = startFacetWarming([{ lang: 'en' }, { lang: 'fr' }]);
        try {
            await settle();
            expect(readDatasetFacets.mock.calls.map(([filters]) => filters.lang)).toEqual(['en']);
            gates[0]();
            await settle();
            expect(readDatasetFacets.mock.calls.map(([filters]) => filters.lang)).toEqual(['en', 'fr']);
            gates[1]();
            await settle();
            await expect(datasetFacets({ lang: 'en' })).resolves.toMatchObject({ total: 1 });
            await expect(datasetFacets({ lang: 'fr' })).resolves.toMatchObject({ total: 2 });
            expect(readDatasetFacets).toHaveBeenCalledTimes(2);
        } finally {
            stop();
        }
    });

    test('refreshes the counts before they expire, even when nobody asks, until stopped', async () => {
        readDatasetFacets.mockImplementation(async () => [row('total', null, readDatasetFacets.mock.calls.length)]);
        const stop = startFacetWarming([{ lang: 'en' }]);
        await settle();
        expect(readDatasetFacets).toHaveBeenCalledTimes(1);
        for (let pass = 2; pass <= 4; pass++) {
            await jest.advanceTimersByTimeAsync(WARM_INTERVAL_MS);
            expect(readDatasetFacets).toHaveBeenCalledTimes(pass);
        }
        // Three passes later, over an hour after the first, the counts are cached and fresh.
        await expect(datasetFacets({ lang: 'en' })).resolves.toMatchObject({ total: 4 });
        expect(readDatasetFacets).toHaveBeenCalledTimes(4);
        stop();
        await jest.advanceTimersByTimeAsync(3 * WARM_INTERVAL_MS);
        expect(readDatasetFacets).toHaveBeenCalledTimes(4);
    });

    test('does not start another pass while one is still running', async () => {
        let release;
        readDatasetFacets.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([row('total', null, 1)]); }));
        const stop = startFacetWarming([{ lang: 'en' }], { intervalMs: 1000 });
        try {
            await jest.advanceTimersByTimeAsync(5000);
            expect(readDatasetFacets).toHaveBeenCalledTimes(1);
            release();
            await settle();
            await expect(datasetFacets({ lang: 'en' })).resolves.toMatchObject({ total: 1 });
        } finally {
            stop();
        }
    });
});
