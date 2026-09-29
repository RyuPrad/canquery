import { describe, beforeEach, afterEach, vi, expect, test } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useJobPolling from './useJobPolling.js';
import { ApiError, NotFoundError } from '../api/client.js';

vi.mock('../api/catalog.js', () => ({ fetchJob: vi.fn() }));
import { fetchJob } from '../api/catalog.js';

const running = { data: { id: 7, status: 'running', age_seconds: 3 } };
const done = { data: { id: 7, status: 'done', age_seconds: 9 } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const tickAsync = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useJobPolling', () => {
  test('honors a rate-limit delay before resuming polling', async () => {
    fetchJob.mockRejectedValueOnce(new ApiError('Too many requests', 429, { retry_after: 30 })).mockResolvedValueOnce(done);
    const onDone = vi.fn();
    renderHook(() => useJobPolling(7, { onDone }));
    await tickAsync(0);
    await tickAsync(29999);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await tickAsync(1);
    expect(fetchJob).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('keeps a rate-limit delay across hidden and visible views', async () => {
    fetchJob.mockRejectedValueOnce(new ApiError('Too many requests', 429, { retry_after: 30 })).mockResolvedValueOnce(done);
    const view = renderHook(({ enabled }) => useJobPolling(7, { enabled }), { initialProps: { enabled: true } });
    await tickAsync(0);
    view.rerender({ enabled: false });
    await tickAsync(15000);
    view.rerender({ enabled: true });
    await tickAsync(14999);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await tickAsync(1);
    expect(fetchJob).toHaveBeenCalledTimes(2);
  });
  test('aborts hung requests and continues polling without overlapping requests', async () => {
    fetchJob.mockImplementationOnce((_id, { signal } = {}) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })).mockResolvedValueOnce(done);
    const onDone = vi.fn();
    const view = renderHook(() => useJobPolling(7, { onDone }));
    await tickAsync(0);
    await tickAsync(29999);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await tickAsync(1);
    expect(fetchJob.mock.calls[0][1]?.signal.aborted).toBe(true);
    await tickAsync(2000);
    expect(fetchJob).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('hiding the view aborts its active poll and ignores its late result', async () => {
    let finish;
    fetchJob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const onDone = vi.fn();
    const view = renderHook(({ enabled }) => useJobPolling(7, { enabled, onDone }), { initialProps: { enabled: true } });
    await tickAsync(0);
    const signal = fetchJob.mock.calls[0][1]?.signal;
    view.rerender({ enabled: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(done));
    expect(onDone).not.toHaveBeenCalled();
    expect(view.result.current.polling).toBe(false);
  });
  test('polls until the job is done, then reports it once', async () => {
    fetchJob.mockResolvedValueOnce(running).mockResolvedValueOnce(done);
    const onDone = vi.fn();
    const { result } = renderHook(() => useJobPolling(7, { onDone }));
    await tickAsync(0);
    expect(result.current.job.status).toBe('running');
    await tickAsync(2000);
    expect(result.current.job.status).toBe('done');
    expect(onDone).toHaveBeenCalledTimes(1);
    await tickAsync(6000);
    expect(fetchJob).toHaveBeenCalledTimes(2);
  });

  // Regression: a single transient failure (API restart during a deploy, a
  // network blip) used to stop polling for good, freezing the load indicator
  // even though the ingest finished. Transient errors keep the cadence now.
  test('keeps polling through a transient error', async () => {
    fetchJob
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(done);
    const onDone = vi.fn();
    const { result } = renderHook(() => useJobPolling(7, { onDone }));
    await tickAsync(0);
    await tickAsync(2000); // the failing tick
    expect(result.current.polling).toBe(true);
    await tickAsync(2000); // recovers on the next tick
    expect(result.current.job.status).toBe('done');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Regression: a parent passing inline callbacks (a new identity every
  // render) used to tear down and re-arm the polling effect, firing an
  // immediate extra fetch per parent render. Callbacks live in refs now.
  test('changing callback identity does not restart polling; the latest callback wins', async () => {
    fetchJob.mockResolvedValueOnce(running).mockResolvedValueOnce(done);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useJobPolling(7, { onDone: cb }), {
      initialProps: { cb: first },
    });
    await tickAsync(0);
    expect(fetchJob).toHaveBeenCalledTimes(1);
    rerender({ cb: second });
    await tickAsync(0); // a re-armed effect would fetch again immediately
    expect(fetchJob).toHaveBeenCalledTimes(1);
    await tickAsync(2000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  // Regression: a stale job id restored from localStorage after the queue was
  // cleaned 404s forever; the page showed an eternal spinner because only a
  // successful poll could clear the persisted state.
  test('stops on a vanished job and reports it via onGone', async () => {
    fetchJob.mockRejectedValue(new NotFoundError('Job not found', 404, null));
    const onGone = vi.fn();
    const { result } = renderHook(() => useJobPolling(7, { onGone }));
    await tickAsync(0);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(result.current.polling).toBe(false);
    await tickAsync(6000);
    expect(fetchJob).toHaveBeenCalledTimes(1);
  });
});
