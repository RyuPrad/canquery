import { useState, useCallback, useEffect } from 'react';
import { fetchResource } from '../api/catalog.js';
import { NotFoundError } from '../api/client.js';
import { track } from '../utils/analytics.js';

export default function useResourceMetadata(id) {
  const [resource, setResource] = useState(null);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchResource(id, { signal: controller.signal })
      .then((env) => {
        if (cancelled) return;
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
  }, [id, revision]);
  return { resource, error, notFound, reload, revision };
}
