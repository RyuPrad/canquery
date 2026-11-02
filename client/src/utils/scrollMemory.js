// Where the window was on each history entry, so Back, Forward and a reload
// return to it, and what the window does when the address changes.

const STORAGE_KEY = 'cq-scroll';
const MAX_ENTRIES = 100;
// A page that comes back from history may still be loading: the window waits
// this long for it to grow tall enough before giving up.
export const RESTORE_LIMIT_MS = 5000;
// Once there, the window holds the position while the page settles: a box that
// loads late above it would otherwise push the content down (or the browser's
// scroll anchoring would move the window). It holds until the page's height
// has not changed for SETTLE_MS, and at most SETTLE_LIMIT_MS.
export const SETTLE_MS = 1000;
export const SETTLE_LIMIT_MS = 3000;
// A visitor who scrolls, taps or types while a page is loading keeps the
// position they chose.
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

// Entries the router created carry their own key. The document's first entry
// shares the router's 'default' key with any other first entry, so its address
// tells it apart.
/** @param {{ key?: string, pathname: string, search: string, hash: string }} location */
export function entryKey(location) {
  return location.key && location.key !== 'default'
    ? location.key
    : 'default:' + location.pathname + location.search + location.hash;
}

/** @param {{ pathname: string, search: string }} location */
export const entryPath = (location) => location.pathname + location.search;

const pageParam = (search) => new URLSearchParams(search).get('page');

// What the window does when the address changes: 'restore' returns to the
// saved position, 'top' starts a new page at the top, 'stay' leaves it alone.
// A link to another page or to another catalogue page starts at the top. An
// address a page rewrites over its own entry (a table page, a sort, a search,
// a filter) keeps the window where it is. Back and Forward return to where the
// visitor was. The first render returns there only after a reload or a
// Back/Forward visit that loaded the page again.
/**
 * @param {{
 *   type: 'POP' | 'PUSH' | 'REPLACE',
 *   previous: { pathname: string, search: string } | null,
 *   next: { pathname: string, search: string },
 *   saved: boolean,
 *   documentRestored?: boolean
 * }} change
 * @returns {'restore' | 'top' | 'stay'}
 */
export function scrollAction({ type, previous, next, saved, documentRestored = false }) {
  if (!previous) return saved && documentRestored ? 'restore' : 'top';
  // Only the hash or the history state changed: the browser or the page owns it.
  if (previous.pathname === next.pathname && previous.search === next.search) return 'stay';
  if (type === 'POP' && saved) return 'restore';
  if (previous.pathname !== next.pathname) return 'top';
  if (type === 'REPLACE') return 'stay';
  return pageParam(previous.search) !== pageParam(next.search) ? 'top' : 'stay';
}

/** @returns {Storage | null} */
function sessionStore() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// Positions live in memory and are written to this tab's session storage when
// the page is hidden, so they survive a reload or a visit to another site.
/** @param {Storage | null} [storage] */
export function createScrollMemory(storage = sessionStore()) {
  /** @type {Map<string, { y: number, path: string }>} */
  const positions = new Map();
  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) {
      for (const entry of stored.slice(-MAX_ENTRIES)) {
        if (!Array.isArray(entry)) continue;
        const [key, y, path] = entry;
        if (typeof key === 'string' && Number.isFinite(y) && y >= 0 && typeof path === 'string') {
          positions.set(key, { y, path });
        }
      }
    }
  } catch {
    // Unreadable or blocked storage starts empty.
  }
  return {
    /** @param {string} key @param {string} path @returns {number | null} */
    get(key, path) {
      const position = positions.get(key);
      return position && position.path === path ? position.y : null;
    },
    /** @param {string} key @param {string} path @param {number} y */
    set(key, path, y) {
      positions.delete(key);
      positions.set(key, { y: Math.max(0, Math.round(y)), path });
      while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value);
    },
    /** @param {string} key */
    forget(key) {
      positions.delete(key);
    },
    save() {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...positions].map(([key, { y, path }]) => [key, y, path])));
      } catch {
        // Full or blocked storage keeps the positions for this document only.
      }
    }
  };
}

// True when this document was loaded by a reload or by Back/Forward, the only
// first loads that return to a saved position.
export function documentWasRestored() {
  try {
    const [entry] = performance.getEntriesByType('navigation');
    if (entry) return entry.type === 'reload' || entry.type === 'back_forward';
    const legacy = performance.navigation?.type;
    return legacy === 1 || legacy === 2;
  } catch {
    return false;
  }
}

// Scrolls to `y` as soon as the page is tall enough to show it, which can take
// a moment while a page that came back from history loads its content, then
// holds it while the page settles. Stops when the page has settled, after
// RESTORE_LIMIT_MS without getting there (as close as the page allows), or when
// the visitor takes over (where they are); then calls `done`. The returned
// function cancels it without calling `done`.
/**
 * @param {number} y
 * @param {() => void} done
 * @param {{ now?: () => number, frame?: (step: () => void) => unknown, cancelFrame?: (handle: unknown) => void }} [timing]
 */
export function restoreScroll(y, done, timing = {}) {
  const now = timing.now || (() => performance.now());
  const frame = timing.frame || ((step) => (window.requestAnimationFrame ? window.requestAnimationFrame(step) : setTimeout(step, 16)));
  const cancelFrame = timing.cancelFrame || ((handle) => (window.cancelAnimationFrame ? window.cancelAnimationFrame(handle) : clearTimeout(handle)));
  const started = now();
  let handle = null;
  let active = true;
  const release = () => {
    active = false;
    if (handle !== null) cancelFrame(handle);
    for (const type of TAKEOVER_EVENTS) window.removeEventListener(type, finish, true);
  };
  function finish() {
    if (!active) return;
    release();
    done();
  }
  let reachedAt = null;
  let lastHeight = 0;
  let lastChange = 0;
  const step = () => {
    handle = null;
    if (!active) return;
    const time = now();
    const height = document.documentElement.scrollHeight;
    const room = height - window.innerHeight;
    if (reachedAt === null) {
      if (room >= y - 1) {
        window.scrollTo(0, y);
        reachedAt = lastChange = time;
        lastHeight = height;
      } else if (time - started >= RESTORE_LIMIT_MS) {
        // The page came back shorter than it was: go as close as it allows.
        window.scrollTo(0, Math.max(0, room));
        finish();
        return;
      }
    } else {
      // Only a change of the page's height moves it back: a visitor dragging
      // the scroll bar sends no event, and keeps the position they drag to.
      if (height !== lastHeight) {
        lastHeight = height;
        lastChange = time;
        if (room >= y - 1 && Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
      }
      if (time - lastChange >= SETTLE_MS || time - reachedAt >= SETTLE_LIMIT_MS) {
        finish();
        return;
      }
    }
    handle = frame(step);
  };
  for (const type of TAKEOVER_EVENTS) window.addEventListener(type, finish, { capture: true, passive: true });
  step();
  return () => {
    if (active) release();
  };
}
