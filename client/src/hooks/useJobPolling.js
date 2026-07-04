import React from 'react';
import { fetchJob } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';

export default function useJobPolling(jobId, { intervalMs = 2000, onDone, onGone } = {}) {
  const [job, setJob] = React.useState(null);
  const [polling, setPolling] = React.useState(false);

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
          if (onDone) onDone(j);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NotFoundError) {
          // The job row is gone (a stale id restored from localStorage after
          // the queue was cleaned): stop for good and let the caller drop its
          // persisted state instead of spinning forever.
          setPolling(false);
          if (onGone) onGone();
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
  }, [jobId, intervalMs, onDone, onGone]);

  return { job, polling };
}
