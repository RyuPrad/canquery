import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchResource } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import { track } from '../utils/analytics.js';
import { rememberResource } from '../utils/resourceHints.js';

// `initial` is the metadata envelope embedded in the page's HTML on a direct
// visit: it replaces the first request only; every reload fetches.
export default function useResourceMetadata(id, { initial = null } = {}) {
  const [resource, setResource] = useState(() => initial?.data ?? null);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const opened = useRef(false);
  useEffect(() => {
    if (revision === 0 && initial) {
      if (opened.current) return undefined;
      opened.current = true;
      rememberResource(initial.data);
      track('resource_open', {
        resource_id: initial.data.id,
        dataset_id: initial.data.dataset?.id || '',
        format: initial.data.format || '',
        query_mode: initial.data.query_mode || '',
        source: 'inline'
      });
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    fetchResource(id, { signal: controller.signal })
      .then((env) => {
        if (cancelled) return;
        rememberResource(env.data);
        setResource(env.data);
        setError(null);
        track('resource_open', {
          resource_id: env.data.id,
          dataset_id: env.data.dataset?.id || '',
          format: env.data.format || '',
          query_mode: env.data.query_mode || '',
          source: 'page'
        });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof NotFoundError) setNotFound(true);
        else setError(error);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, revision, initial]);
  return { resource, error, notFound, reload, revision };
}
