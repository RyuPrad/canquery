export function formatRelativeTime(iso, lang = 'en') {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return lang === 'fr' ? 'à l’instant' : 'just now';
  // 'short' (not 'narrow'): French narrow drops "il y a" and renders "-26 min".
  const rtf = new Intl.RelativeTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    numeric: 'always',
    style: 'short',
  });
  const mins = Math.floor(secs / 60);
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA');
}

// Compact elapsed duration ("0:14", "1:23") for the in-flight load timer.
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
