jest.mock('../db/pool', () => ({ query: jest.fn(), end: jest.fn() }));

const pool = require('../db/pool');
const { retryMapSource } = require('../scripts/retry-map-source');

describe('map source recovery command', () => {
    beforeEach(() => jest.clearAllMocks());

    test('defaults to a read-only failed-job count', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ failed: '4', retryable_skipped: '2' }] });
        await expect(retryMapSource(pool, 'shawinigan-open-data')).resolves.toEqual({
            source_id: 'shawinigan-open-data', failed: 4, retryable_skipped: 2, apply: false
        });
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).toContain("j.status = 'failed'");
    });

    test('apply only requeues failed jobs for the requested source', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ failed: '4', retryable_skipped: '2' }] })
            .mockResolvedValueOnce({ rowCount: 4, rows: [] });
        await expect(retryMapSource(pool, 'shawinigan-open-data', true)).resolves.toEqual({
            source_id: 'shawinigan-open-data', failed: 4, retryable_skipped: 2,
            requeued: 4, apply: true
        });
        expect(pool.query.mock.calls[1][0]).toContain("r.raw->>'source_id' = $1");
        expect(pool.query.mock.calls[1][0]).toContain("j.status = 'failed'");
        expect(pool.query.mock.calls[1][0]).toContain("j.failure_code = 'DOWNLOAD_PENDING'");
    });

    test('rejects an unknown source before querying the database', async () => {
        await expect(retryMapSource(pool, 'missing-source')).rejects.toThrow(/unknown or missing/);
        expect(pool.query).not.toHaveBeenCalled();
    });
});
