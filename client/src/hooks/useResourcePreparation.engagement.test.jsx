import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import useResourcePreparation from './useResourcePreparation.js';
import { isEngaged } from '../utils/engagement.js';
vi.mock('../api/catalog.js', () => ({ prepareResource: vi.fn(), fetchJob: vi.fn() }));
import { prepareResource, fetchJob } from '../api/catalog.js';

// Nobody has used the page in this file until its last test: engagement is
// page-wide and never resets, so the tests run in this order.
const resource = { id: 'quiet-resource', query_mode: 'ingestable', preparation: { supported: true, enabled: true, freshness: 'unprepared' } };
const props = overrides => ({ id: resource.id, resource, active: true, needsLocal: false, onReady: vi.fn(), ...overrides });
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  prepareResource.mockResolvedValue({ data: { id: 901, status: 'pending' } });
  fetchJob.mockResolvedValue({ data: { id: 901, status: 'running' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('a job somebody else started is joined and polled with nobody on the page', async () => {
  const joined = { ...resource, id: 'joined-resource', preparation: { ...resource.preparation, job_id: 901 } };
  const view = renderHook(useResourcePreparation, { initialProps: props({ id: joined.id, resource: joined }) });
  await waitFor(() => expect(fetchJob).toHaveBeenCalled());
  expect(prepareResource).not.toHaveBeenCalled();
  expect(view.result.current.awaitingVisitor).toBe(false);
  expect(isEngaged()).toBe(false);
});

test('a stale copy keeps serving while its refresh waits for a person', async () => {
  vi.useFakeTimers();
  const stale = { ...resource, id: 'stale-resource', query_mode: 'ingested', preparation: { supported: true, freshness: 'stale' } };
  const view = renderHook(useResourcePreparation, { initialProps: props({ id: stale.id, resource: stale }) });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(prepareResource).not.toHaveBeenCalled();
  expect(view.result.current).toMatchObject({ phase: 'idle', awaitingVisitor: true, working: false });
});

test('nothing is admitted until a person uses the page, then exactly one job starts', async () => {
  vi.useFakeTimers();
  const view = renderHook(useResourcePreparation, { initialProps: props() });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(prepareResource).not.toHaveBeenCalled();
  expect(view.result.current).toMatchObject({ phase: 'idle', awaitingVisitor: true, working: false });
  await act(async () => { view.result.current.start(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(isEngaged()).toBe(true);
  expect(prepareResource).toHaveBeenCalledTimes(1);
  expect(prepareResource).toHaveBeenCalledWith(resource.id);
  expect(view.result.current.awaitingVisitor).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(prepareResource).toHaveBeenCalledTimes(1);
});
