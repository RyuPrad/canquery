import { useState, useEffect } from 'react';
import { fetchResourcePreview } from '../api/catalog.js';

// The first rows of a CSV that CanQuery can prepare but has not prepared yet,
// read from the start of the publisher's file, shown while the table is
// being prepared. One request per resource; a failure just keeps the plain
// preparation card, and the real table replaces the preview when it is ready.
export default function useResourcePreview({ id, enabled }) {
  const [state, setState] = useState({ id: null, preview: null, failed: false });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    fetchResourcePreview(id, { signal: controller.signal })
      .then((env) => {
        if (cancelled) return;
        setState({
          id,
          preview: {
            fields: env.data.fields,
            records: env.data.records,
            truncated: env.data.truncated,
            contentLength: env.data.content_length ?? null
          },
          failed: false
        });
      })
      .catch((error) => {
        if (cancelled || error?.name === 'AbortError') return;
        setState({ id, preview: null, failed: true });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, enabled]);
  const current = state.id === id;
  return { preview: current ? state.preview : null, failed: current && state.failed };
}
