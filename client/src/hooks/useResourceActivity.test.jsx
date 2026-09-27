import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import useResourceActivity from './useResourceActivity.js';
import { recordResourceActivity, prepareResource } from '../api/catalog.js';
import { ApiError, NotIngestedError } from '../api/client.js';

vi.mock('../api/catalog.js', () => ({ recordResourceActivity: vi.fn(), prepareResource: vi.fn() }));
const props = () => ({ id: 'a', resource: { query_mode: 'ingested', ingestion: { ingested_at: '2026-09-27' } }, active: true, onUnavailable: vi.fn() });
const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function visibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); visibility('visible'); recordResourceActivity.mockResolvedValue(null); });
afterEach(() => { vi.useRealTimers(); });

test('visible views renew immediately and every five minutes, once in StrictMode', async () => {
  const input = props();
  const view = renderHook(useResourceActivity, { initialProps: input, wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
  await advance(1);
  expect(recordResourceActivity).toHaveBeenCalledTimes(1);
  await advance(300000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(2);
  expect(prepareResource).not.toHaveBeenCalled();
  view.unmount();
  await advance(600000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(2);
});
test('hidden tabs and Map stop renewal; visibility and Table resume it', async () => {
  const input = props();
  const view = renderHook(useResourceActivity, { initialProps: input });
  await advance(1);
  act(() => visibility('hidden'));
  await advance(600000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(1);
  act(() => visibility('visible'));
  await advance(1);
  expect(recordResourceActivity).toHaveBeenCalledTimes(2);
  view.rerender({ ...input, active: false });
  await advance(600000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(2);
  view.rerender(input);
  await advance(1);
  expect(recordResourceActivity).toHaveBeenCalledTimes(3);
});
test('unprepared and live upstream resources send no keepalives', async () => {
  const input = props();
  const view = renderHook(useResourceActivity, { initialProps: { ...input, resource: { query_mode: 'ingestable' } } });
  await advance(600000);
  view.rerender({ ...input, resource: { query_mode: 'datastore' } });
  await advance(600000);
  expect(recordResourceActivity).not.toHaveBeenCalled();
});
test('expiry requests one metadata refresh and never admits preparation directly', async () => {
  recordResourceActivity.mockRejectedValue(new NotIngestedError('expired', 409));
  const input = props();
  renderHook(useResourceActivity, { initialProps: input });
  await advance(600000);
  act(() => visibility('hidden'));
  act(() => visibility('visible'));
  await advance(600000);
  expect(input.onUnavailable).toHaveBeenCalledTimes(1);
  expect(recordResourceActivity).toHaveBeenCalledTimes(1);
  expect(prepareResource).not.toHaveBeenCalled();
});
test('aborts old requests and ignores late responses after navigation', async () => {
  let fail;
  recordResourceActivity.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const input = props();
  const view = renderHook(useResourceActivity, { initialProps: input });
  await advance(1);
  const signal = recordResourceActivity.mock.calls[0][1].signal;
  view.rerender({ ...input, id: 'b' });
  await advance(1);
  await act(async () => fail(new NotIngestedError('expired', 409)));
  expect(signal.aborted).toBe(true);
  expect(input.onUnavailable).not.toHaveBeenCalled();
  expect(recordResourceActivity).toHaveBeenLastCalledWith('b', expect.any(Object));
});
test('honors Retry-After across visibility changes without a retry loop', async () => {
  recordResourceActivity.mockRejectedValueOnce(new ApiError('busy', 429, { retry_after: 600 }));
  renderHook(useResourceActivity, { initialProps: props() });
  await advance(1);
  act(() => visibility('hidden'));
  act(() => visibility('visible'));
  await advance(300000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(1);
  await advance(300000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(2);
});
test('a hung request is aborted and requests never overlap', async () => {
  recordResourceActivity.mockImplementation(() => new Promise((_resolve, reject) => {
    const signal = recordResourceActivity.mock.calls.at(-1)[1].signal;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  renderHook(useResourceActivity, { initialProps: props() });
  await advance(29999);
  expect(recordResourceActivity).toHaveBeenCalledTimes(1);
  await advance(2);
  expect(recordResourceActivity.mock.calls[0][1].signal.aborted).toBe(true);
  await advance(300000);
  expect(recordResourceActivity).toHaveBeenCalledTimes(2);
});
