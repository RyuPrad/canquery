const { createCache } = require('../utils/cache');

describe('createCache', () => {
    it('shares an in-flight result but does not retain oversized values', async () => {
        const cache = createCache({ name: 'byte-bound', ttlMs: 1000, negativeTtlMs: 1, maxEntries: 2,
            cacheable: value => Buffer.byteLength(value) <= 10 });
        const load = jest.fn(async () => 'x'.repeat(11));
        await Promise.all([cache.get('a', load), cache.get('a', load)]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(cache.stats().size).toBe(0);
        await cache.get('a', load);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('never exceeds maxEntries under high-cardinality use', async () => {
        const cache = createCache({ name: 'bounded', ttlMs: 60000, negativeTtlMs: 1000, maxEntries: 25 });

        for (let i = 0; i < 2000; i++) {
            await cache.get('key-' + i, async () => i);
        }

        expect(cache.stats().size).toBe(25);
        expect(cache.stats().evictions).toBe(1975);
    });

    it('evicts the least-recently used entry', async () => {
        const cache = createCache({ name: 'lru', ttlMs: 60000, negativeTtlMs: 1000, maxEntries: 2 });
        const loadA = jest.fn(async () => 'a');

        await cache.get('a', loadA);
        await cache.get('b', async () => 'b');
        await cache.get('a', loadA); // touch a; b is now the oldest
        await cache.get('c', async () => 'c');
        await cache.get('a', loadA);

        expect(loadA).toHaveBeenCalledTimes(1);
        expect(cache.stats().evictions).toBe(1);
    });

    it('deletes an expired entry on access before reloading it', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const cache = createCache({ name: 'expiry', ttlMs: 100, negativeTtlMs: 50, maxEntries: 2 });
        const load = jest.fn(async () => 'value');

        await cache.get('a', load);
        jest.setSystemTime(new Date('2026-01-01T00:00:00.101Z'));
        await cache.get('a', load);

        expect(load).toHaveBeenCalledTimes(2);
        expect(cache.stats()).toEqual(expect.objectContaining({ expired: 1, size: 1 }));
        jest.useRealTimers();
    });

    it('rejects a missing hard capacity', () => {
        expect(() => createCache({ name: 'bad', ttlMs: 1, negativeTtlMs: 1, maxEntries: 0 })).toThrow(/maxEntries/);
    });

    it('bounds high-cardinality in-flight bookkeeping too', async () => {
        const cache = createCache({
            name: 'in-flight',
            ttlMs: 1000,
            negativeTtlMs: 100,
            maxEntries: 2,
            maxInFlight: 2
        });
        const releases = [];
        const pending = (value) => new Promise(resolve => releases.push(() => resolve(value)));

        const first = cache.get('a', () => pending('a'));
        const second = cache.get('b', () => pending('b'));
        await Promise.resolve();
        const third = cache.get('c', async () => 'c');

        expect(cache.stats()).toEqual(expect.objectContaining({
            in_flight: 2,
            uncached_misses: 1,
            size: 0
        }));
        await expect(third).resolves.toBe('c');
        expect(cache.stats().size).toBe(0);

        releases.forEach(release => release());
        await Promise.all([first, second]);
        expect(cache.stats()).toEqual(expect.objectContaining({ in_flight: 0, size: 2 }));
    });
});

describe('createCache refresh', () => {
    it('recomputes a fresh entry while reads keep the previous value, sharing in-flight work', async () => {
        const cache = createCache({ name: 'refresh', ttlMs: 60000, negativeTtlMs: 1000 });
        await cache.get('k', async () => 1);
        let release;
        const refreshed = cache.refresh('k', () => new Promise(resolve => { release = resolve; }));
        await expect(cache.get('k', async () => 'unused')).resolves.toBe(1);
        expect(cache.refresh('k', async () => 'other')).toBe(refreshed);
        release(2);
        await expect(refreshed).resolves.toBe(2);
        await expect(cache.get('k', async () => 'unused')).resolves.toBe(2);
        expect(cache.stats()).toMatchObject({ refreshes: 1, in_flight_hits: 1, misses: 1 });
    });

    it('a cold read joins a refresh in flight, and a failed refresh keeps the previous value', async () => {
        const cache = createCache({ name: 'refresh-cold', ttlMs: 60000, negativeTtlMs: 1000 });
        let release;
        const refreshed = cache.refresh('k', () => new Promise(resolve => { release = resolve; }));
        const read = cache.get('k', async () => 'unused');
        await new Promise(resolve => setImmediate(resolve));
        release('first');
        await expect(read).resolves.toBe('first');
        await expect(refreshed).resolves.toBe('first');
        await expect(cache.refresh('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        await expect(cache.get('k', async () => 'unused')).resolves.toBe('first');
        expect(cache.stats().size).toBe(1);
    });
});
