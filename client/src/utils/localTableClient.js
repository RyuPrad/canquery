// Handles for in-browser tables. A small table is answered on the page itself,
// synchronously, so its first sort or page shows in the same frame. A larger
// one lives in a module Web Worker; its answers arrive a moment later and are
// remembered, so going back to a page or sort is synchronous too. Without
// Worker support (tests, old browsers) every table is answered on the page.
import { createLocalTable, answerLocal, exportLocal } from './localTable.js';

/**
 * @typedef {import('./localTable.js').LocalAnswer} LocalAnswer
 * @typedef {import('./localTable.js').LocalQuery} LocalQuery
 * @typedef {import('./localTable.js').LocalField} LocalField
 * @typedef {{ fields: LocalField[], rows: unknown[][] } | import('./localTable.js').LocalAnswerUnsupported} LocalExport
 * @typedef {{
 *   key: string, fields: LocalField[], rowCount: number, cells: number, complete: boolean, origin: string,
 *   snapshotId: string | null, peek: (query: LocalQuery) => LocalAnswer | undefined,
 *   query: (query: LocalQuery) => Promise<LocalAnswer>, exportRows: (query: LocalQuery, max: number) => Promise<LocalExport>,
 *   dispose: () => void
 * }} LocalTableHandle
 * @typedef {{ key: string, fields: LocalField[], rows: unknown[][], complete: boolean, origin: string, snapshotId?: string | null }} LocalTableSource
 */

const IN_THREAD_ROWS = 5000;
const ANSWERS_KEPT = 64;

/** @type {Worker | null | undefined} */
let worker;
let nextTableId = 1;
let nextRequestId = 1;
/** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
const pending = new Map();

/** @returns {Worker | null} */
function sharedWorker() {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined') return worker;
  try {
    const created = new Worker(new URL('./localTableWorker.js', import.meta.url), {
      type: 'module'
    });
    created.onmessage = (event) => {
      const { requestId, result, error } = event.data || {};
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      if (error) waiter.reject(new Error(String(error)));
      else waiter.resolve(result);
    };
    created.onerror = () => {
      for (const waiter of pending.values()) waiter.reject(new Error('table worker failed'));
      pending.clear();
    };
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

/** @param {LocalQuery} query */
export function queryKey({ q = '', filters = {}, sort = null, offset = 0, limit = 50 }) {
  return JSON.stringify([q || '', filters || {}, sort || null, Number(offset) || 0, Number(limit)]);
}

/** @param {Map<string, LocalAnswer>} answers @param {string} key @param {LocalAnswer} answer */
function keep(answers, key, answer) {
  if (answers.size >= ANSWERS_KEPT)
    answers.delete(/** @type {string} */ (answers.keys().next().value));
  answers.set(key, answer);
}

/** @param {LocalTableSource} source @param {{ inThread?: boolean }} [options] @returns {LocalTableHandle} */
export function loadLocalTable(
  { key, fields, rows, complete, origin, snapshotId = null },
  options = {}
) {
  /** @type {Map<string, LocalAnswer>} */
  const answers = new Map();
  const base = {
    key,
    fields,
    rowCount: rows.length,
    cells: rows.length * Math.max(1, fields.length),
    complete: Boolean(complete),
    origin,
    snapshotId
  };
  const shared = options.inThread || rows.length <= IN_THREAD_ROWS ? null : sharedWorker();
  if (!shared) {
    const table = createLocalTable({ fields, rows, complete });
    /** @param {LocalQuery} query */
    const peek = (query) => {
      const cacheKey = queryKey(query);
      let answer = answers.get(cacheKey);
      if (!answer) {
        answer = answerLocal(table, query);
        keep(answers, cacheKey, answer);
      }
      return answer;
    };
    return {
      ...base,
      peek,
      query: (query) => Promise.resolve(peek(query)),
      exportRows: (query, max) => Promise.resolve(exportLocal(table, query, max)),
      dispose: () => answers.clear()
    };
  }
  const tableId = nextTableId++;
  shared.postMessage({ type: 'load', tableId, input: { fields, rows, complete } });
  /** @param {Record<string, unknown>} message @returns {Promise<any>} */
  const ask = (message) =>
    new Promise((resolve, reject) => {
      const requestId = nextRequestId++;
      pending.set(requestId, { resolve, reject });
      shared.postMessage({ ...message, tableId, requestId });
    });
  return {
    ...base,
    peek: (query) => answers.get(queryKey(query)),
    query: async (query) => {
      const cacheKey = queryKey(query);
      const cached = answers.get(cacheKey);
      if (cached) return cached;
      const answer = /** @type {LocalAnswer} */ (await ask({ type: 'query', query }));
      keep(answers, cacheKey, answer);
      return answer;
    },
    exportRows: (query, max) => ask({ type: 'export', query, max }),
    dispose: () => {
      answers.clear();
      shared.postMessage({ type: 'drop', tableId });
    }
  };
}
