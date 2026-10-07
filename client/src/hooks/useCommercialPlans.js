import { useCallback, useEffect, useState } from 'react';
import { accountRequest } from '../api/account.js';

export default function useCommercialPlans(enabled = true) {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    accountRequest('/plans', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setPlans(value); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [enabled, reload]);
  const retry = useCallback(() => { setError(false); setReload(value => value + 1); }, []);
  return { plans, error, retry };
}
