import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareResource } from '../api/catalog.js';
import useJobPolling from './useJobPolling.js';
import { readUnlockJob, writeUnlockJob, clearUnlockJob } from '../utils/unlockStore.js';
import { track } from '../utils/analytics.js';

// Share the POST across overlapping mounts; the server also deduplicates across
// tabs and visitors. A departing component never cancels somebody else's job.
const requests = new Map();
function requestPreparation(id) {
  if (!requests.has(id)) {
    const promise = prepareResource(id).then(env => {
      // Preserve an admitted job even if its original page is now hidden or
      // unmounted. A later visit can resume without another admission request.
      if (env.data?.id != null) writeUnlockJob(id, env.data.id);
      else if (env.data?.already_loaded) clearUnlockJob(id);
      return env;
    }).finally(() => { if (requests.get(id) === promise) requests.delete(id); });
    requests.set(id, promise);
  }
  return requests.get(id);
}

export default function useResourcePreparation({ id, resource, active, needsLocal, onReady }) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [jobId, setJobId] = useState(() => readUnlockJob(id));
  const [phase, setPhase] = useState(() => readUnlockJob(id) ? 'pending' : 'idle');
  const [retryAt, setRetryAt] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  const requested = useRef(null);
  const settled = useRef(new Set());
  const info = resource?.preparation;
  const supported = info?.supported ?? resource?.query_mode === 'ingestable';
  const enabled = info?.enabled !== false;
  const wanted = active && enabled && supported && (
    resource?.query_mode === 'ingestable' ||
    (resource?.query_mode === 'datastore' && needsLocal) ||
    (resource?.query_mode === 'ingested' && info && info.freshness !== 'current')
  );
  const key = JSON.stringify([id, resource?.ingestion?.ingested_at, resource?.last_modified, info?.freshness, attempt]);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const completed = useCallback(job => {
    // A restored job may finish before fresh metadata arrives. Keep the stale
    // metadata from starting another POST during that short hand-off.
    requested.current = key;
    if (job.id != null) settled.current.add(String(job.id));
    clearUnlockJob(id);
    setJobId(null);
    if (job.status === 'done') {
      setPhase('idle');
      setRetryAt(null);
      onReadyRef.current();
    } else {
      setPhase('failed');
      setRetryAt(job.retry_at ? new Date(job.retry_at).getTime() : Date.now() + 3600000);
    }
    track('resource_load', { resource_id: id, status: job.status, source: 'automatic' });
  }, [id, key]);
  const gone = useCallback(missingId => {
    settled.current.add(String(missingId));
    clearUnlockJob(id);
    setJobId(null);
    setPhase('idle');
    setAttempt(n => n + 1);
    onReadyRef.current();
  }, [id]);
  const { job } = useJobPolling(jobId, { enabled: active && visible, onDone: completed, onGone: gone });

  const discoveredJob = info?.job_id || readUnlockJob(id);
  useEffect(() => {
    if (!active || !visible || !discoveredJob || jobId || phase === 'failed' || settled.current.has(String(discoveredJob))) return;
    requested.current = key;
    setJobId(discoveredJob);
    setPhase('pending');
    writeUnlockJob(id, discoveredJob);
  }, [active, visible, discoveredJob, jobId, phase, id, key]);

  useEffect(() => {
    if (!wanted || !visible || jobId || requested.current === key || (retryAt && retryAt > Date.now())) return;
    let cancelled = false;
    let answered = false;
    // A deferred start lets StrictMode cleanup/navigation cancel an unopened
    // page before it admits work. Once admitted, server ownership takes over.
    const timer = setTimeout(() => {
      requested.current = key;
      setPhase('requesting');
      track('resource_load', { resource_id: id, status: 'requested', source: 'automatic' });
      requestPreparation(id).then(env => {
        if (cancelled) return;
        answered = true;
        if (env.data?.already_loaded) { completed({ status: 'done' }); return; }
        if (env.data?.id == null) throw new Error('Preparation did not return a job');
        writeUnlockJob(id, env.data.id);
        setJobId(env.data.id);
        setPhase('pending');
        setRetryAt(null);
      }).catch(error => {
        if (cancelled) return;
        answered = true;
        setPhase(error.status === 422 ? 'unavailable' : error.status === 429 && error.body?.code !== 'PREPARATION_COOLDOWN' ? 'waiting' : 'failed');
        setRetryAt(error.status === 422 ? null : Date.now() + (error.retryAfter || 60) * 1000);
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (!answered && requested.current === key) requested.current = null;
    };
  }, [wanted, visible, jobId, key, id, completed, retryAt]);

  const retry = useCallback(() => {
    if (retryAt && retryAt > Date.now()) return;
    setPhase('idle');
    setRetryAt(null);
    setAttempt(n => n + 1);
  }, [retryAt]);
  useEffect(() => {
    if (!wanted || !visible || !retryAt) return;
    const timer = setTimeout(retry, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [wanted, visible, retryAt, retry]);

  return { phase: job?.status === 'running' ? 'running' : phase, job, retry, retryAt,
    supported, enabled, working: ['requesting', 'pending', 'running'].includes(phase) };
}
