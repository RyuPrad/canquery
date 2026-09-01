const {
    CATALOG_SYNC_LOCK_KEYS,
    acquireCatalogSyncLock,
    releaseCatalogSyncLock
} = require('../db/catalogSyncLock');

describe('catalog sync advisory lock', () => {
    function makePool(result) {
        const client = {
            query: jest.fn().mockResolvedValue(result),
            release: jest.fn()
        };
        return { pool: { connect: jest.fn().mockResolvedValue(client) }, client };
    }

    it('holds a dedicated client when the lock is acquired', async () => {
        const { pool, client } = makePool({ rows: [{ acquired: true }] });

        await expect(acquireCatalogSyncLock(pool)).resolves.toBe(client);
        expect(client.query).toHaveBeenCalledWith(
            'SELECT pg_try_advisory_lock($1, $2) AS acquired',
            CATALOG_SYNC_LOCK_KEYS
        );
        expect(client.release).not.toHaveBeenCalled();
    });

    it('returns a graceful skip and releases the client when busy', async () => {
        const { pool, client } = makePool({ rows: [{ acquired: false }] });

        await expect(acquireCatalogSyncLock(pool)).resolves.toBeNull();
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('releases the lock and client after a successful run', async () => {
        const { client } = makePool({ rows: [{ released: true }] });

        await expect(releaseCatalogSyncLock(client)).resolves.toBe(true);
        expect(client.query).toHaveBeenCalledWith(
            'SELECT pg_advisory_unlock($1, $2) AS released',
            CATALOG_SYNC_LOCK_KEYS
        );
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('releases the client if lock acquisition fails', async () => {
        const client = { query: jest.fn().mockRejectedValue(new Error('connection lost')), release: jest.fn() };
        const pool = { connect: jest.fn().mockResolvedValue(client) };

        await expect(acquireCatalogSyncLock(pool)).rejects.toThrow('connection lost');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('releases the client even if unlock fails', async () => {
        const client = { query: jest.fn().mockRejectedValue(new Error('unlock failed')), release: jest.fn() };

        await expect(releaseCatalogSyncLock(client)).rejects.toThrow('unlock failed');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});
