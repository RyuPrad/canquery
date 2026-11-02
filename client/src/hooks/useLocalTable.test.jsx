import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../api/catalog.js', () => ({ fetchResourceRows: vi.fn() }));
import { fetchResourceRows } from '../api/catalog.js';
import { ApiError } from '../api/client.js';
import useLocalTable, { clearLocalTables, localSource } from './useLocalTable.js';
import { markEngaged } from '../utils/engagement.js';

const SNAPSHOT = 'cqs1_' + '1'.repeat(64);
const copy = (overrides = {}) => ({
  id: 'r1',
  query_mode: 'ingested',
  format: 'CSV',
  url: 'https://example.test/r1.csv',
  ingestion: { snapshot_id: SNAPSHOT, row_count: 2, fields: [{ id: 'name', type: 'TEXT' }] },
  ...overrides
});
const file = (overrides = {}) => ({ id: 'r1', query_mode: 'ingestable', format: 'CSV', url: 'https://example.test/r1.csv', last_modified: '2026-10-01', ...overrides });
const rowsEnvelope = (origin = 'copy', complete = true) => ({
  data: { fields: [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }], rows: [['1', 'Ottawa'], ['2', 'Hull']], total: complete ? 2 : null, complete },
  meta: { origin, snapshot: origin === 'copy' ? { id: SNAPSHOT } : undefined }
});

beforeEach(() => {
  vi.clearAllMocks();
  clearLocalTables();
  markEngaged();
});
afterEach(() => clearLocalTables());

describe('which tables come to the browser', () => {
  test('small prepared copies and CSV files; big copies, live tables and other formats stay on the server', () => {
    expect(localSource(copy())).toMatchObject({ origin: 'copy', snapshot: SNAPSHOT });
    expect(localSource(copy({ ingestion: { snapshot_id: SNAPSHOT, row_count: 60000, fields: [{ id: 'a' }] } }))).toBeNull();
    expect(localSource(copy({ ingestion: { snapshot_id: SNAPSHOT, row_count: 20000, fields: Array.from({ length: 11 }, (_, i) => ({ id: 'c' + i })) } }))).toBeNull();
    expect(localSource(copy({ ingestion: { row_count: 2, fields: [] } }))).toBeNull();
    expect(localSource(file())).toMatchObject({ origin: 'file', snapshot: null });
    expect(localSource(file({ format: 'XLSX' }))).toBeNull();
    expect(localSource({ id: 'live', query_mode: 'datastore' })).toBeNull();
  });
});

describe('loading a table into the browser', () => {
  test('a small copy arrives whole on the Table tab, pinned to its snapshot, and answers locally', async () => {
    fetchResourceRows.mockResolvedValue(rowsEnvelope());
    const { result } = renderHook(() => useLocalTable({ id: 'r1', resource: copy(), view: 'table', preview: null }));
    await waitFor(() => expect(result.current.table).not.toBeNull());
    expect(fetchResourceRows).toHaveBeenCalledWith('r1', expect.objectContaining({ snapshot: SNAPSHOT }));
    expect(result.current).toMatchObject({ interim: false, loading: false });
    expect(result.current.table.peek({ sort: 'name' }).records.map((r) => r.name)).toEqual(['Hull', 'Ottawa']);
  });

  test('nothing is fetched on the Chart or Map tab, and a table already held is reused', async () => {
    fetchResourceRows.mockResolvedValue(rowsEnvelope());
    const { result, rerender } = renderHook(({ view }) => useLocalTable({ id: 'r1', resource: copy(), view, preview: null }), {
      initialProps: { view: 'chart' }
    });
    await act(() => Promise.resolve());
    expect(fetchResourceRows).not.toHaveBeenCalled();
    rerender({ view: 'table' });
    await waitFor(() => expect(result.current.table).not.toBeNull());
    rerender({ view: 'chart' });
    expect(result.current.table).not.toBeNull();
    const second = renderHook(() => useLocalTable({ id: 'r1', resource: copy(), view: 'table', preview: null }));
    expect(second.result.current.table).not.toBeNull();
    expect(fetchResourceRows).toHaveBeenCalledTimes(1);
  });

  test('a table refused as too large is not asked again this session', async () => {
    fetchResourceRows.mockRejectedValue(new ApiError('too large', 413, { code: 'TABLE_TOO_LARGE' }));
    const first = renderHook(() => useLocalTable({ id: 'r1', resource: copy(), view: 'table', preview: null }));
    await waitFor(() => expect(fetchResourceRows).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(first.result.current.table).toBeNull();
    first.unmount();
    renderHook(() => useLocalTable({ id: 'r1', resource: copy(), view: 'table', preview: null }));
    await act(() => Promise.resolve());
    expect(fetchResourceRows).toHaveBeenCalledTimes(1);
  });

  test("a CSV's preview stands in until the whole file arrives, then stays as an interim table once the copy is canonical", async () => {
    let resolve;
    fetchResourceRows.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const preview = { fields: [{ id: 'name', type: 'TEXT' }], records: [{ name: 'Ottawa' }], truncated: true, sampledRows: 1 };
    const { result, rerender } = renderHook(({ resource }) => useLocalTable({ id: 'r1', resource, view: 'table', preview }), {
      initialProps: { resource: file() }
    });
    expect(result.current.table.origin).toBe('preview');
    expect(result.current.table.complete).toBe(false);
    expect(result.current.interim).toBe(false);
    await act(async () => resolve(rowsEnvelope('file', true)));
    expect(result.current.table.origin).toBe('file');
    expect(result.current.table.complete).toBe(true);
    // The copy is published: the file's rows answer as interim rows while the copy is read.
    fetchResourceRows.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ resource: copy() });
    expect(result.current.table.origin).toBe('file');
    expect(result.current).toMatchObject({ interim: true, loading: true });
  });

  test('a preview that read the whole file, every row of it, is complete', () => {
    const preview = { fields: [{ id: 'name', type: 'TEXT' }], records: [{ name: 'Ottawa' }, { name: 'Hull' }], truncated: false, sampledRows: 2 };
    fetchResourceRows.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useLocalTable({ id: 'r1', resource: file(), view: 'table', preview }));
    expect(result.current.table.complete).toBe(true);
    expect(result.current.table.peek({}).total).toBe(2);
    expect(result.current.table.fields[0]).toEqual({ id: '_id', type: 'int' });
  });
});

describe('holding the server while a table is on its way', () => {
  test('a read is due from the first render on the Table tab, and one that fails lets the server answer', async () => {
    fetchResourceRows.mockRejectedValue(new ApiError('busy', 503, { code: 'ROWS_BUSY' }));
    const { result } = renderHook(() => useLocalTable({ id: 'r1', resource: copy(), view: 'table', preview: null }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.table).toBeNull();
  });

  test('nothing is due on another tab', () => {
    const { result } = renderHook(() => useLocalTable({ id: 'r1', resource: copy(), view: 'chart', preview: null }));
    expect(result.current.loading).toBe(false);
  });
});
