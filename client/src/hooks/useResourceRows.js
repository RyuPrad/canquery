import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { queryResource } from '../api/catalog.js';
import { NotIngestedError, FileOnlyError, DatastoreFilterError } from '../api/client.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import { PAGE_SIZE, MAX_PAGE_INDEX } from '../utils/resourceExplorerState.js';
import { track } from '../utils/analytics.js';
import { resourceHint } from '../utils/resourceHints.js';
import * as rowPageCache from '../utils/rowPageCache.js';

export const PREFETCH_DELAY_MS = 300;
const SNAPSHOT_UNAVAILABLE = 'SNAPSHOT_UNAVAILABLE';

const toPage = (env) => ({
  data: {
    fields: env.data.fields,
    records: env.data.records,
    total: env.data.total,
    mode: env.meta.query_mode
  },
  snapshotId: env.meta.snapshot?.id ?? null
});

const isAbort = (error) => error?.name === 'AbortError';

// Pages come from the shared cache first. A page the visitor already saw, the
// page prefetched behind the current one, or the page embedded in the HTML
// shell shows without a request; a miss keeps the rows already on screen
// visible while its request runs. Prepared copies are pinned to the snapshot
// the metadata reports so every page shows the same stored rows and schema.
export default function useResourceRows({
  id,
  resource,
  view,
  debouncedQ,
  debouncedFilters,
  sort,
  page,
  preparationRequired,
  fileOnly,
  hasNonEq,
  onUnavailable,
  schemaReady,
  setFilterUpgrade,
  initialRows = null
}) {
  const filters = useMemo(() => buildColumnFilters(debouncedFilters), [debouncedFilters]);
  const unfiltered = !debouncedQ && Object.keys(filters).length === 0;
  const key = rowPageCache.pageKey({ id, q: debouncedQ, filters, sort, page });
  const snapshotId = resource?.ingestion?.snapshot_id ?? null;
  // The page embedded in the HTML shell enters the cache before the first render.
  useState(() => {
    if (initialRows) {
      rowPageCache.seed(
        rowPageCache.pageKey({ id, q: '', filters: {}, sort: null, page: initialRows.page }),
        {
          id,
          data: initialRows.data,
          snapshotId: initialRows.snapshotId,
          source: 'inline'
        }
      );
    }
    return null;
  });
  const hit = rowPageCache.peek(key, snapshotId);
  const [state, setState] = useState({ data: null, error: null });
  const [pending, setPending] = useState(true);
  const tracked = useRef(new Set());

  const invalidate = useCallback(() => {
    rowPageCache.invalidate(id);
    setState({ data: null, error: new NotIngestedError('Resource has no prepared copy', 409) });
  }, [id]);

  const queryPage = useCallback(
    (pageIndex, pin, signal) =>
      queryResource(
        id,
        {
          q: debouncedQ || undefined,
          filters: Object.keys(filters).length ? filters : undefined,
          sort: sort || undefined,
          limit: PAGE_SIZE,
          offset: pageIndex * PAGE_SIZE,
          snapshot: pin || undefined
        },
        { signal }
      ).then(toPage),
    [id, debouncedQ, filters, sort]
  );

  useEffect(() => {
    if (view !== 'table') {
      setPending(false);
      return undefined;
    }
    if (fileOnly) {
      setState({ data: null, error: null });
      setPending(false);
      return undefined;
    }
    if (
      !resource ||
      !schemaReady ||
      preparationRequired ||
      (resource.query_mode === 'datastore' && hasNonEq)
    ) {
      setPending(false);
      return undefined;
    }
    if (rowPageCache.peek(key, snapshotId)) {
      rowPageCache.touch(key);
      setPending(false);
      return undefined;
    }
    setPending(true);
    let cancelled = false;
    const request = (pin) =>
      rowPageCache.load(key, {
        id,
        snapshotId: pin,
        fetch: (signal) => queryPage(page, pin, signal)
      });
    let active = request(snapshotId);
    const fail = (err) =>
      track('resource_query', {
        resource_id: id,
        query: debouncedQ || '',
        filters: JSON.stringify(debouncedFilters),
        sort: sort || '',
        page: page + 1,
        status:
          err instanceof NotIngestedError
            ? 'not_loaded'
            : err instanceof FileOnlyError
              ? 'file_only'
              : 'failed'
      });
    const run = (handle, retried) =>
      handle.promise
        .then((loaded) => {
          if (cancelled) return;
          tracked.current.add(key);
          setState({ data: loaded.data, error: null });
          track('resource_query', {
            resource_id: id,
            query: debouncedQ || '',
            filters: JSON.stringify(debouncedFilters),
            sort: sort || '',
            page: page + 1,
            query_mode: loaded.data.mode || '',
            total: Number(loaded.data.total) || 0,
            status: 'success',
            source: 'network'
          });
        })
        .catch((err) => {
          if (cancelled || isAbort(err)) return;
          if (err instanceof DatastoreFilterError) {
            // Fallback for the first load before the mode is known: the proxy
            // rejected a non-equality filter, so upgrade to local storage. The
            // rows already on screen stay visible while the ingest runs.
            setFilterUpgrade(true);
            return;
          }
          const stale = err instanceof NotIngestedError && err.body?.code === SNAPSHOT_UNAVAILABLE;
          if (stale && handle.pin !== snapshotId && !retried) {
            // Joined a request pinned to an older snapshot; ask again for ours.
            active = request(snapshotId);
            return run(active, true);
          }
          fail(err);
          if (stale) {
            // The copy was replaced: refresh the metadata, then its pages. The
            // rows on screen stay until the new copy's page arrives.
            rowPageCache.invalidate(id);
            onUnavailable();
            return;
          }
          if (err instanceof NotIngestedError && resource.query_mode !== 'ingestable')
            onUnavailable();
          setState({ data: null, error: err });
        });
    run(active, false).finally(() => {
      if (!cancelled) setPending(false);
    });
    return () => {
      cancelled = true;
      active.release();
    };
  }, [
    id,
    key,
    page,
    debouncedQ,
    debouncedFilters,
    sort,
    view,
    resource,
    snapshotId,
    preparationRequired,
    fileOnly,
    hasNonEq,
    onUnavailable,
    schemaReady,
    setFilterUpgrade,
    queryPage
  ]);

  // A resource the application already knows to be prepared starts its first
  // page alongside the metadata request. Only the unfiltered view qualifies:
  // search, filters and sorting wait for the recorded schema.
  useEffect(() => {
    if (resource || view !== 'table' || sort || !unfiltered) return undefined;
    const hint = resourceHint(id);
    if (hint?.queryMode !== 'ingested') return undefined;
    const pin = hint.snapshotId;
    if (rowPageCache.peek(key, pin)) return undefined;
    const handle = rowPageCache.load(key, {
      id,
      snapshotId: pin,
      fetch: (signal) => queryPage(page, pin, signal)
    });
    handle.promise.catch(() => {});
    return handle.release;
  }, [id, resource, view, sort, unfiltered, key, page, queryPage]);

  // The page behind the current one is fetched shortly after the current one
  // is on screen, so Next shows it at once. Prepared copies only, unfiltered
  // views only, visible tabs only, and never while a rate limit is in force.
  useEffect(() => {
    if (!hit || !resource || view !== 'table' || hit.mode !== 'ingested' || !unfiltered)
      return undefined;
    const nextPage = page + 1;
    if (nextPage > MAX_PAGE_INDEX || nextPage * PAGE_SIZE >= hit.total) return undefined;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return undefined;
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return undefined;
    const nextKey = rowPageCache.pageKey({ id, q: debouncedQ, filters, sort, page: nextPage });
    let release = null;
    const timer = setTimeout(() => {
      release = rowPageCache.prefetch(nextKey, {
        id,
        snapshotId,
        fetch: (signal) => queryPage(nextPage, snapshotId, signal)
      });
    }, PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      release?.();
    };
  }, [hit, resource, view, unfiltered, page, id, debouncedQ, filters, sort, snapshotId, queryPage]);

  useEffect(() => {
    if (!hit) return;
    // The page on screen is what stays visible, dimmed, while an unseen page
    // loads, whether it came from a request or from the cache.
    setState((current) => (current.data === hit ? current : { data: hit, error: null }));
    if (tracked.current.has(key)) return;
    tracked.current.add(key);
    track('resource_query', {
      resource_id: id,
      query: debouncedQ || '',
      filters: JSON.stringify(debouncedFilters),
      sort: sort || '',
      page: page + 1,
      query_mode: hit.mode || '',
      total: Number(hit.total) || 0,
      status: 'success',
      source: rowPageCache.peekSource(key, snapshotId) === 'inline' ? 'inline' : 'cache'
    });
  }, [hit, key, id, debouncedQ, debouncedFilters, sort, page, snapshotId]);

  return {
    data: hit ?? state.data,
    error: hit ? null : state.error,
    loading: !hit && pending,
    invalidate
  };
}
