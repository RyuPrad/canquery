// Service-level contract for the GitHub star proxy: any upstream failure
// resolves null (never throws), so the cache negative-caches it and
// GET /api/v1/repo serves 200 + data: null instead of a 502 - and a
// struggling GitHub is not re-fetched on every request.
jest.mock('../utils/fetchWithBackoff', () => ({ fetchWithBackoff: jest.fn() }));

// repoService holds a module-level cache keyed by a fixed key, so each test
// loads a fresh module registry (fresh cache + fresh mock instance).
function load() {
    let mod;
    jest.isolateModules(() => {
        mod = {
            service: require('../services/repoService'),
            fetch: require('../utils/fetchWithBackoff').fetchWithBackoff,
        };
    });
    return mod;
}

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    console.warn.mockRestore();
});

describe('repoService.getRepoStats', () => {
    it('returns the star count and makes a single upstream attempt', async () => {
        const { service, fetch } = load();
        fetch.mockResolvedValue({ ok: true, json: async () => ({ stargazers_count: 28 }) });
        await expect(service.getRepoStats()).resolves.toEqual({ stars: 28 });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/RyuPrad/canquery',
            expect.objectContaining({ maxRetries: 0 })
        );
    });

    it('resolves null on a non-ok response (e.g. rate limited) instead of throwing', async () => {
        const { service, fetch } = load();
        fetch.mockResolvedValue({ ok: false, status: 403 });
        await expect(service.getRepoStats()).resolves.toBeNull();
    });

    it('resolves null when the fetch itself fails', async () => {
        const { service, fetch } = load();
        fetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'));
        await expect(service.getRepoStats()).resolves.toBeNull();
    });

    it('negative-caches a failure so GitHub is not re-fetched per request', async () => {
        const { service, fetch } = load();
        fetch.mockRejectedValue(new Error('boom'));
        await expect(service.getRepoStats()).resolves.toBeNull();
        await expect(service.getRepoStats()).resolves.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('resolves null when the payload has no numeric star count', async () => {
        const { service, fetch } = load();
        fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
        await expect(service.getRepoStats()).resolves.toBeNull();
    });
});
