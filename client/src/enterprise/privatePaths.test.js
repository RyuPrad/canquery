import { afterEach, expect, test } from 'vitest';
import { startAnalytics } from '../analytics-init.js';

afterEach(() => { document.head.innerHTML = ''; });

test.each(['/account', '/login', '/signup', '/forgot-password', '/reset-password'])('does not initialize tracking on %s', pathname => {
  document.head.innerHTML = '<meta name="canquery-analytics-site" content="123e4567-e89b-42d3-a456-426614174000">';
  expect(startAnalytics(document, {}, { location: { pathname } })).toBe(false);
  expect(document.querySelector('script[src="/metrics.js"]')).toBeNull();
});
