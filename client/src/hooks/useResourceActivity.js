import { useEffect, useRef } from 'react';
import { recordResourceActivity } from '../api/catalog.js';
import { NotFoundError, NotIngestedError } from '../api/client.js';

const INTERVAL_MS = 5 * 60 * 1000;

// Functional retention only: no visitor identity, analytics event or job is
// created. Hidden views stop renewing, including when another tab is selected.
export default function useResourceActivity({ id, resource, active, onUnavailable }) {
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);
  const ready = resource?.query_mode === 'ingested';
  const snapshot = resource?.ingestion?.ingested_at;

  useEffect(() => {
    if (!id || !active || !ready) return;
    let timer;
    let deadline;
    let controller;
    let generation = 0;
    let unavailable = false;
    let nextAllowed = 0;
    const stop = () => {
      generation++;
      clearTimeout(timer);
      clearTimeout(deadline);
      controller?.abort();
    };
    const tick = async () => {
      if (document.visibilityState === 'hidden' || unavailable) return;
      const current = generation;
      controller = new AbortController();
      deadline = setTimeout(() => controller.abort(), 30000);
      let delay = INTERVAL_MS;
      try {
        await recordResourceActivity(id, { signal: controller.signal });
      } catch (error) {
        if (current !== generation) return;
        if (error instanceof NotIngestedError || error instanceof NotFoundError) {
          unavailable = true;
          onUnavailableRef.current?.();
          return;
        }
        if (Number.isFinite(error.retryAfter) && error.retryAfter > 0) {
          delay = Math.max(delay, error.retryAfter * 1000);
        }
        nextAllowed = Date.now() + delay;
      } finally {
        if (current === generation) clearTimeout(deadline);
      }
      if (current === generation && document.visibilityState !== 'hidden') timer = setTimeout(tick, delay);
    };
    const resume = () => {
      stop();
      // Deferral prevents a duplicate StrictMode mount request. A return to a
      // visible view renews immediately unless a server retry delay applies.
      if (document.visibilityState !== 'hidden' && !unavailable) {
        timer = setTimeout(tick, Math.max(0, nextAllowed - Date.now()));
      }
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => { stop(); document.removeEventListener('visibilitychange', resume); };
  }, [id, active, ready, snapshot]);
}
