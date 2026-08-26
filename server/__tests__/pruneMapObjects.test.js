jest.mock('../db/pool', () => ({ query: jest.fn(), end: jest.fn() }));

const { prune } = require('../scripts/prune-map-objects');

describe('PMTiles orphan pruning', () => {
    test('deletes only old unreferenced objects after the grace period', async () => {
        const db = { query: jest.fn().mockResolvedValue({
            rows: [{ storage_key: 'maps/referenced' }]
        }) };
        const now = Date.now();
        const deleteObject = jest.fn();
        const result = await prune({
            db, config: {}, graceMs: 60_000,
            listObjects: async () => [
                { key: 'maps/referenced', byteSize: 10, lastModified: new Date(now - 120_000) },
                { key: 'maps/old-orphan', byteSize: 20, lastModified: new Date(now - 120_000) },
                { key: 'maps/new-orphan', byteSize: 30, lastModified: new Date(now) }
            ],
            deleteObject
        });
        expect(deleteObject).toHaveBeenCalledTimes(1);
        expect(deleteObject).toHaveBeenCalledWith('maps/old-orphan', expect.any(Object));
        expect(result).toEqual({
            referenced: 1, objects: 3, bytes: 60, orphans: 1, deleted: 1
        });
    });
});
