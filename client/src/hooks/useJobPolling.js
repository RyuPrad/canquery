import React from 'react';
import { fetchJob } from '../api/catalog.js';

export default function useJobPolling(jobId, { intervalMs = 2000, onDone } = {}) {
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
      } catch {
        if (cancelled) return;
        setPolling(false);
        return;
      }
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, intervalMs, onDone]);

  return { job, polling };
}
