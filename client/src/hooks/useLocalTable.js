import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fetchResourceRows } from '../api/catalog.js';
import { isEngaged, subscribeEngagement } from '../utils/engagement.js';
import { loadLocalTable } from '../utils/localTableClient.js';

// The same caps as the server's whole-table read (server/services/tableRows.js).
export const COPY_ROW_CAP = 50000;
export const CELL_CAP = 200000;
const SESSION_CELLS = 600000;

/** @typedef {import('../utils/localTableClient.js').LocalTableHandle} LocalTableHandle */

/**
 * Which whole table this resource can have in the browser, if any. Live CKAN
 * tables come later; files and prepared copies now.
 * @param {any} resource
 * @returns {{ origin: 'copy' | 'file', key: string, snapshot: string | null } | null}
 */
export function localSource(resource) {
  if (!resource) return null;
  if (resource.query_mode === 'ingested') {
    const ingestion = resource.ingestion;
    const fields = ingestion?.fields;
    const rows = Number(ingestion?.row_count);
    if (!ingestion?.snapshot_id || !Array.isArray(fields) || !Number.isSafeInteger(rows))
      return null;
    if (rows > COPY_ROW_CAP || rows * fields.length > CELL_CAP) return null;
    return {
      origin: 'copy',
      key: 'copy:' + resource.id + ':' + ingestion.snapshot_id,
      snapshot: ingestion.snapshot_id
    };
  }
  if (
    resource.query_mode === 'ingestable' &&
    String(resource.format || '').toUpperCase() === 'CSV'
  ) {
    return {
      origin: 'file',
      key:
        'file:' + resource.id + ':' + (resource.url || '') + ':' + (resource.last_modified || ''),
      snapshot: null
    };
  }
  return null;
}

// Tables kept for this browser session, so returning to a table is instant.
// Bounded by their total cells; the oldest go first.
/** @type {Map<string, LocalTableHandle>} */
const session = new Map();
/** @type {Set<string>} */
const refused = new Set();

/** @param {LocalTableHandle} handle */
function keepInSession(handle) {
  session.delete(handle.key);
  session.set(handle.key, handle);
  let cells = 0;
  for (const kept of session.values()) cells += kept.cells;
  for (const [key, kept] of session) {
    if (cells <= SESSION_CELLS || key === handle.key) continue;
    session.delete(key);
    kept.dispose();
    cells -= kept.cells;
  }
}

export function clearLocalTables() {
  for (const handle of session.values()) handle.dispose();
  session.clear();
  refused.clear();
}

/**
 * The base preview of a CSV as a partial table, numbered like the future copy.
 * It is complete only when the preview read the whole file and every row fitted.
 * @param {string} resourceId @param {any} preview
 */
function previewTable(resourceId, preview) {
  const fields = [{ id: '_id', type: 'int' }, ...preview.fields];
  const rows = preview.records.map(
    (/** @type {Record<string, unknown>} */ record, /** @type {number} */ index) => [
      String(index + 1),
      ...preview.fields.map((/** @type {{ id: string }} */ field) => record[field.id] ?? null)
    ]
  );
  const complete =
    preview.truncated === false &&
    Number.isSafeInteger(preview.sampledRows) &&
    preview.sampledRows === rows.length;
  return loadLocalTable(
    { key: 'preview:' + resourceId, fields, rows, complete, origin: 'preview' },
    { inThread: true }
  );
}

/**
 * The resource's table in the browser.
 * - Prepared copies within the caps and CSV files not prepared yet are fetched
 *   whole after the first sign of a person, on the Table tab only.
 * - Until then, a CSV's base preview stands in as a partial table.
 * - The last table stays available while the one replacing it loads, so a
 *   file table keeps answering until its prepared copy arrives.
 * @param {{ id: string, resource: any, view: string, preview: any }} options
 * @returns {{ table: LocalTableHandle | null, interim: boolean, loading: boolean }}
 */
export default function useLocalTable({ id, resource, view, preview }) {
  const engaged = useSyncExternalStore(subscribeEngagement, isEngaged, () => false);
  const source = useMemo(() => localSource(resource), [resource]);
  const sourceKey = source?.key ?? null;
  const sourceSnapshot = source?.snapshot ?? null;
  const [loaded, setLoaded] = useState(
    /** @returns {LocalTableHandle | null} */ () => (sourceKey && session.get(sourceKey)) || null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sourceKey || view !== 'table' || !engaged) return undefined;
    const cached = session.get(sourceKey);
    if (cached) {
      setLoaded(cached);
      return undefined;
    }
    if (refused.has(sourceKey)) return undefined;
    const controller = new AbortController();
    setLoading(true);
    fetchResourceRows(id, { snapshot: sourceSnapshot || undefined, signal: controller.signal })
      .then((envelope) => {
        const handle = loadLocalTable({
          key: sourceKey,
          fields: envelope.data.fields,
          rows: envelope.data.rows,
          complete: envelope.data.complete,
          origin: envelope.meta.origin,
          snapshotId: envelope.meta.snapshot?.id ?? null
        });
        keepInSession(handle);
        setLoaded(handle);
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        // Too large, unsupported or replaced: the server pages it instead.
        // A busy or failing publisher is tried again on a later visit.
        if ([400, 403, 404, 409, 413, 422].includes(Number(error?.status))) refused.add(sourceKey);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, sourceKey, sourceSnapshot, view, engaged]);

  const previewHandle = useMemo(() => (preview ? previewTable(id, preview) : null), [id, preview]);

  // `loaded` keeps the last table fetched, and the preview stays too: after
  // the source changes (a file whose copy was just prepared) they answer, as
  // interim rows, until the replacement arrives.
  const current = loaded && loaded.key === sourceKey ? loaded : null;
  const fallback = (loaded && loaded.key !== sourceKey ? loaded : null) || previewHandle;
  const table = current || fallback;
  // A file's own rows answer alone; any other stand-in only until the server answers.
  const interim = !current && Boolean(table) && source?.origin !== 'file';
  return { table, interim, loading: loading && !current };
}
