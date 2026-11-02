import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../api/catalog.js', () => ({ queryResource: vi.fn() }));
vi.mock('../utils/analytics.js', () => ({ track: vi.fn() }));
import { queryResource } from '../api/catalog.js';
import { track } from '../utils/analytics.js';
import useResourceRows from './useResourceRows.js';
import { answerLocal, createLocalTable } from '../utils/localTable.js';
import { loadLocalTable } from '../utils/localTableClient.js';
import * as rowPageCache from '../utils/rowPageCache.js';

const SNAPSHOT = 'cqs1_' + '1'.repeat(64);
const FIELDS = [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }];
const rows = (count) => Array.from({ length: count }, (_, i) => [String(i + 1), 'n' + (i % 97)]);
const copy = { id: 'r1', query_mode: 'ingested', ingestion: { snapshot_id: SNAPSHOT, row_count: 120, fields: [{ id: 'name', type: 'TEXT' }] } };
const file = { id: 'r1', query_mode: 'ingestable', format: 'CSV' };
const serverPage = (names) => ({
  data: { fields: FIELDS, records: names.map((name, i) => ({ _id: String(i + 1), name })), total: names.length },
  meta: { query_mode: 'ingested', snapshot: { id: SNAPSHOT } }
});
const props = (overrides = {}) => ({
  id: 'r1', resource: copy, view: 'table', debouncedQ: '', debouncedFilters: {}, sort: null, page: 0,
  preparationRequired: false, fileOnly: false, hasNonEq: false, onUnavailable: () => false, schemaReady: true,
  setFilterUpgrade: () => {}, local: null, ...overrides
});
// A handle shaped like a worker-backed table: peek sees only answers already
// worked out, and a new query is answered a moment later.
function workerLike(count) {
  const table = createLocalTable({ fields: FIELDS, rows: rows(count), complete: true });
  const answers = new Map();
  return {
    key: 'copy:r1:' + SNAPSHOT, fields: FIELDS, rowCount: count, cells: count * 2, complete: true, origin: 'copy',
    snapshotId: SNAPSHOT,
    peek: (query) => answers.get(JSON.stringify(query)),
    query: (query) => new Promise((resolve) => setTimeout(() => {
      const answer = answerLocal(table, query);
      answers.set(JSON.stringify(query), answer);
      resolve(answer);
    }, 30)),
    exportRows: async () => ({ fields: FIELDS, rows: [] }),
    dispose: () => {}
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rowPageCache.clear();
});

describe('a table held in a Web Worker', () => {
  test('a new sort waits for the worker and asks the server for nothing', async () => {
    queryResource.mockImplementation(() => new Promise(() => {}));
    const handle = workerLike(6000);
    const { result } = renderHook(() => useResourceRows(props({ sort: 'name desc', local: { table: handle, interim: false, loading: false } })));
    await waitFor(() => expect(result.current.local).toBe(true));
    expect(result.current.data.records[0].name).toBe('n96');
    expect(queryResource).not.toHaveBeenCalled();
  });
});

describe('when the server takes over from the browser', () => {
  test('a query the browser cannot read keeps the rows on screen until the server answers', async () => {
    let answer;
    queryResource.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const handle = loadLocalTable({ key: 'copy:r1:' + SNAPSHOT, fields: FIELDS, rows: rows(120), complete: true, origin: 'copy', snapshotId: SNAPSHOT });
    const local = { table: handle, interim: false, loading: false };
    const { result, rerender } = renderHook((p) => useResourceRows(p), { initialProps: props({ local }) });
    expect(result.current.data.records[0].name).toBe('n0');
    // A text range is answered by the database's collation, not the browser's.
    rerender(props({ local, debouncedFilters: { name: '>n5' } }));
    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(1));
    expect(result.current.data.records[0].name).toBe('n0');
    expect(result.current.loading).toBe(true);
    await act(async () => answer(serverPage(['n6', 'n7'])));
    await waitFor(() => expect(result.current.data.records[0].name).toBe('n6'));
  });

  test('a view is counted once, whichever engine answered it first', async () => {
    queryResource.mockResolvedValue(serverPage(['n0', 'n1']));
    const { result, rerender } = renderHook((p) => useResourceRows(p), { initialProps: props({ local: { table: null, interim: false, loading: false } }) });
    await waitFor(() => expect(result.current.data?.records?.length).toBe(2));
    const handle = loadLocalTable({ key: 'copy:r1:' + SNAPSHOT, fields: FIELDS, rows: rows(120), complete: true, origin: 'copy', snapshotId: SNAPSHOT });
    rerender(props({ local: { table: handle, interim: false, loading: false } }));
    await waitFor(() => expect(result.current.local).toBe(true));
    const queries = track.mock.calls.filter(([name]) => name === 'resource_query');
    expect(queries).toHaveLength(1);
  });
});

