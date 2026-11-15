import { fetchPortalDirectory, portalDirectoryResponse } from '../api/portals.js';
import { INITIAL_DATA_ID } from './initialData.js';

// The portal directory the page has read, kept for the visit. A direct visit
// starts from the block in its HTML (the same answer the JSON route gives), so
// the page draws at once; coming back to the page reuses what is here. A
// directory older than five minutes is still shown, and asked for again behind
// the page.

const FRESH_MS = 5 * 60 * 1000;
const VERSION = 1;
let directory = null; // { data, at }
let request = null;

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The directory already here, or null: only while it is fresh, unless `stale` allows an older one.
 * @param {number} [now] @param {{ stale?: boolean }} [options]
 */
export function peekPortalDirectory(now = Date.now(), { stale = false } = {}) {
  return directory && (stale || now - directory.at < FRESH_MS) ? directory.data : null;
}

/** The directory, from here when fresh, otherwise from the server (one request at a time). */
export function loadPortalDirectory() {
  const known = peekPortalDirectory();
  if (known) return Promise.resolve(known);
  if (!request) {
    request = fetchPortalDirectory()
      .then((envelope) => {
        directory = { data: envelope.data, at: Date.now() };
        return envelope.data;
      })
      .finally(() => {
        request = null;
      });
  }
  return request;
}

/**
 * Reads the block a direct visit carries, when it answers exactly this
 * address, and keeps what it holds. Returns whether it did.
 * @param {{ location: { pathname: string, search: string }, doc?: Document }} options
 */
export function takePortalInitialData({ location, doc = document }) {
  const element = doc.getElementById(INITIAL_DATA_ID);
  if (!element) return false;
  let payload;
  try {
    payload = JSON.parse(element.textContent || '');
  } catch {
    return false;
  }
  if (!record(payload) || payload.version !== VERSION || payload.kind !== 'portals') return false;
  if (payload.path !== location.pathname + location.search) return false;
  if (!record(payload.directory) || !portalDirectoryResponse(payload.directory)) return false;
  directory = { data: payload.directory.data, at: Date.now() };
  return true;
}

/** Forgets everything (tests). */
export function resetPortalData() {
  directory = null;
  request = null;
}
