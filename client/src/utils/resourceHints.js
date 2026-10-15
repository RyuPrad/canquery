// What the application last learned about a resource's query mode and
// snapshot, from its metadata, a dataset's resource list or the page's
// embedded initial data. A resource page opened with a hint that the copy is
// prepared starts its first row request alongside the metadata request
// instead of after it; without a hint no request is made before the metadata
// says the resource can be queried.

const MAX_HINTS = 200;

/** @typedef {import('../api/contracts').ResourceHint} ResourceHint */

/** @type {Map<string, ResourceHint>} */
const hints = new Map();

/** @param {{ id?: unknown, query_mode?: unknown, ingestion?: { snapshot_id?: unknown } | null } | null | undefined} resource */
export function rememberResource(resource) {
  if (!resource || typeof resource.id !== 'string') return;
  const snapshot = resource.ingestion?.snapshot_id;
  hints.delete(resource.id);
  hints.set(resource.id, {
    queryMode: typeof resource.query_mode === 'string' ? resource.query_mode : null,
    snapshotId: typeof snapshot === 'string' ? snapshot : null
  });
  while (hints.size > MAX_HINTS) {
    const oldest = hints.keys().next().value;
    if (oldest === undefined) break;
    hints.delete(oldest);
  }
}

/** @param {string} id @returns {ResourceHint | null} */
export function resourceHint(id) {
  return hints.get(id) || null;
}

export function clearResourceHints() {
  hints.clear();
}
