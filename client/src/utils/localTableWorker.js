// Runs the in-browser table off the page's main thread, so sorting tens of
// thousands of rows never freezes scrolling or typing.
import { createLocalTable, answerLocal, exportLocal } from './localTable.js';

/** @type {Map<number, import('./localTable.js').LocalTable>} */
const tables = new Map();

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'load') {
    tables.set(message.tableId, createLocalTable(message.input));
    return;
  }
  if (message.type === 'drop') {
    tables.delete(message.tableId);
    return;
  }
  const table = tables.get(message.tableId);
  if (!table) {
    self.postMessage({ requestId: message.requestId, error: 'missing table' });
    return;
  }
  try {
    const result =
      message.type === 'export'
        ? exportLocal(table, message.query, message.max)
        : answerLocal(table, message.query);
    self.postMessage({ requestId: message.requestId, result });
  } catch (error) {
    self.postMessage({ requestId: message.requestId, error: String(error) });
  }
};
