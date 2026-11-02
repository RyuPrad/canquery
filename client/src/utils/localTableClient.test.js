import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// A stand-in for the module Web Worker, driven by the test.
class FakeWorker {
  constructor() {
    FakeWorker.created.push(this);
    this.sent = [];
  }
  postMessage(message) {
    this.sent.push(message);
  }
}
FakeWorker.created = [];

const FIELDS = [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }];
const source = (key) => ({
  key, fields: FIELDS, complete: true, origin: 'copy',
  rows: Array.from({ length: 6000 }, (_, i) => [String(i + 1), 'n' + (i % 97)])
});
const SORTED = { q: '', filters: {}, sort: 'name desc', offset: 0, limit: 50 };

let client;
beforeEach(async () => {
  FakeWorker.created = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
  client = await import('./localTableClient.js');
});
afterEach(() => vi.unstubAllGlobals());

describe('tables held in a Web Worker', () => {
  test('a large table is sent to the worker, and its answers come back from it', async () => {
    const handle = client.loadLocalTable(source('a'));
    const [worker] = FakeWorker.created;
    expect(worker.sent[0]).toMatchObject({ type: 'load' });
    expect(handle.peek(SORTED)).toBeUndefined();
    const answer = handle.query(SORTED);
    const asked = worker.sent[1];
    worker.onmessage({ data: { requestId: asked.requestId, result: { status: 'ok', records: [], total: 0 } } });
    await expect(answer).resolves.toMatchObject({ status: 'ok' });
  });

  test('a worker that fails to start leaves its tables answering on the page', async () => {
    const handle = client.loadLocalTable(source('a'));
    const [worker] = FakeWorker.created;
    const waiting = handle.query(SORTED);
    worker.onerror({ preventDefault() {} });
    await expect(waiting).resolves.toMatchObject({ status: 'ok' });
    expect(handle.peek(SORTED).records[0].name).toBe('n96');
    // Later tables start on the page.
    const next = client.loadLocalTable(source('b'));
    expect(FakeWorker.created).toHaveLength(1);
    expect(next.peek(SORTED).records[0].name).toBe('n96');
  });

  test('a worker that fails after loading a table answers its waiting and later queries with an error', async () => {
    const handle = client.loadLocalTable(source('a'));
    const [worker] = FakeWorker.created;
    worker.onmessage({ data: { type: 'loaded', tableId: worker.sent[0].tableId } });
    const waiting = handle.query(SORTED);
    worker.onerror({ preventDefault() {} });
    await expect(waiting).rejects.toThrow('table worker failed');
    await expect(handle.query({ ...SORTED, sort: 'name' })).rejects.toThrow('table worker failed');
  });
});
