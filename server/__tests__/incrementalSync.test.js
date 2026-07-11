const { collectIncrementalPackages } = require('../services/incrementalSync');

function pkg(id, modified) {
    return { id, metadata_modified: modified };
}

describe('collectIncrementalPackages', () => {
    test('uses deterministic tie ordering and includes the whole overlap boundary', async () => {
        const pages = [
            [
                pkg('new', '2026-07-09T12:01:00.000Z'),
                pkg('tie-a', '2026-07-09T12:00:00.000Z')
            ],
            [
                pkg('tie-b', '2026-07-09T12:00:00.000Z'),
                pkg('old', '2026-07-09T11:54:59.000Z')
            ]
        ];
        const search = jest.fn(({ start, rows }) => ({ results: pages[start / rows] || [] }));

        const result = await collectIncrementalPackages({
            search,
            watermark: '2026-07-09T12:00:00.000Z',
            overlapMs: 5 * 60 * 1000,
            pageSize: 2,
            maxPages: 5
        });

        expect(result.complete).toBe(true);
        expect(result.reason).toBe('watermark');
        expect(result.packages.map(row => row.id)).toEqual(['new', 'tie-a', 'tie-b']);
        expect(result.nextWatermark).toBe('2026-07-09T12:01:00.000Z');
        expect(search).toHaveBeenNthCalledWith(1, {
            fq: 'metadata_modified:[2026-07-09T11:55:00.000Z TO *]',
            sort: 'metadata_modified desc, id asc',
            rows: 2,
            start: 0
        });
    });

    test('deduplicates packages repeated across offset page boundaries', async () => {
        const pages = [
            [pkg('a', '2026-07-09T12:00:00Z'), pkg('b', '2026-07-09T11:59:00Z')],
            [pkg('b', '2026-07-09T11:59:00Z'), pkg('c', '2026-07-09T11:58:00Z')],
            []
        ];
        const search = jest.fn(({ start, rows }) => ({ results: pages[start / rows] || [] }));

        const result = await collectIncrementalPackages({ search, pageSize: 2, maxPages: 5 });

        expect(result.complete).toBe(true);
        expect(result.packages.map(row => row.id)).toEqual(['a', 'b', 'c']);
    });

    test('reports a page-cap truncation instead of pretending the checkpoint is complete', async () => {
        const search = jest.fn(({ start }) => ({
            results: [
                pkg('a-' + start, '2026-07-09T12:00:00Z'),
                pkg('b-' + start, '2026-07-09T12:00:00Z')
            ]
        }));

        const result = await collectIncrementalPackages({
            search,
            watermark: '2026-07-09T12:00:00Z',
            overlapMs: 0,
            pageSize: 2,
            maxPages: 2
        });

        expect(result).toMatchObject({ complete: false, reason: 'page-cap', pagesFetched: 2 });
        expect(result.packages).toHaveLength(4);
    });

    test('rejects a malformed upstream payload rather than advancing a checkpoint', async () => {
        await expect(collectIncrementalPackages({
            search: jest.fn().mockResolvedValue({ count: 12 })
        })).rejects.toThrow('invalid results payload');
    });
});
