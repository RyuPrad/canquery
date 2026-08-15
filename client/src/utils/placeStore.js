const KEY = 'cq-place';

export function readPlace() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function writePlace(slug) {
  try {
    if (slug) localStorage.setItem(KEY, slug);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable in private browsing; the URL still works.
  }
}

export { KEY as PLACE_STORAGE_KEY };
