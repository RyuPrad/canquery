// Service-level contract for the healthz upstream probe: a failed CKAN ping
// resolves into the cache as a negative entry (upstream: false), so while CKAN
// is down repeated health checks reuse the cached verdict instead of
// re-pinging (with fetchWithBackoff retries) on every request.
jest.mock('../services/ckanClient', () => ({
    packageList: jest.fn(),
    packageSearch: jest.fn(),
    packageShow: jest.fn(),
    organizationList: jest.fn(),
    datastoreSearch: jest.fn(),
}));
jest.mock('../db/catalogReadQueries', () => ({ pingDb: jest.fn() }));
jest.mock('../db/queryLogQueries', () => ({}));

// catalogService holds a module-level cache, so each test loads a fresh module
// registry (fresh cache + fresh mock instances).
function load() {
    let mod;
    jest.isolateModules(() => {
        mod = {
            service: require('../services/catalogService'),
            ckan: require('../services/ckanClient'),
            queries: require('../db/catalogReadQueries'),
        };
    });
    return mod;
}

describe('catalogService.healthz upstream probe', () => {
    it('reports ok when both the db and CKAN respond', async () => {
        const { service, ckan, queries } = load();
        queries.pingDb.mockResolvedValue(true);
        ckan.packageList.mockResolvedValue(['x']);
        await expect(service.healthz()).resolves.toEqual({ ok: true, db: true, upstream: true });
    });

    it('negative-caches a failed CKAN ping instead of re-pinging per check', async () => {
        const { service, ckan, queries } = load();
        queries.pingDb.mockResolvedValue(true);
        ckan.packageList.mockRejectedValue(new Error('ETIMEDOUT'));
        await expect(service.healthz()).resolves.toEqual({ ok: false, db: true, upstream: false });
        await expect(service.healthz()).resolves.toEqual({ ok: false, db: true, upstream: false });
        expect(ckan.packageList).toHaveBeenCalledTimes(1);
    });
});
