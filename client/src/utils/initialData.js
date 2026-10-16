import { resourceResponse, queryResponse } from '../api/responseContracts.js';
import { normalizeResource } from '../api/resourceEnvelope.js';

// A direct visit to a resource page receives, inside its HTML, the metadata
// envelope and (for the unfiltered table view of a prepared copy) the first
// page of rows that the application would otherwise fetch one after the
// other. The explorer reads the block once, checks that it answers exactly
// this URL and resource, validates it like a fetched response, and removes
// it so a later navigation never reuses stale data.

export const INITIAL_DATA_ID = 'cq-initial';
const VERSION = 1;

/** @param {unknown} value @returns {value is Record<string, any>} */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @typedef {import('../api/contracts').InitialData} InitialData */

/** Parses the embedded block; null when absent or not what the server would send. @param {Document} [doc] @returns {InitialData | null} */
export function readInitialData(doc = document) {
  const element = doc.getElementById(INITIAL_DATA_ID);
  if (!element) return null;
  let payload;
  try {
    payload = JSON.parse(element.textContent || '');
  } catch {
    return null;
  }
  if (!record(payload) || payload.version !== VERSION || typeof payload.path !== 'string')
    return null;
  if (!record(payload.resource) || !resourceResponse(payload.resource)) return null;
  if (payload.rows !== null && (!record(payload.rows) || !queryResponse(payload.rows))) return null;
  if (payload.page !== null && !Number.isInteger(payload.page)) return null;
  return payload;
}

/**
 * The block's content for this explorer, or null when it answers another URL
 * or resource (the application then fetches as usual).
 * @param {{ id: string, location: { pathname: string, search: string }, doc?: Document }} options
 */
export function takeInitialData({ id, location, doc = document }) {
  const payload = readInitialData(doc);
  if (!payload || payload.path !== location.pathname + location.search) return null;
  if (payload.resource.data.id !== id) return null;
  return {
    resource: { ...payload.resource, data: normalizeResource(payload.resource.data) },
    rows: payload.rows,
    page: payload.page
  };
}

/** Removes the block; safe to call more than once. @param {Document} [doc] */
export function consumeInitialData(doc = document) {
  doc.getElementById(INITIAL_DATA_ID)?.remove();
}
