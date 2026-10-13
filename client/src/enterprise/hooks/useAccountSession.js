import { useCallback, useEffect, useRef, useState } from 'react';
import { hasAccountSession } from '../api/account.js';

export default function useAccountSession(enabled = true) {
  const [status, setStatus] = useState('loading');
  const [checking, setChecking] = useState(enabled);
  const checkRef = useRef(null);
  const retry = useCallback(() => checkRef.current?.(), []);

  useEffect(() => {
    if (!enabled) return;
    let current = null;
    const cancel = () => {
      if (!current) return;
      const request = current;
      current = null;
      clearTimeout(request.timeout);
      request.controller.abort();
    };
    const check = () => {
      if (document.visibilityState === 'hidden' || current) return;
      setChecking(true);
      const request = { controller: new AbortController() };
      current = request;
      request.timeout = setTimeout(() => {
        if (current !== request) return;
        cancel();
        setStatus('error');
        setChecking(false);
      }, 15000);
      hasAccountSession({ signal: request.controller.signal }).then(authenticated => {
        if (current === request) setStatus(authenticated ? 'authenticated' : 'anonymous');
      }).catch(() => {
        if (current === request) setStatus('error');
      }).finally(() => {
        if (current !== request) return;
        clearTimeout(request.timeout);
        current = null;
        setChecking(false);
      });
    };
    const hide = () => { cancel(); setChecking(true); };
    const visibility = () => document.visibilityState === 'hidden' ? hide() : check();
    const restore = event => { if (event.persisted) check(); };
    checkRef.current = check;
    check();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => {
      checkRef.current = null;
      cancel();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
    };
  }, [enabled]);

  return { status, checking, retry };
}
