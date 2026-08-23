import { useEffect } from 'react';
import { track } from '../utils/analytics.js';

function datasetProperties(element) {
  const properties = {};
  for (const [key, value] of Object.entries(element.dataset)) {
    if (!key.startsWith('analytics') || key === 'analyticsEvent') continue;
    const name = key.slice('analytics'.length);
    if (!name) continue;
    const snake = name[0].toLowerCase() + name.slice(1).replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
    properties[snake] = value;
  }
  return properties;
}

export default function AnalyticsBridge() {
  useEffect(() => {
    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const marked = target.closest('[data-analytics-event]');
      if (marked) track(marked.dataset.analyticsEvent, datasetProperties(marked));

      const anchor = target.closest('a[href]');
      if (!anchor) return;
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) {
          track('outbound_link', {
            host: url.host,
            path: url.pathname,
            label: (anchor.textContent || '').trim(),
          });
        }
      } catch {
        // Ignore malformed links; navigation remains untouched.
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
