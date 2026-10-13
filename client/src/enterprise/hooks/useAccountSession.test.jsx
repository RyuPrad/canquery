import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import useAccountSession from './useAccountSession.js';
import { hasAccountSession } from '../api/account.js';

vi.mock('../api/account.js', () => ({ hasAccountSession: vi.fn() }));
beforeEach(() => { hasAccountSession.mockReset().mockResolvedValue(false); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const visibility = state => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
};

test('rechecks a returning tab and a history restoration after session expiry without overlapping requests', async () => {
  hasAccountSession.mockResolvedValueOnce(true);
  const { result } = renderHook(() => useAccountSession());
  await waitFor(() => expect(result.current.status).toBe('authenticated'));
  let resolve;
  hasAccountSession.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => { visibility('hidden'); visibility('visible'); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); result.current.retry(); });
  expect(hasAccountSession).toHaveBeenCalledTimes(2);
  expect(result.current.checking).toBe(true);
  await act(async () => resolve(false));
  expect(result.current).toMatchObject({ status: 'anonymous', checking: false });
  hasAccountSession.mockResolvedValueOnce(true);
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await waitFor(() => expect(result.current.status).toBe('authenticated'));
});

test('hidden and unmounted lookups abort and cannot overwrite a newer result', async () => {
  let stale;
  hasAccountSession.mockImplementationOnce(() => new Promise(done => { stale = done; }));
  const { result, unmount } = renderHook(() => useAccountSession());
  const oldSignal = hasAccountSession.mock.calls[0][0].signal;
  act(() => visibility('hidden'));
  expect(oldSignal.aborted).toBe(true);
  act(() => visibility('visible'));
  await waitFor(() => expect(result.current.status).toBe('anonymous'));
  await act(async () => stale(true));
  expect(result.current.status).toBe('anonymous');
  hasAccountSession.mockImplementationOnce(() => new Promise(() => {}));
  act(() => result.current.retry());
  const lastSignal = hasAccountSession.mock.calls.at(-1)[0].signal;
  unmount();
  expect(lastSignal.aborted).toBe(true);
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  expect(hasAccountSession).toHaveBeenCalledTimes(3);
});

test('timeout aborts a stalled lookup, ignores its eventual response and allows retry', async () => {
  vi.useFakeTimers();
  let stale;
  hasAccountSession.mockImplementationOnce(() => new Promise(done => { stale = done; }));
  const { result } = renderHook(() => useAccountSession());
  const signal = hasAccountSession.mock.calls[0][0].signal;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(signal.aborted).toBe(true);
  expect(result.current).toMatchObject({ status: 'error', checking: false });
  await act(async () => { result.current.retry(); });
  expect(result.current.status).toBe('anonymous');
  await act(async () => stale(true));
  expect(result.current.status).toBe('anonymous');
});

test('disabled and hidden pages do not issue session requests', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { result, rerender } = renderHook(({ enabled }) => useAccountSession(enabled), { initialProps: { enabled: false } });
  rerender({ enabled: true });
  expect(hasAccountSession).not.toHaveBeenCalled();
  act(() => visibility('visible'));
  await waitFor(() => expect(result.current.status).toBe('anonymous'));
  expect(hasAccountSession).toHaveBeenCalledTimes(1);
});
