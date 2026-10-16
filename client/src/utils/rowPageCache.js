// Pages of a resource table, kept for the life of the application so a page
// the visitor already saw, or the page prefetched behind the current one,
// appears without a request. Prepared copies are immutable and identified by
// a snapshot id, so an entry is valid as long as its snapshot id matches the
// one the current metadata reports. Live (DataStore) pages carry no snapshot
// id and expire after a minute, well inside the server's own proxy cache.
//
// A request in flight is shared: a reader that arrives while it runs joins it
// instead of starting another, and the request is only aborted once nobody
// waits for it any more, decided one microtask later so a reader that leaves
// and one that joins in the same React commit never cancel each other.

export const MAX_ENTRIES = 32;
export const MAX_BYTES = 6 * 1024 * 1024;
export const LIVE_TTL_MS = 60 * 1000;
export const PREFETCH_PAUSE_MS = 60 * 1000;

/** @typedef {import('../api/contracts').RowPage} RowPage */
/** @typedef {{ data: RowPage, snapshotId: string | null }} Loaded */
/** @typedef {'network' | 'inline'} Source */
/**
 * @typedef {object} Entry
 * @property {string} id
 * @property {string} key
 * @property {RowPage | null} data
 * @property {string | null} snapshotId snapshot the stored page came from
 * @property {string | null} pin snapshot the request asked for
 * @property {Source} source
 * @property {number} storedAt
 * @property {number} bytes
 * @property {Promise<Loaded> | null} promise
 * @property {AbortController | null} controller
 * @property {number} subscribers
 */
/** @typedef {{ promise: Promise<Loaded>, release: () => void, pin: string | null }} Handle */

/** @type {Map<string, Entry>} */
const entries = new Map();
let pausedUntil = 0;

/** @param {{ id: string, q?: string | null, filters?: Record<string, { op: string, value: string }> | null, sort?: string | null, page: number }} parts */
export function pageKey({ id, q, filters, sort, page }) {
  const active = filters || {};
  const normalized = Object.keys(active)
    .sort()
    .map((column) => [column, active[column].op, active[column].value]);
  return JSON.stringify([id, q || '', normalized, sort || '', page]);
}

/** @param {Entry} entry @param {string | null | undefined} snapshotId */
function fresh(entry, snapshotId) {
  if (!entry.data) return false;
  if (snapshotId != null) return entry.snapshotId === snapshotId;
  return entry.snapshotId != null || Date.now() - entry.storedAt < LIVE_TTL_MS;
}

/** @param {RowPage} data */
function estimate(data) {
  try {
    return JSON.stringify(data.records).length;
  } catch {
    return 0;
  }
}

function evict() {
  let bytes = 0;
  for (const entry of entries.values()) bytes += entry.bytes;
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    if (entry.promise) continue;
    entries.delete(key);
    bytes -= entry.bytes;
  }
}

/** @param {string} key @param {{ id: string, data: RowPage, snapshotId: string | null, pin: string | null, source: Source }} page */
function store(key, { id, data, snapshotId, pin, source }) {
  /** @type {Entry} */
  const entry = {
    id,
    key,
    data,
    snapshotId,
    pin,
    source,
    storedAt: Date.now(),
    bytes: estimate(data),
    promise: null,
    controller: null,
    subscribers: 0
  };
  entries.delete(key);
  entries.set(key, entry);
  evict();
  return entry;
}

/** Pure read for render time. @param {string} key @param {string | null} [snapshotId] */
export function peek(key, snapshotId = null) {
  const entry = entries.get(key);
  return entry && fresh(entry, snapshotId) ? entry.data : null;
}

/** @param {string} key @param {string | null} [snapshotId] @returns {Source | null} */
export function peekSource(key, snapshotId = null) {
  const entry = entries.get(key);
  return entry && fresh(entry, snapshotId) ? entry.source : null;
}

/** Marks a page as recently used. @param {string} key */
export function touch(key) {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  entries.set(key, entry);
}

/** @param {string} key @param {{ id: string, data: RowPage, snapshotId: string | null, source?: Source }} page */
export function seed(key, { id, data, snapshotId, source = 'inline' }) {
  store(key, { id, data, snapshotId, pin: snapshotId, source });
}

/** @param {Entry} entry */
function release(entry) {
  entry.subscribers -= 1;
  if (entry.subscribers > 0) return;
  queueMicrotask(() => {
    if (entry.subscribers > 0 || entries.get(entry.key) !== entry || entry.data) return;
    entry.controller?.abort();
    entries.delete(entry.key);
  });
}

/**
 * Returns the stored page, joins the request in flight for it, or starts one.
 * @param {string} key
 * @param {{ id: string, snapshotId?: string | null, fetch: (signal: AbortSignal) => Promise<Loaded> }} options
 * @returns {Handle}
 */
export function load(key, { id, snapshotId = null, fetch }) {
  const existing = entries.get(key);
  if (existing && fresh(existing, snapshotId) && existing.data) {
    touch(key);
    return {
      promise: Promise.resolve({ data: existing.data, snapshotId: existing.snapshotId }),
      release: () => {},
      pin: existing.pin
    };
  }
  if (existing && existing.promise) {
    existing.subscribers += 1;
    return { promise: existing.promise, release: () => release(existing), pin: existing.pin };
  }
  const controller = new AbortController();
  /** @type {Entry} */
  const entry = {
    id,
    key,
    data: null,
    snapshotId: null,
    pin: snapshotId,
    source: 'network',
    storedAt: 0,
    bytes: 0,
    promise: null,
    controller,
    subscribers: 1
  };
  entry.promise = fetch(controller.signal).then(
    (loaded) => {
      if (entries.get(key) === entry) {
        store(key, {
          id,
          data: loaded.data,
          snapshotId: loaded.snapshotId,
          pin: snapshotId,
          source: 'network'
        });
      }
      return loaded;
    },
    (error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }
  );
  entries.set(key, entry);
  return { promise: entry.promise, release: () => release(entry), pin: snapshotId };
}

/** @param {number} ms */
export function pausePrefetch(ms) {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

export function prefetchPaused() {
  return Date.now() < pausedUntil;
}

/**
 * Loads a page nobody is looking at yet. Errors never surface; a rate limit
 * or any other failure pauses further prefetching for a while.
 * @param {string} key
 * @param {{ id: string, snapshotId?: string | null, fetch: (signal: AbortSignal) => Promise<Loaded> }} options
 * @returns {() => void} releases the prefetch; it is aborted unless a reader joined it
 */
export function prefetch(key, options) {
  if (prefetchPaused()) return () => {};
  const existing = entries.get(key);
  if (existing && (existing.promise || fresh(existing, options.snapshotId))) return () => {};
  const handle = load(key, options);
  handle.promise.catch((/** @type {{ name?: string, retryAfter?: number | null }} */ error) => {
    if (error?.name === 'AbortError') return;
    const retryAfter = Number(error?.retryAfter);
    pausePrefetch(retryAfter > 0 ? retryAfter * 1000 : PREFETCH_PAUSE_MS);
  });
  return handle.release;
}

/** Drops every page and request of one resource. @param {string} id */
export function invalidate(id) {
  for (const [key, entry] of entries) {
    if (entry.id !== id) continue;
    entry.controller?.abort();
    entries.delete(key);
  }
}

export function clear() {
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
  pausedUntil = 0;
}

export function size() {
  return entries.size;
}
