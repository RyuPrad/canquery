import { describe, beforeEach, afterEach, vi, expect, test } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useJobPolling from './useJobPolling.js';
import { NotFoundError } from '../api/client.js';

vi.mock('../api/catalog.js', () => ({ fetchJob: vi.fn() }));
import { fetchJob } from '../api/catalog.js';

const running = { data: { id: 7, status: 'running', age_seconds: 3 } };
const done = { data: { id: 7, status: 'done', age_seconds: 9 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const tickAsync = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useJobPolling', () => {
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
