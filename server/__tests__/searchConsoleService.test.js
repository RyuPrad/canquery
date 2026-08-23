const service = require('../services/searchConsoleService');

describe('Search Console date handling', () => {
    it('uses finalized Pacific calendar dates and inclusive ranges', () => {
        expect(service.pacificDate(new Date('2026-08-22T02:00:00Z'))).toBe('2026-08-21');
        expect(service.addDays('2026-03-01', -1)).toBe('2026-02-28');
        expect(service.dateRange('2026-08-18', '2026-08-20')).toEqual([
            '2026-08-18', '2026-08-19', '2026-08-20'
        ]);
    });

    it('rejects invalid and unbounded ranges', () => {
        expect(() => service.validateDate('2026-02-30')).toThrow(/real calendar date/);
        expect(() => service.dateRange('2026-08-20', '2026-08-18')).toThrow(/after/);
        expect(() => service.dateRange('2025-01-01', '2026-08-20')).toThrow(/500/);
    });
});

describe('Search Console API pagination', () => {
    it('requests finalized web data and pages at 25k rows', async () => {
        const first = Array.from({ length: service.ROW_LIMIT }, (_, i) => ({ keys: ['q' + i] }));
        const request = jest.fn()
            .mockResolvedValueOnce({ data: { rows: first } })
            .mockResolvedValueOnce({ data: { rows: [{ keys: ['last'] }] } });
        const result = await service.querySlice(request, {
            siteUrl: 'https://example.com/', dataDate: '2026-08-19', dimension: 'query'
        });
        expect(result.rows).toHaveLength(service.ROW_LIMIT + 1);
        expect(result.truncated).toBe(false);
        expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
            url: expect.stringContaining(encodeURIComponent('https://example.com/')),
            method: 'POST',
            data: expect.objectContaining({
                startDate: '2026-08-19', endDate: '2026-08-19', type: 'web',
                dataState: 'final', dimensions: ['query'], rowLimit: 25000, startRow: 0
            })
        }));
        expect(request.mock.calls[1][0].data.startRow).toBe(25000);
    });

    it('caps a dimension at 50k rows and reports truncation', async () => {
        const page = Array.from({ length: service.ROW_LIMIT }, (_, i) => ({ keys: ['q' + i] }));
        const request = jest.fn().mockResolvedValue({ data: { rows: page } });
        const result = await service.querySlice(request, {
            siteUrl: 'https://example.com/', dataDate: '2026-08-19', dimension: 'query'
        });
        expect(result.rows).toHaveLength(service.MAX_ROWS);
        expect(result.truncated).toBe(true);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('retries 429/5xx responses with bounded backoff', async () => {
        const error = Object.assign(new Error('limited'), { response: { status: 429 } });
        const request = jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ data: { rows: [] } });
        const sleep = jest.fn().mockResolvedValue();
        await service.querySlice(request, {
            siteUrl: 'https://example.com/', dataDate: '2026-08-19', sleep
        });
        expect(request).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(500);
    });
});

describe('Search Console daily synchronization', () => {
    it('collects totals and each allowed breakdown without copying empty keys', async () => {
        const request = jest.fn(async ({ data }) => {
            if (!data.dimensions) return { data: { rows: [{ clicks: 3, impressions: 10, ctr: 0.3, position: 4.2 }] } };
            return { data: { rows: [
                { keys: [data.dimensions[0] + '-value'], clicks: 1, impressions: 2, ctr: 0.5, position: 2 },
                { keys: [''], clicks: 0, impressions: 0, ctr: 0, position: 0 }
            ] } };
        });
        const day = await service.collectDay(request, {
            siteUrl: 'https://example.com/', dataDate: '2026-08-19'
        });
        expect(day.total).toEqual({ clicks: 3, impressions: 10, ctr: 0.3, position: 4.2 });
        expect(day.breakdowns).toHaveLength(4);
        expect(day.breakdowns.map(row => row.dimension)).toEqual(service.DIMENSIONS);
    });

    it('replaces one transactionally complete day at a time', async () => {
        const db = { replaceSearchConsoleDay: jest.fn().mockResolvedValue() };
        const request = jest.fn(async ({ data }) => ({
            data: { rows: data.dimensions ? [] : [{ clicks: 1, impressions: 2, ctr: 0.5, position: 1 }] }
        }));
        const log = jest.fn();
        const result = await service.syncRange({
            db, request, siteUrl: 'https://example.com/',
            startDate: '2026-08-18', endDate: '2026-08-19', logger: log
        });
        expect(db.replaceSearchConsoleDay).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ days: 2, breakdownRows: 0, truncated: [] });
        expect(log).toHaveBeenCalledTimes(2);
    });
});
