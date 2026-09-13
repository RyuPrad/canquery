import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { clearRouteHead, readSeoElements, replaceSeoHead } from '../utils/routeHead.js';

export default function RouteHead() {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams();
  if (/^\/(datasets|organizations|places)(?:\/|$)/.test(pathname)) {
    for (const value of new URLSearchParams(search).getAll('page')) params.append('page', value);
  }
  const target = pathname + (params.size ? '?' + params.toString() : '');
  const previousPath = useRef(target);
  const siteOrigin = useRef(new URL(
    document.querySelector('link[rel="canonical"]')?.href || window.location.href
  ).origin);

  useEffect(() => {
    // The initial response already contains the authoritative server head.
    if (previousPath.current === target) return;
    previousPath.current = target;
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch(target, {
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    })
      .then(async response => {
        if (![200, 404, 503].includes(response.status) ||
            !response.headers.get('content-type')?.includes('text/html')) {
          throw new Error('No usable page metadata');
        }
        const html = await response.text();
        const elements = readSeoElements(html, response.url);
        if (!disposed && !controller.signal.aborted) replaceSeoHead(elements);
      })
      .catch(() => {
        if (!disposed) clearRouteHead(target, siteOrigin.current);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [target]);

  return null;
}
