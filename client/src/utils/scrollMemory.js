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
// saved position, 'top' starts a new page at the top, 'target' goes to the
// element the address's fragment names once the page has drawn it, 'stay'
// leaves it alone. A link to another page or to another catalogue page starts
// at the top, or at its fragment's element. An address a page rewrites over
// its own entry (a table page, a sort, a search, a filter) keeps the window
// where it is. Back and Forward return to where the visitor was. The first
// render returns there only after a reload or a Back/Forward visit that loaded
// the page again; a fresh visit keeps the place the browser chose, which is
// the top, or the passage a fragment or a search result's text fragment names
// (Google's "Read more" links and AI Overview citations use those).
/**
 * @param {{
 *   type: 'POP' | 'PUSH' | 'REPLACE',
 *   previous: { pathname: string, search: string } | null,
 *   next: { pathname: string, search: string, hash?: string },
 *   saved: boolean,
 *   documentRestored?: boolean
 * }} change
 * @returns {'restore' | 'top' | 'target' | 'stay'}
 */
export function scrollAction({ type, previous, next, saved, documentRestored = false }) {
  const start = hashId(next.hash) ? 'target' : 'top';
  if (!previous) {
    if (documentRestored) return saved ? 'restore' : 'top';
    return start === 'target' ? 'target' : 'stay';
  }
  // Only the hash or the history state changed: the browser or the page owns it.
  if (previous.pathname === next.pathname && previous.search === next.search) return 'stay';
  if (type === 'POP' && saved) return 'restore';
  if (previous.pathname !== next.pathname) return start;
  if (type === 'REPLACE') return 'stay';
  return pageParam(previous.search) !== pageParam(next.search) ? start : 'stay';
}

// The element id a fragment names, or '' for none (an empty or undecodable
// fragment). A text fragment (#:~:text=) never reaches location.hash.
/** @param {string | undefined} hash */
function hashId(hash) {
  if (!hash || hash.length < 2) return '';
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}

// Where the browser's own fragment navigation would put the window for the
// element `hash` names (its scroll-margin and the page's scroll-padding
// included), or null while the page has not drawn it.
/** @param {string} hash @returns {() => number | null} */
export function hashTarget(hash) {
  const id = hashId(hash);
  return () => {
    const element = id ? document.getElementById(id) : null;
    if (!element) return null;
    const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    return Math.max(0, Math.round(element.getBoundingClientRect().top + window.scrollY - margin - padding));
  };
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

// A fresh visit can arrive far down a page: a search result's link to a passage (a
// text fragment) makes the browser scroll the server's HTML to it before the
// application draws its own page, which is laid out differently. A page that is one
// long list keeps the passage in place: before its first draw it notes which item
// sat nearest the middle of the window, and after it moves the window so that its
// own item sits at the same height. `items` are in document order; null at the top
// of the page or when no item is on screen.
/**
 * @param {ArrayLike<Element>} items
 * @param {{ scrollY: number, innerHeight: number }} [win]
 * @returns {{ index: number, top: number } | null}
 */
export function itemOnScreen(items, win = window) {
  if (!(win.scrollY > 0) || !items.length) return null;
  const middle = win.innerHeight / 2;
  // The last item that starts at or above the middle of the window.
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const next = (low + high + 1) >> 1;
    if (items[next].getBoundingClientRect().top <= middle) low = next;
    else high = next - 1;
  }
  const box = items[low].getBoundingClientRect();
  return box.bottom > 0 && box.top < win.innerHeight ? { index: low, top: box.top } : null;
}

// Where an element's box starts in the window, from layout alone: a transform on an
// ancestor (a page that is still fading in) is not counted, as it is by
// getBoundingClientRect.
/** @param {HTMLElement} element @param {{ scrollY: number }} [win] */
export function layoutTop(element, win = window) {
  let y = 0;
  for (let node = element; node; node = /** @type {HTMLElement | null} */ (node.offsetParent)) y += node.offsetTop;
  return y - win.scrollY;
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
 * @param {Timing} [timing]
 */
export function restoreScroll(y, done, timing = {}) {
  return followScroll(() => y, true, done, timing);
}

// Goes to the element a fragment names as soon as the page draws it (as far
// as the page allows when it sits near the end), then holds it there while the
// page settles, like restoreScroll. A page that has not drawn the element
// after RESTORE_LIMIT_MS keeps the window where it is.
/**
 * @param {string} hash
 * @param {() => void} done
 * @param {Timing} [timing]
 */
export function followHash(hash, done, timing = {}) {
  return followScroll(hashTarget(hash), false, done, timing);
}

/** @typedef {{ now?: () => number, frame?: (step: () => void) => unknown, cancelFrame?: (handle: unknown) => void }} Timing */

/**
 * @param {() => number | null} target
 * @param {boolean} waitForRoom
 * @param {() => void} done
 * @param {Timing} timing
 */
function followScroll(target, waitForRoom, done, timing) {
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
  // Where the window should be now, or null while that cannot be reached: a
  // saved position waits for the page to be tall enough; a fragment's element
  // goes as far as the page allows.
  const wanted = (room) => {
    const y = target();
    if (y === null) return null;
    if (waitForRoom) return room >= y - 1 ? y : null;
    return Math.min(y, Math.max(0, room));
  };
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
      const y = wanted(room);
      if (y !== null) {
        window.scrollTo(0, y);
        reachedAt = lastChange = time;
        lastHeight = height;
      } else if (time - started >= RESTORE_LIMIT_MS) {
        // A page that came back shorter than it was goes as close as it
        // allows; a fragment whose element never came keeps the window.
        if (waitForRoom) window.scrollTo(0, Math.max(0, room));
        finish();
        return;
      }
    } else {
      // Only a change of the page's height moves it back: a visitor dragging
      // the scroll bar sends no event, and keeps the position they drag to.
      if (height !== lastHeight) {
        lastHeight = height;
        lastChange = time;
        const y = wanted(room);
        if (y !== null && Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
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
