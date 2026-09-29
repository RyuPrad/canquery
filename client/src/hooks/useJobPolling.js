import React from 'react';
import { fetchJob } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';

export default function useJobPolling(jobId, { intervalMs = 2000, onDone, onGone, enabled = true } = {}) {
  const [job, setJob] = React.useState(null);
  const [polling, setPolling] = React.useState(false);
  const retryWindowRef = React.useRef({ jobId, at: 0 });

  // The callbacks live in refs so a parent passing inline arrows (a new
  // identity every render) does not tear down and re-arm the polling effect -
  // each re-arm fires an immediate extra fetch. The tick reads the ref, so it
  // always sees the latest closure.
  const onDoneRef = React.useRef(onDone);
  const onGoneRef = React.useRef(onGone);
  React.useEffect(() => {
    if (retryWindowRef.current.jobId !== jobId) retryWindowRef.current = { jobId, at: 0 };
    onDoneRef.current = onDone;
    onGoneRef.current = onGone;
  });

  React.useEffect(() => {
    if (!jobId) {
        setJob(null);
        setPolling(false);
        return;
    }
    if (!enabled) { setPolling(false); return; }
    let cancelled = false;
    setPolling(true);
    let timer;
    let deadline;
    let controller;
    const tick = async () => {
      controller = new AbortController();
      deadline = setTimeout(() => controller.abort(), 30000);
      let delay = intervalMs;
      try {
        const env = await fetchJob(jobId, { signal: controller.signal });
        if (cancelled) return;
        retryWindowRef.current.at = 0;
        const j = env.data;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') {
          setPolling(false);
          if (onDoneRef.current) onDoneRef.current(j);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NotFoundError) {
          // The job row is gone (a stale id restored from localStorage after
          // the queue was cleaned): stop for good and let the caller drop its
          // persisted state instead of spinning forever.
          setPolling(false);
          if (onGoneRef.current) onGoneRef.current(jobId);
          return;
        }
        // Anything else is transient (API restart during a deploy, a network
        // blip): keep the cadence and pick the job back up on the next tick.
        if (Number.isFinite(err.retryAfter) && err.retryAfter > 0) delay = Math.max(delay, err.retryAfter * 1000);
        retryWindowRef.current.at = Date.now() + delay;
      } finally {
        clearTimeout(deadline);
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, Math.max(0, retryWindowRef.current.at - Date.now()));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      controller?.abort();
    };
  }, [jobId, intervalMs, enabled]);

  return { job, polling };
}
