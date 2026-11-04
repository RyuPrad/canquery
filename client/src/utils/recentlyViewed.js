// The datasets and files this browser opened lately, for the homepage's
// "Recently viewed" rail. The list stays in this browser (localStorage cq-recent)
// and is never sent anywhere; Clear empties it.
const KEY = 'cq-recent';
const MAX = 12;
const EVENT = 'cq-recent-change';
const PATH = /^\/(datasets|resources)\/[^/?#\s]{1,200}$/;

/** @typedef {{ kind: 'dataset' | 'resource', id: string, title: { en: string, fr: string }, path: string, at: number }} RecentView */

const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : '');

const DAY = 86400000;

// at is when the view happened; a time that cannot be one (stored by hand, or
// from a clock far ahead) reads as unknown (0) and the rail shows none.
/** @param {unknown} value @returns {RecentView | null} */
function clean(value) {
  if (!value || typeof value !== 'object') return null;
  const item = /** @type {Record<string, any>} */ (value);
  if (!['dataset', 'resource'].includes(item.kind) || typeof item.id !== 'string' || !item.id || item.id.length > 200) return null;
  if (typeof item.path !== 'string' || !PATH.test(item.path) || !item.path.startsWith(item.kind === 'dataset' ? '/datasets/' : '/resources/')) return null;
  const title = { en: text(item.title?.en), fr: text(item.title?.fr) };
  if (!title.en && !title.fr) return null;
  const at = Number(item.at);
  return { kind: item.kind, id: item.id, title, path: item.path, at: Number.isFinite(at) && at > 0 && at <= Date.now() + DAY ? at : 0 };
}

/** @returns {RecentView[]} */
export function readRecentlyViewed() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(list)) return [];
    // Each page once, as it was stored newest first.
    const seen = new Set();
    return list.map(clean).filter((item) => item && !seen.has(item.kind + ':' + item.id) && seen.add(item.kind + ':' + item.id)).slice(0, MAX);
  } catch {
    return [];
  }
}

/** @param {RecentView[]} list */
function write(list) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* Storage can be unavailable (private windows); nothing is remembered then. */
  }
}

/** @param {Omit<RecentView, 'at'>} view @param {number} [now] */
export function rememberView(view, now = Date.now()) {
  const item = clean({ ...view, at: now });
  if (!item) return;
  write([item, ...readRecentlyViewed().filter((other) => !(other.kind === item.kind && other.id === item.id))]);
}

export function clearRecentlyViewed() {
  write([]);
}

/** @param {() => void} onChange */
export function subscribeRecentlyViewed(onChange) {
  const storage = (event) => { if (event.key === KEY || event.key === null) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', storage); };
}
