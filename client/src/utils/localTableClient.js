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
// Set once the worker failed to start or crashed; tables then answer on the page.
let workerFailed = false;
let nextTableId = 1;
let nextRequestId = 1;
/** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
const pending = new Map();
// Tables sent to the worker and not loaded there yet: each can still move to
// the page, from the rows it keeps until then.
/** @type {Map<number, { loaded: () => void, failed: () => void }>} */
const awaitingLoad = new Map();

function failWorker() {
  workerFailed = true;
  worker = null;
  for (const table of awaitingLoad.values()) table.failed();
  awaitingLoad.clear();
  for (const waiter of pending.values()) waiter.reject(new Error('table worker failed'));
  pending.clear();
}

/** @returns {Worker | null} */
function sharedWorker() {
  if (worker !== undefined || workerFailed) return worker ?? null;
  worker = null;
  if (typeof Worker === 'undefined') return worker;
  try {
    const created = new Worker(new URL('./localTableWorker.js', import.meta.url), {
      type: 'module'
    });
    created.onmessage = (event) => {
      const { type, tableId, requestId, result, error } = event.data || {};
      if (type === 'loaded' || type === 'load-failed') {
        const table = awaitingLoad.get(tableId);
        awaitingLoad.delete(tableId);
        if (type === 'loaded') table?.loaded();
        else table?.failed();
        return;
      }
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      if (error) waiter.reject(new Error(String(error)));
      else waiter.resolve(result);
    };
    // The worker could not start (an old tab whose worker file a release
    // removed) or crashed: nothing it holds will answer again.
    created.onerror = (event) => {
      event.preventDefault();
      failWorker();
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

/**
 * Answers on the page, synchronously, remembering answers in `answers`.
 * @param {{ fields: LocalField[], rows: unknown[][], complete: boolean }} input
 * @param {Map<string, LocalAnswer>} answers
 */
function pageAnswers({ fields, rows, complete }, answers) {
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
    peek,
    /** @param {LocalQuery} query */
    query: (query) => Promise.resolve(peek(query)),
    /** @param {LocalQuery} query @param {number} max @returns {Promise<LocalExport>} */
    exportRows: (query, max) => Promise.resolve(exportLocal(table, query, max))
  };
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
    const page = pageAnswers({ fields, rows, complete }, answers);
    return { ...base, ...page, dispose: () => answers.clear() };
  }
  const tableId = nextTableId++;
  // The rows stay here only until the worker has loaded them.
  /** @type {{ fields: LocalField[], rows: unknown[][], complete: boolean } | null} */
  let held = { fields, rows, complete };
  /** @type {ReturnType<typeof pageAnswers> | null} */
  let onPage = null;
  // Read through a function: a failing worker can set it while a request waits.
  const moved = () => onPage;
  awaitingLoad.set(tableId, {
    loaded: () => {
      held = null;
    },
    failed: () => {
      if (held) onPage = pageAnswers(held, answers);
      held = null;
    }
  });
  shared.postMessage({ type: 'load', tableId, input: { fields, rows, complete } });
  /** @param {Record<string, unknown>} message @returns {Promise<any>} */
  const ask = (message) =>
    workerFailed
      ? Promise.reject(new Error('table worker failed'))
      : new Promise((resolve, reject) => {
          const requestId = nextRequestId++;
          pending.set(requestId, { resolve, reject });
          shared.postMessage({ ...message, tableId, requestId });
        });
  return {
    ...base,
    peek: (query) => (onPage ? onPage.peek(query) : answers.get(queryKey(query))),
    query: async (query) => {
      if (onPage) return onPage.query(query);
      const cacheKey = queryKey(query);
      const cached = answers.get(cacheKey);
      if (cached) return cached;
      try {
        const answer = /** @type {LocalAnswer} */ (await ask({ type: 'query', query }));
        keep(answers, cacheKey, answer);
        return answer;
      } catch (error) {
        // The table moved to the page when the worker failed.
        const page = moved();
        if (page) return page.query(query);
        throw error;
      }
    },
    exportRows: async (query, max) => {
      if (onPage) return onPage.exportRows(query, max);
      try {
        return await ask({ type: 'export', query, max });
      } catch (error) {
        const page = moved();
        if (page) return page.exportRows(query, max);
        throw error;
      }
    },
    dispose: () => {
      answers.clear();
      awaitingLoad.delete(tableId);
      held = null;
      onPage = null;
      if (!workerFailed) shared.postMessage({ type: 'drop', tableId });
    }
  };
}
