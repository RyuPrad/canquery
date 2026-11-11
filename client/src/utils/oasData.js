import { fetchOasSummary, fetchOasTable, oasSummaryResponse, oasTableResponse } from '../api/oas.js';
import { INITIAL_DATA_ID } from './initialData.js';

// What the OAS amounts pages have read, kept for the visit: the summary of the
// quarter shown and each table asked for. A direct visit starts from the block in
// its HTML (the same answers the JSON routes give), so the page draws at once; moving
// between the hub, a table and the other language then reuses what is here instead
// of loading again. A summary is asked for again after five minutes.

const FRESH_MS = 5 * 60 * 1000;
const VERSION = 1;
let summary = null; // { data, at }
let summaryRequest = null;
const tables = new Map(); // "period:table" -> data
const tableRequests = new Map();

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const tableKey = (period, table) => period + ':' + table;

/** The summary already here and still fresh, or null. @param {number} [now] */
export function peekOasSummary(now = Date.now()) {
  return summary && now - summary.at < FRESH_MS ? summary.data : null;
}

/** The summary, from here when fresh, otherwise from the server (one request at a time). */
export function loadOasSummary() {
  const known = peekOasSummary();
  if (known) return Promise.resolve(known);
  if (!summaryRequest) {
    summaryRequest = fetchOasSummary()
      .then((envelope) => {
        summary = { data: envelope.data, at: Date.now() };
        return envelope.data;
      })
      .finally(() => {
        summaryRequest = null;
      });
  }
  return summaryRequest;
}

/** A table of a quarter already here, or null. @param {number} period @param {number} table */
export function peekOasTable(period, table) {
  return tables.get(tableKey(period, table)) || null;
}

/** A table of a quarter, from here or from the server (one request per table at a time). @param {number} period @param {number} table */
export function loadOasTable(period, table) {
  const key = tableKey(period, table);
  const known = tables.get(key);
  if (known) return Promise.resolve(known);
  if (!tableRequests.has(key)) {
    tableRequests.set(key, fetchOasTable(table, period)
      .then((envelope) => {
        tables.set(tableKey(envelope.data.period.key, envelope.data.table.table), envelope.data);
        return envelope.data;
      })
      .finally(() => {
        tableRequests.delete(key);
      }));
  }
  return tableRequests.get(key);
}

/**
 * Reads the block a direct visit carries, when it answers exactly this address,
 * language and table, and keeps what it holds. Returns whether it did.
 * @param {{ language: string, table: number | null, location: { pathname: string, search: string }, doc?: Document }} options
 */
export function takeOasInitialData({ language, table, location, doc = document }) {
  const element = doc.getElementById(INITIAL_DATA_ID);
  if (!element) return false;
  let payload;
  try {
    payload = JSON.parse(element.textContent || '');
  } catch {
    return false;
  }
  if (!record(payload) || payload.version !== VERSION || payload.kind !== 'oas') return false;
  if (payload.path !== location.pathname + location.search || payload.lang !== language || payload.table !== table) return false;
  if (!record(payload.summary) || !oasSummaryResponse(payload.summary)) return false;
  if (table !== null) {
    if (!record(payload.rows) || !oasTableResponse(payload.rows)) return false;
    const data = payload.rows.data;
    if (data.table.table !== table || data.period.key !== payload.summary.data.period.key) return false;
    tables.set(tableKey(data.period.key, table), data);
  }
  summary = { data: payload.summary.data, at: Date.now() };
  return true;
}

/** Forgets everything (tests). */
export function resetOasData() {
  summary = null;
  summaryRequest = null;
  tables.clear();
  tableRequests.clear();
}
