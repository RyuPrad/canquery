jest.mock('../db/pool', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../db/longRunningPool', () => ({ connect: jest.fn(), query: jest.fn() }));

const {
    assertDiskHeadroom,
    storageOptions,
    validateStorageFilesystems
} = require('../services/ingestPipeline');

describe('ingest storage safeguards', () => {
    it('uses explicit logical reserve and filesystem thresholds', () => {
        expect(storageOptions({
            storeBudgetBytes: 1000,
            storeReserveBytes: 200,
            storeSizeMultiplier: 3,
            minTmpFreeBytes: 50,
            storeDataPath: '/tmp',
            minStoreFreeBytes: 75
        })).toEqual({
            budgetBytes: 1000,
            reserveFloorBytes: 200,
            reserveMultiplier: 3,
            minTmpFreeBytes: 50,
            storeDataPath: '/tmp',
            minStoreFreeBytes: 75
        });
    });

    it('fails closed when a configured filesystem anchor cannot be inspected', async () => {
        await expect(assertDiskHeadroom(
            '/definitely-not-a-real-canquery-path',
            1,
            'PostgreSQL store filesystem'
        )).rejects.toMatchObject({ code: 'DISK_CHECK' });
    });

    it('validates readable temporary and store filesystem anchors at worker startup', async () => {
        await expect(validateStorageFilesystems({
            minTmpFreeBytes: 0,
            storeDataPath: '/tmp',
            minStoreFreeBytes: 0
        })).resolves.toEqual(expect.objectContaining({ storeDataPath: '/tmp' }));
    });

    it('requires a real store-filesystem anchor in production', async () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await expect(validateStorageFilesystems({
                minTmpFreeBytes: 0,
                storeDataPath: null
            })).rejects.toMatchObject({ code: 'DISK_CHECK' });
        } finally {
            if (previous === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previous;
        }
    });
});
