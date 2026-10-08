import { useEffect, useState, useCallback } from 'react';

// The render-time key check hides a previous scope before the replacement
// effect starts. Cancellation also protects loading/error state from late work.
export default function useScopedOptions(scopeKey, load) {
  const [result, setResult] = useState({ scopeKey: null, data: [], status: 'loading' });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setResult({ scopeKey, data: [], status: 'loading' });
    Promise.resolve().then(() => load(controller.signal)).then(data => {
      if (!cancelled) setResult({ scopeKey, data, status: 'ready' });
    }).catch(() => {
      if (!cancelled) setResult({ scopeKey, data: [], status: 'error' });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [scopeKey, load, revision]);
  return { ...(result.scopeKey === scopeKey ? result : { data: [], status: 'loading' }), retry };
}
