import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import useResourcePreparation from './useResourcePreparation.js';
import { ApiError, NotFoundError } from '../api/client.js';
vi.mock('../api/catalog.js', () => ({ prepareResource: vi.fn(), fetchJob: vi.fn() }));
import { prepareResource, fetchJob } from '../api/catalog.js';

const resource = { id: 'hook-resource', query_mode: 'ingestable', preparation: { supported: true, enabled: true, freshness: 'unprepared' } };
const props = overrides => ({ id: resource.id, resource, active: true, needsLocal: false, onReady: vi.fn(), ...overrides });
const wrapper = ({ children }) => <StrictMode>{children}</StrictMode>;
const visibility = value => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  visibility('visible');
  prepareResource.mockResolvedValue({ data: { id: 901, status: 'pending' } });
  fetchJob.mockResolvedValue({ data: { id: 901, status: 'running' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); visibility('visible'); });

describe('automatic preparation lifecycle', () => {
  test('failed metadata displays its reason and waits through the cooldown without posting', async () => {
    vi.useFakeTimers();
    const retryAt = new Date(Date.now() + 30000).toISOString();
    const failed = { ...resource, preparation: { ...resource.preparation, state: 'failed',
      retry_at: retryAt, failure_reason: 'upstream_unavailable' } };
    const view = renderHook(useResourcePreparation, { initialProps: props({ resource: failed }), wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(view.result.current.phase).toBe('failed');
    expect(view.result.current.failureReason).toBe('upstream_unavailable');
    expect(view.result.current.retryAt).toBe(new Date(retryAt).getTime());
    expect(prepareResource).not.toHaveBeenCalled();
    await act(async () => { visibility('hidden'); await vi.advanceTimersByTimeAsync(31000); });
    expect(prepareResource).not.toHaveBeenCalled();
    await act(async () => { visibility('visible'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(prepareResource).toHaveBeenCalledTimes(1);
  });

  test('updated source metadata bypasses an old failure cooldown, including a stale serving copy', async () => {
    vi.useFakeTimers();
    const failed = { ...resource, query_mode: 'ingested', url: 'https://publisher.example/old.csv',
      ingestion: { ingested_at: '2026-09-30' }, preparation: { ...resource.preparation, freshness: 'stale',
        state: 'failed', retry_at: new Date(Date.now() + 86400000).toISOString(), failure_reason: 'invalid_file' } };
    const view = renderHook(useResourcePreparation, { initialProps: props({ resource: failed }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(prepareResource).not.toHaveBeenCalled();
    view.rerender(props({ resource: { ...failed, url: 'https://publisher.example/new.csv',
      preparation: { ...failed.preparation, state: 'ready', retry_at: null, failure_reason: null } } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(prepareResource).toHaveBeenCalledTimes(1);
    expect(view.result.current.failureReason).toBeNull();
  });

  test.each(['capacity', 'temporary', 'invalid_file', 'upstream_unavailable'])('polled failure exposes only the sanitized %s reason', async failureReason => {
    fetchJob.mockResolvedValue({ data: { id: 901, status: 'failed', failure_reason: failureReason,
      retry_at: new Date(Date.now() + 3600000).toISOString() } });
    const view = renderHook(useResourcePreparation, { initialProps: props() });
    await waitFor(() => expect(view.result.current.phase).toBe('failed'));
    expect(view.result.current.failureReason).toBe(failureReason);
    expect(prepareResource).toHaveBeenCalledTimes(1);
  });

  test('unknown failure reasons fall back without exposing private details', async () => {
    const failed = { ...resource, preparation: { ...resource.preparation, state: 'failed',
      retry_at: new Date(Date.now() + 3600000).toISOString(), failure_reason: 'SQL private details' } };
    const view = renderHook(useResourcePreparation, { initialProps: props({ resource: failed }) });
    await act(async () => {});
    expect(view.result.current.failureReason).toBeNull();
    expect(view.result.current.phase).toBe('failed');
    expect(prepareResource).not.toHaveBeenCalled();
  });

  test('a source update also bypasses a cooldown received from job polling', async () => {
    fetchJob.mockResolvedValueOnce({ data: { id: 901, status: 'failed', failure_reason: 'invalid_file',
      retry_at: new Date(Date.now() + 86400000).toISOString() } });
    const view = renderHook(useResourcePreparation, { initialProps: props() });
    await waitFor(() => expect(view.result.current.phase).toBe('failed'));
    view.rerender(props({ resource: { ...resource, last_modified: '2026-10-01T06:00:00Z' } }));
    await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(2));
    expect(view.result.current.failureReason).toBeNull();
  });

  test('automatically admits once under StrictMode and restores the shared job after remount', async () => {
    const first = renderHook(useResourcePreparation, { initialProps: props(), wrapper });
    await waitFor(() => expect(fetchJob).toHaveBeenCalled());
    expect(prepareResource).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = renderHook(useResourcePreparation, { initialProps: props(), wrapper });
    await waitFor(() => expect(fetchJob.mock.calls.length).toBeGreaterThan(1));
    expect(prepareResource).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  test('maps and live table views admit no jobs; opening Chart prepares the live resource', async () => {
    const view = renderHook(useResourcePreparation, { initialProps: props({ active: false }) });
    await act(async () => {});
    expect(prepareResource).not.toHaveBeenCalled();
    view.rerender(props({ resource: { ...resource, query_mode: 'datastore' } }));
    await act(async () => {});
    expect(prepareResource).not.toHaveBeenCalled();
    view.rerender(props({ resource: { ...resource, query_mode: 'datastore' }, needsLocal: true }));
    await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
  });

  test('prepared stale copies trigger refresh while current and unsupported copies do not', async () => {
    const loaded = { ...resource, query_mode: 'ingested', preparation: { supported: true, freshness: 'current' } };
    const view = renderHook(useResourcePreparation, { initialProps: props({ resource: loaded }) });
    await act(async () => {});
    expect(prepareResource).not.toHaveBeenCalled();
    view.rerender(props({ resource: { ...loaded, preparation: { supported: false, freshness: 'stale' } } }));
    await act(async () => {});
    expect(prepareResource).not.toHaveBeenCalled();
    view.rerender(props({ resource: { ...loaded, preparation: { supported: true, freshness: 'stale' } } }));
    await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
  });

  test('an already-prepared response refreshes metadata without polling a null ID', async () => {
    prepareResource.mockResolvedValue({ data: { id: null, already_loaded: true } });
    const input = props();
    renderHook(useResourcePreparation, { initialProps: input });
    await waitFor(() => expect(input.onReady).toHaveBeenCalledTimes(1));
    expect(fetchJob).not.toHaveBeenCalled();
    expect(localStorage.getItem('cq-unlock-job-' + resource.id)).toBeNull();
  });

  test('a completed server-discovered job is not repeatedly adopted from old metadata', async () => {
    const input = props({ resource: { ...resource, preparation: { ...resource.preparation, job_id: 901 } } });
    fetchJob.mockResolvedValue({ data: { id: 901, status: 'done' } });
    renderHook(useResourcePreparation, { initialProps: input });
    await waitFor(() => expect(input.onReady).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(input.onReady).toHaveBeenCalledTimes(1);
    expect(prepareResource).not.toHaveBeenCalled();
  });

  test('finishing a restored job does not POST again before metadata refreshes', async () => {
    localStorage.setItem('cq-unlock-job-' + resource.id, '901');
    fetchJob.mockResolvedValue({ data: { id: 901, status: 'done' } });
    const input = props();
    renderHook(useResourcePreparation, { initialProps: input });
    await waitFor(() => expect(input.onReady).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(prepareResource).not.toHaveBeenCalled();
  });

  test('hidden tabs pause admission and polling, then resume when visible', async () => {
    vi.useFakeTimers();
    visibility('hidden');
    renderHook(useResourcePreparation, { initialProps: props() });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(prepareResource).not.toHaveBeenCalled();
    await act(async () => { visibility('visible'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(prepareResource).toHaveBeenCalledTimes(1);
    await act(async () => { visibility('hidden'); });
    const before = fetchJob.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchJob).toHaveBeenCalledTimes(before);
    await act(async () => { visibility('visible'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(fetchJob.mock.calls.length).toBeGreaterThan(before);
  });

  test('a busy response waits for Retry-After and never retries in a hidden tab', async () => {
    vi.useFakeTimers();
    prepareResource.mockRejectedValueOnce(new ApiError('busy', 429, { retry_after: 30 }));
    renderHook(useResourcePreparation, { initialProps: props() });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(prepareResource).toHaveBeenCalledTimes(1);
    await act(async () => { visibility('hidden'); await vi.advanceTimersByTimeAsync(31000); });
    expect(prepareResource).toHaveBeenCalledTimes(1);
    await act(async () => { visibility('visible'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(prepareResource).toHaveBeenCalledTimes(2);
  });

  test('leaving before admission or before a response cannot update the departed page', async () => {
    const input = props();
    const quick = renderHook(useResourcePreparation, { initialProps: input });
    quick.unmount();
    await act(async () => {});
    expect(prepareResource).not.toHaveBeenCalled();
    let finish;
    prepareResource.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = renderHook(useResourcePreparation, { initialProps: input });
    await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
    pending.unmount();
    await act(async () => finish({ data: { already_loaded: true } }));
    expect(input.onReady).not.toHaveBeenCalled();
  });

  test('a job admitted while hidden is resumed without a second POST', async () => {
    let finish;
    prepareResource.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderHook(useResourcePreparation, { initialProps: props() });
    await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
    act(() => visibility('hidden'));
    await act(async () => finish({ data: { id: 901, status: 'pending' } }));
    expect(fetchJob).not.toHaveBeenCalled();
    act(() => visibility('visible'));
    await waitFor(() => expect(fetchJob).toHaveBeenCalledWith('901', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(prepareResource).toHaveBeenCalledTimes(1);
  });

  test('switching back from Map while a POST is in flight joins that request', async () => {
    let finish;
    prepareResource.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(useResourcePreparation, { initialProps: props() });
    await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
    view.rerender(props({ active: false }));
    view.rerender(props());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    await act(async () => finish({ data: { id: 901, status: 'pending' } }));
    await waitFor(() => expect(fetchJob).toHaveBeenCalled());
    expect(prepareResource).toHaveBeenCalledTimes(1);
  });

  test('a deleted persisted job is replaced without re-adopting obsolete metadata', async () => {
    fetchJob.mockRejectedValueOnce(new NotFoundError('gone', 404));
    prepareResource.mockResolvedValue({ data: { id: 902, status: 'pending' } });
    fetchJob.mockResolvedValue({ data: { id: 902, status: 'running' } });
    renderHook(useResourcePreparation, { initialProps: props({ resource: { ...resource, preparation: { ...resource.preparation, job_id: 901 } } }) });
    await waitFor(() => expect(fetchJob).toHaveBeenCalledWith(902, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(prepareResource).toHaveBeenCalledTimes(1);
    expect(fetchJob.mock.calls.filter(([id]) => id === 901)).toHaveLength(1);
  });
});

test('a completed preparation can run again after the observed ready copy expires', async () => {
  prepareResource.mockResolvedValue({ data: { already_loaded: true, id: null } });
  const input = props();
  const view = renderHook(useResourcePreparation, { initialProps: input });
  await waitFor(() => expect(input.onReady).toHaveBeenCalledTimes(1));
  view.rerender({ ...input, resource: { ...resource, query_mode: 'ingested', preparation: { supported: true, freshness: 'current' }, ingestion: { ingested_at: '2026-09-27' } } });
  await act(async () => {});
  view.rerender(input);
  await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(2));
  expect(input.onReady).toHaveBeenCalledTimes(2);
});