describe('a file whose preparation cannot finish', () => {
  const partial = () => loadLocalTable({ key: 'file:r1', fields: FIELDS, rows: rows(120), complete: false, origin: 'file' }, { inThread: true });

  test('a page beyond the rows held shows empty instead of waiting', () => {
    const local = { table: partial(), interim: false, loading: false };
    const waiting = renderHook(() => useResourceRows(props({ resource: file, preparationRequired: true, page: 5, local })));
    expect(waiting.result.current.waitingForTable).toBe(true);
    const { result } = renderHook(() => useResourceRows(props({ resource: file, preparationRequired: true, page: 5, local, heldFinal: true })));
    expect(result.current).toMatchObject({ waitingForTable: false, loading: false, partial: true });
    expect(result.current.data.records).toEqual([]);
  });

  test('a query the rows held cannot read says so instead of waiting', () => {
    const local = { table: partial(), interim: false, loading: false };
    const { result } = renderHook(() => useResourceRows(props({ resource: file, preparationRequired: true, debouncedFilters: { name: '>n5' }, local, heldFinal: true })));
    expect(result.current).toMatchObject({ unsupported: true, waitingForTable: false, loading: false });
    expect(result.current.data.records).toEqual([]);
    expect(queryResource).not.toHaveBeenCalled();
  });
});

describe('a live table arriving', () => {
  const live = { id: 'r1', query_mode: 'datastore' };
  const liveHandle = () => loadLocalTable({ key: 'live:r1:', fields: FIELDS, rows: rows(120), complete: true, origin: 'live' });

  test("keeps the portal's answer for the query on screen, every page of it, until the query changes", async () => {
    queryResource.mockImplementation((_id, { q, offset = 0 }) => Promise.resolve(serverPage(['portal-' + q + '-' + offset])));
    const base = props({ resource: live, debouncedQ: 'n1', local: { table: null, interim: false, loading: true, coverage: 'pending' } });
    const { result, rerender } = renderHook((p) => useResourceRows(p), { initialProps: base });
    await waitFor(() => expect(result.current.data?.records[0].name).toBe('portal-n1-0'));
    const local = { table: liveHandle(), interim: false, loading: false, coverage: 'yes' };
    rerender({ ...base, local });
    expect(result.current.data.records[0].name).toBe('portal-n1-0');
    expect(result.current.local).toBe(false);
    // The next page of the same search comes from the portal too.
    rerender({ ...base, local, page: 1 });
    await waitFor(() => expect(result.current.data.records[0].name).toBe('portal-n1-50'));
    // A new query is the browser's.
    const asked = queryResource.mock.calls.length;
    rerender({ ...base, local, page: 0, sort: 'name desc' });
    expect(result.current.local).toBe(true);
    // The browser's substring search of "n1", sorted.
    expect(result.current.data.records[0].name).toBe('n19');
    expect(queryResource).toHaveBeenCalledTimes(asked);
  });

  test('answers at once when nothing was on screen yet, and the portal is not asked meanwhile', () => {
    const local = { table: liveHandle(), interim: false, loading: false, coverage: 'yes' };
    const { result } = renderHook(() => useResourceRows(props({ resource: live, hasNonEq: true, debouncedFilters: { name: 'n9' }, local })));
    expect(result.current.local).toBe(true);
    expect(result.current.data.records.map((record) => record.name)).toContain('n9');
    expect(queryResource).not.toHaveBeenCalled();
  });

  test('a filter the portal cannot run waits, dimmed, while the live table can still come', () => {
    const { result } = renderHook(() => useResourceRows(props({ resource: live, hasNonEq: true, debouncedFilters: { name: 'n9' },
      local: { table: null, interim: false, loading: true, coverage: 'pending' } })));
    expect(result.current.loading).toBe(true);
    expect(queryResource).not.toHaveBeenCalled();
  });
});
