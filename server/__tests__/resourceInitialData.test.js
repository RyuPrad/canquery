jest.mock('../services/catalogService', () => ({
    resourceDetail: jest.fn(row => ({ id: row.id, query_mode: 'ingested', provenance: { sources: [], primary_license: null } })),
    computeQueryMode: jest.fn(() => 'ingested')
}));
jest.mock('../services/queryService', () => ({ queryResource: jest.fn(), queryLimits: () => ({ max_offset: 10000 }) }));

const queryService = require('../services/queryService');
const { snapshotInfo } = require('../services/snapshotIdentity');
const { resourceInitialData, rowsRequested, pageIndex, withinBudget, INLINE_MAX_BYTES } = require('../services/resourceInitialData');

const row = { id: 'r1', ingest_status: 'ready', table_name: 'r_abc', ingested_at: '2026-09-01T00:00:00Z' };
const result = { fields: [{ id: '_id', type: 'int' }], records: [{ _id: 1 }], total: 1, query_mode: 'ingested',
    snapshot: snapshotInfo(row), retrieved_at: '2026-10-15T00:00:00Z', publisher_modified_at: null,
    limits: { max_page_rows: 100, max_offset: 10000, export_max_rows: 10000 }, provenance: { sources: [], primary_license: null } };
const params = search => new URLSearchParams(search);

beforeEach(() => {
    jest.clearAllMocks();
    queryService.queryResource.mockResolvedValue(result);
});

test('only the unfiltered table view asks for embedded rows', () => {
    expect(rowsRequested(params(''))).toBe(true);
    expect(rowsRequested(params('view=table&page=3'))).toBe(true);
    for (const search of ['q=a', 'cf=%7B%7D', 'sort=name', 'view=chart', 'view=map']) {
        expect(rowsRequested(params(search))).toBe(false);
    }
});

test('the page index follows the browser rules and the offset ceiling', () => {
    expect(pageIndex(params(''), 10000)).toBe(0);
    expect(pageIndex(params('page=3'), 10000)).toBe(3);
    expect(pageIndex(params('page=999'), 10000)).toBe(200);
    expect(pageIndex(params('page=-1'), 10000)).toBe(0);
    expect(pageIndex(params('page=abc'), 10000)).toBe(0);
    expect(pageIndex(params('page=2.5'), 10000)).toBe(0);
});

test('runs the pinned page passively from the loaded row and echoes the answered path and page', async () => {
    const signal = new AbortController().signal;
    const payload = await resourceInitialData(row, { path: '/resources/r1?page=2', params: params('page=2'), signal, log: true });
    expect(queryService.queryResource).toHaveBeenCalledWith('r1',
        { limit: 50, offset: 100, snapshot: snapshotInfo(row).id },
        { initial: row, signal, touch: false, log: true });
    expect(payload).toMatchObject({ version: 1, path: '/resources/r1?page=2', page: 2 });
    expect(payload.resource.data.id).toBe('r1');
    expect(payload.rows.data.total).toBe(1);
    expect(payload.rows.meta.snapshot.id).toBe(snapshotInfo(row).id);
});

test('leaves the rows out when the read fails, overruns its budget or is oversized', async () => {
    const warn = jest.fn();
    queryService.queryResource.mockRejectedValue(new Error('lock timeout'));
    const failed = await resourceInitialData(row, { path: '/resources/r1', params: params('') }, { warn });
    expect(failed.rows).toBeNull();
    expect(failed.page).toBeNull();
    expect(failed.resource.data.id).toBe('r1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lock timeout'));

    jest.useFakeTimers();
    try {
        const pending = resourceInitialData(row, { path: '/resources/r1', params: params('') },
            { warn, timeoutMs: 50, queryRows: () => new Promise(() => {}) });
        await jest.advanceTimersByTimeAsync(60);
        expect((await pending).rows).toBeNull();
        expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('50 ms'));
    } finally {
        jest.useRealTimers();
    }

    queryService.queryResource.mockResolvedValue({ ...result, records: [{ _id: 1, text: 'x'.repeat(INLINE_MAX_BYTES) }] });
    const wide = await resourceInitialData(row, { path: '/resources/r1', params: params('') }, { warn });
    expect(wide.rows).toBeNull();
});

test('skips the read for other query modes, missing snapshots and filtered views', async () => {
    const catalogService = require('../services/catalogService');
    catalogService.computeQueryMode.mockReturnValueOnce('datastore');
    expect((await resourceInitialData(row, { path: '/resources/r1', params: params('') })).rows).toBeNull();
    expect((await resourceInitialData({ ...row, table_name: null }, { path: '/resources/r1', params: params('') })).rows).toBeNull();
    expect((await resourceInitialData(row, { path: '/resources/r1?q=a', params: params('q=a') })).rows).toBeNull();
    expect(queryService.queryResource).not.toHaveBeenCalled();
});

test('an exceeded budget never surfaces the late rejection', async () => {
    jest.useFakeTimers();
    try {
        let reject;
        const late = new Promise((_resolve, r) => { reject = r; });
        const budget = withinBudget(late, 10);
        await jest.advanceTimersByTimeAsync(20);
        expect(await budget).toBeNull();
        reject(new Error('late failure'));
        await Promise.resolve();
    } finally {
        jest.useRealTimers();
    }
});
