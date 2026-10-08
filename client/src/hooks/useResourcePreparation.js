import { useCallback, useEffect, useRef, useState, useReducer } from 'react';
import { prepareResource } from '../api/catalog.js';
import useJobPolling from './useJobPolling.js';
import { readUnlockJob, writeUnlockJob, clearUnlockJob } from '../utils/unlockStore.js';
import { track } from '../utils/analytics.js';
import {
  initialPreparationState,
  preparationReducer,
  publicReason,
  retryTime
} from './preparationState.js';

// Share the POST across overlapping mounts; the server also deduplicates across
// tabs and visitors. A departing component never cancels somebody else's job.
const requests = new Map();
function requestPreparation(id) {
  if (!requests.has(id)) {
    const promise = prepareResource(id)
      .then((env) => {
        // Preserve an admitted job even if its original page is now hidden or
        // unmounted. A later visit can resume without another admission request.
        if (env.data?.id != null) writeUnlockJob(id, env.data.id);
        else if (env.data?.already_loaded) clearUnlockJob(id);
        return env;
      })
      .finally(() => {
        if (requests.get(id) === promise) requests.delete(id);
      });
    requests.set(id, promise);
  }
  return requests.get(id);
}

export default function useResourcePreparation({ id, resource, active, needsLocal, onReady }) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [{ jobId, phase, retryAt, failureReason, attempt }, dispatch] = useReducer(
    preparationReducer,
    id,
    (resourceId) => initialPreparationState(readUnlockJob(resourceId))
  );
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const requested = useRef(null);
  const settled = useRef(new Set());
  const metadataFailure = useRef(null);
  const info = resource?.preparation;
  const supported = info?.supported ?? resource?.query_mode === 'ingestable';
  const enabled = info?.enabled !== false;
  const wanted =
    active &&
    enabled &&
    supported &&
    (resource?.query_mode === 'ingestable' ||
      (resource?.query_mode === 'datastore' && needsLocal) ||
      (resource?.query_mode === 'ingested' && info && info.freshness !== 'current'));
  const sourceKey = JSON.stringify([
    id,
    resource?.url,
    resource?.format,
    resource?.size_bytes,
    resource?.last_modified,
    resource?.ingestion?.ingested_at,
    info?.freshness
  ]);
  const key = JSON.stringify([sourceKey, attempt]);
  const metadataRetryAt = info?.state === 'failed' ? retryTime(info.retry_at) : null;
  const metadataReason = publicReason(info?.failure_reason);
  const failureKey = metadataRetryAt
    ? JSON.stringify([sourceKey, metadataRetryAt, metadataReason])
    : null;
  const observedSource = useRef(sourceKey);

  useEffect(() => {
    if (observedSource.current !== sourceKey && phase === 'failed' && !metadataRetryAt) {
      requested.current = null;
      dispatch({ type: 'SOURCE_CHANGED' });
    }
    observedSource.current = sourceKey;
  }, [sourceKey, phase, metadataRetryAt]);

  useEffect(() => {
    // Metadata already describes a failed attempt for this source version.
    // Show its cooldown without making another admission request. A source
    // update clears that failure on the server and can be prepared immediately.
    if (failureKey && metadataRetryAt > Date.now()) {
      metadataFailure.current = failureKey;
      dispatch({ type: 'METADATA_FAILED', retryAt: metadataRetryAt, reason: metadataReason });
    } else if (!failureKey && metadataFailure.current) {
      metadataFailure.current = null;
      requested.current = null;
      dispatch({ type: 'SOURCE_CHANGED' });
    }
  }, [failureKey, metadataRetryAt, metadataReason]);

  useEffect(() => {
    // Once publication is visible, a later eviction is a new preparation
    // lifecycle even if its unprepared metadata matches the original visit.
    if (resource?.query_mode === 'ingested' && info?.freshness === 'current' && !jobId) {
      requested.current = null;
      dispatch({ type: 'READY_COPY' });
    }
  }, [resource?.query_mode, info?.freshness, jobId]);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const completed = useCallback(
    (job) => {
      // A restored job may finish before fresh metadata arrives. Keep the stale
      // metadata from starting another POST during that short hand-off.
      requested.current = key;
      if (job.id != null) settled.current.add(String(job.id));
      clearUnlockJob(id);
      if (job.status === 'done') {
        dispatch({ type: 'JOB_COMPLETED' });
        onReadyRef.current();
      } else {
        dispatch({
          type: 'JOB_FAILED',
          retryAt: retryTime(job.retry_at) ?? Date.now() + 3600000,
          reason: job.failure_reason
        });
      }
      track('resource_load', { resource_id: id, status: job.status, source: 'automatic' });
    },
    [id, key]
  );
  const gone = useCallback(
    (missingId) => {
      settled.current.add(String(missingId));
      clearUnlockJob(id);
      dispatch({ type: 'JOB_GONE' });
      onReadyRef.current();
    },
    [id]
  );
  const { job } = useJobPolling(jobId, {
    enabled: active && visible,
    onDone: completed,
    onGone: gone
  });

  const discoveredJob = info?.job_id || readUnlockJob(id);
  useEffect(() => {
    if (
      !active ||
      !visible ||
      !discoveredJob ||
      jobId ||
      phase === 'failed' ||
      settled.current.has(String(discoveredJob))
    )
      return;
    requested.current = key;
    dispatch({ type: 'JOB_ADOPTED', jobId: discoveredJob });
    writeUnlockJob(id, discoveredJob);
  }, [active, visible, discoveredJob, jobId, phase, id, key]);

  useEffect(() => {
    if (
      !wanted ||
      !visible ||
      jobId ||
      requested.current === key ||
      (retryAt && retryAt > Date.now()) ||
      (metadataRetryAt && metadataRetryAt > Date.now())
    )
      return;
    let cancelled = false;
    let answered = false;
    // A deferred start lets StrictMode cleanup/navigation cancel an unopened
    // page before it admits work. Once admitted, server ownership takes over.
    const timer = setTimeout(() => {
      requested.current = key;
      dispatch({ type: 'ADMISSION_STARTED' });
      track('resource_load', { resource_id: id, status: 'requested', source: 'automatic' });
      requestPreparation(id)
        .then((env) => {
          if (cancelled) return;
          answered = true;
          if (env.data?.already_loaded) {
            completed({ status: 'done' });
            return;
          }
          if (env.data?.id == null) throw new Error('Preparation did not return a job');
          writeUnlockJob(id, env.data.id);
          dispatch({ type: 'JOB_ADOPTED', jobId: env.data.id });
        })
        .catch((error) => {
          if (cancelled) return;
          answered = true;
          dispatch({
            type: 'ADMISSION_REJECTED',
            phase:
              error.status === 422
                ? 'unavailable'
                : error.status === 429 && error.body?.code !== 'PREPARATION_COOLDOWN'
                  ? 'waiting'
                  : 'failed',
            retryAt: error.status === 422 ? null : Date.now() + (error.retryAfter || 60) * 1000,
            reason: error.body?.failure_reason
          });
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (!answered && requested.current === key) requested.current = null;
    };
  }, [wanted, visible, jobId, key, id, completed, retryAt, metadataRetryAt]);

  const retry = useCallback(() => {
    if (retryAt && retryAt > Date.now()) return;
    dispatch({ type: 'RETRY_DUE' });
  }, [retryAt]);
  useEffect(() => {
    if (!wanted || !visible || !retryAt) return;
    const timer = setTimeout(retry, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [wanted, visible, retryAt, retry]);

  return {
    phase: job?.status === 'running' ? 'running' : phase,
    job,
    retry,
    retryAt,
    failureReason,
    supported,
    enabled,
    working: ['requesting', 'pending', 'running'].includes(phase)
  };
}
