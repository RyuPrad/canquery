jest.mock('../db/pool', () => ({ query: jest.fn() }));

const pool = require('../db/pool');
const queries = require('../db/catalogReadQueries');
const service = require('../services/catalogService');
const cache = require('../services/catalogReadCache');

beforeEach(() => {
    cache.clear();
    jest.resetAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
});
afterEach(() => jest.restoreAllMocks());

test('HTML and JSON discovery share one read while keeping their presentation contracts', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'dataset', name: 'roads', title_en: 'Road network' }] });
    const [json, html] = await Promise.all([
        service.searchDatasets({ limit: 50 }),
        require('../controllers/spaController').resolvePage('/datasets')
    ]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(json.items[0].title.en).toBe('Road network');
    expect(html.body).toContain('/datasets/roads');
    expect(html.status).toBe(200);
});

test('discovery reads expire at 60 seconds and do not retain failures', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    const read = () => queries.listPlaces({ featured: true, limit: 51, offset: 0 });
    pool.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(read()).rejects.toThrow('database unavailable');
    await expect(read()).resolves.toEqual([]);
    clock.mockReturnValue(59999);
    await read();
    expect(pool.query).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(60000);
    await read();
    expect(pool.query).toHaveBeenCalledTimes(3);
});

test('place filters and pagination have separate keys, with missing filters normalized', async () => {
    const args = { limit: 51, offset: 0 };
    await queries.listPlaces(args);
    await queries.listPlaces({ ...args, q: null, kind: null, parent: null, featured: null });
    for (const change of [{ q: 'Nord' }, { kind: 'region' }, { parent: 'ontario' },
        { featured: true }, { featured: false }, { limit: 20 }, { offset: 50 }]) {
        await queries.listPlaces({ ...args, ...change });
    }
    expect(pool.query).toHaveBeenCalledTimes(8);
});

test('dataset filters and publisher filters never reuse another result', async () => {
    const args = { limit: 51, offset: 0 };
    await queries.searchDatasets(args);
    await queries.searchDatasets({ ...args, format: 'csv' });
    await queries.searchDatasets({ ...args, format: 'CSV' });
    for (const change of [{ q: 'parks' }, { org: 'city' }, { keyword: 'trees' },
        { place: 'toronto' }, { source: 'portal' }, { mappable: true }, { limit: 20 }, { offset: 50 }]) {
        await queries.searchDatasets({ ...args, ...change });
    }
    expect(pool.query).toHaveBeenCalledTimes(10);
    for (const change of [{}, { q: 'ville' }, { source: 'portal' }, { place: 'toronto' }, { limit: 20 }, { offset: 50 }]) {
        await queries.listOrganizations({ ...args, ...change });
    }
    expect(pool.query).toHaveBeenCalledTimes(16);
});

test('transactional readers bypass cached pooled data and see each new read', async () => {
    const args = { limit: 51, offset: 0 };
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'uncommitted' }] }) };
    for (const read of [queries.searchDatasets, queries.listPlaces, queries.listOrganizations]) {
        await expect(read(args)).resolves.toEqual([]);
        await expect(read(args, db)).resolves.toEqual([{ id: 'uncommitted' }]);
        await read(args, db);
        await read(args);
    }
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(db.query).toHaveBeenCalledTimes(6);
});

test('oversized catalogue pages are returned without being retained', async () => {
    const rows = [{ id: 'large', notes_en: 'x'.repeat(256 * 1024) }];
    pool.query.mockResolvedValue({ rows });
    const args = { limit: 51, offset: 0 };
    await expect(queries.searchDatasets(args)).resolves.toEqual(rows);
    await queries.searchDatasets(args);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(cache.stats().size).toBe(0);
});

test('query families share the 128-entry capacity', async () => {
    for (let offset = 0; offset < 130; offset++) {
        await queries.listPlaces({ limit: 1, offset });
    }
    await queries.listOrganizations({ limit: 1, offset: 0 });
    expect(cache.stats().size).toBe(128);
    await queries.listPlaces({ limit: 1, offset: 0 });
    expect(pool.query).toHaveBeenCalledTimes(132);
});

test('stats keep counts and sync time together for one cache lifetime', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    pool.query.mockResolvedValueOnce({ rows: [{ datasets: 10, store_bytes: '100' }] })
        .mockResolvedValueOnce({ rows: [{ finished_at: '2026-10-01T00:00:00Z' }] });
    const first = await service.getStats();
    expect(await service.getStats()).toEqual(first);
    expect(first).toMatchObject({ datasets: 10, store_bytes: 100, last_synced_at: '2026-10-01T00:00:00Z' });
    expect(pool.query).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(60000);
    pool.query.mockResolvedValueOnce({ rows: [{ datasets: 11, store_bytes: '200' }] })
        .mockResolvedValueOnce({ rows: [{ finished_at: '2026-10-02T00:00:00Z' }] });
    expect(await service.getStats()).toMatchObject({ datasets: 11, store_bytes: 200, last_synced_at: '2026-10-02T00:00:00Z' });
});

test('resource and dataset details remain fresh', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'r', ingest_status: 'ready' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'r', ingest_status: null }] });
    expect(await queries.getResourceById('r')).toMatchObject({ ingest_status: 'ready' });
    expect(await queries.getResourceById('r')).toMatchObject({ ingest_status: null });
    await queries.getDatasetByIdOrName('d');
    await queries.getDatasetByIdOrName('d');
    expect(pool.query).toHaveBeenCalledTimes(4);
});
