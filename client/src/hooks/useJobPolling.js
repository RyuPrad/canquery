import React from 'react';
import { fetchJob } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';

export default function useJobPolling(jobId, { intervalMs = 2000, onDone, onGone } = {}) {
  const [job, setJob] = React.useState(null);
  const [polling, setPolling] = React.useState(false);

  // The callbacks live in refs so a parent passing inline arrows (a new
  // identity every render) does not tear down and re-arm the polling effect -
  // each re-arm fires an immediate extra fetch. The tick reads the ref, so it
  // always sees the latest closure.
  const onDoneRef = React.useRef(onDone);
  const onGoneRef = React.useRef(onGone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
    onGoneRef.current = onGone;
  });

  React.useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let cancelled = false;
    setPolling(true);
    let timer;
    const tick = async () => {
      try {
        const env = await fetchJob(jobId);
        if (cancelled) return;
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
          if (onGoneRef.current) onGoneRef.current();
          return;
        }
        // Anything else is transient (API restart during a deploy, a network
        // blip): keep the cadence and pick the job back up on the next tick.
      }
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  return { job, polling };
}
