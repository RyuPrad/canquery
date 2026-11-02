import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { queryResource } from '../api/catalog.js';
import { NotIngestedError, FileOnlyError, DatastoreFilterError } from '../api/client.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import { PAGE_SIZE, MAX_PAGE_INDEX } from '../utils/resourceExplorerState.js';
import { track } from '../utils/analytics.js';
import { resourceHint } from '../utils/resourceHints.js';
import * as rowPageCache from '../utils/rowPageCache.js';
import { queryKey as localQueryKey } from '../utils/localTableClient.js';

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

// A table held in the browser (useLocalTable) answers first: a complete one
// answers every page, a partial one the pages its rows cover, with no request.
// Otherwise pages come from the shared cache. A page the visitor already saw,
// the page prefetched behind the current one, or the page embedded in the
// HTML shell shows without a request; a miss keeps the rows already on screen
// visible while its request runs. Prepared copies are pinned to the snapshot
// the metadata reports so every page shows the same stored rows and schema.
// After the visit's first read, server reads are sent as background reads, so
// popularity counts visits rather than page turns.
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
  initialRows = null,
  local = null,
  heldFinal = false
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
  const [state, setState] = useState({ data: null, error: null });
  const [pending, setPending] = useState(true);
  const tracked = useRef(new Set());
  // The rows last on screen, kept while the next answer is worked out.
  const [kept, setKept] = useState(null);
  // The embedded page was the visit's counted read.
  const counted = useRef(Boolean(initialRows));

  // The in-browser table, asked first.
  const localTable = view === 'table' ? (local?.table ?? null) : null;
  const localQuery = useMemo(
    () => ({
      q: debouncedQ || '',
      filters,
      sort: sort || null,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    }),
    [debouncedQ, filters, sort, page]
  );
  const localKey = localTable ? localTable.key + '|' + localQueryKey(localQuery) : null;
  const [asked, setAsked] = useState({ key: null, answer: null });
  const peeked = localTable ? localTable.peek(localQuery) : undefined;
  const localAnswer = peeked ?? (asked.key === localKey ? asked.answer : undefined);
  useEffect(() => {
    if (!localTable || localTable.peek(localQuery)) return undefined;
    let cancelled = false;
    localTable
      .query(localQuery)
      .then((answer) => {
        if (!cancelled) setAsked({ key: localKey, answer });
      })
      .catch(() => {
        if (!cancelled)
          setAsked({ key: localKey, answer: { status: 'unsupported', reason: 'worker' } });
      });
    return () => {
      cancelled = true;
    };
  }, [localTable, localKey, localQuery]);
  const canonical = resource?.query_mode === 'ingested' || resource?.query_mode === 'datastore';
  // Nothing but the rows held will answer (a file whose preparation failed or
  // is unavailable): they answer every page, and a query they can't read
  // shows no rows rather than waiting.
  const final = heldFinal && !canonical;
  const localUsable =
    localAnswer?.status === 'ok' &&
    (localAnswer.complete || final || page * PAGE_SIZE < localAnswer.available);
  const localRefused = final && Boolean(localTable) && localAnswer?.status === 'unsupported';
  const mode = resource?.query_mode === 'ingested' ? 'ingested' : (resource?.query_mode ?? null);
  const localData = useMemo(
    () =>
      localUsable
        ? {
            fields: localAnswer.fields,
            records: localAnswer.records,
            total: localAnswer.total,
            mode,
            partial: !localAnswer.complete
          }
        : localRefused
          ? {
              fields: localTable.fields,
              records: [],
              total: null,
              mode,
              partial: true,
              unsupported: true
            }
          : null,
    [localUsable, localRefused, localAnswer, localTable, mode]
  );
  const hit = rowPageCache.peek(key, snapshotId);
  // A live table arriving leaves the query the portal already answered on
  // the portal, every page of it, until the visitor changes that query: the
  // portal's full-text search and sort order can differ from the browser's,
  // and the rows on screen must not change by themselves.
  const liveTable = local?.table?.origin === 'live' ? local.table : null;
  const viewQuery = JSON.stringify([debouncedQ || '', filters, sort || null]);
  const [arrival, setArrival] = useState({ table: liveTable, held: null });
  if (arrival.table !== liveTable) {
    setArrival({ table: liveTable, held: liveTable && hit ? viewQuery : null });
  }
  const networkHeld = Boolean(liveTable) && arrival.held === viewQuery;
  // An interim table (a file's rows while its prepared copy is canonical)
  // stays on screen until the server's page arrives; otherwise it answers alone.
  const localServes = Boolean(localData) && !(local?.interim && canonical) && !networkHeld;
  // The canonical copy is on its way whole: no server page meanwhile.
  const holdNetwork = Boolean(local?.loading) && Boolean(localData);
  // Asked of the worker and not answered yet: keep the rows on screen.
  const localThinking = Boolean(localTable) && localAnswer === undefined && !networkHeld;
  // A filter the live portal cannot run, waiting for the live table to come.
  const liveWaiting =
    view === 'table' &&
    resource?.query_mode === 'datastore' &&
    hasNonEq &&
    !localData &&
    local?.coverage === 'pending';
  // The local answer shows unless an interim one was replaced by the server's
  // page, or the portal keeps the query it answered.
  const showLocal = Boolean(localData) && !networkHeld && (localServes || !hit);

  const invalidate = useCallback(() => {
    rowPageCache.invalidate(id);
    setState({ data: null, error: new NotIngestedError('Resource has no prepared copy', 409) });
  }, [id, setState]);

  const queryPage = useCallback(
    (pageIndex, pin, signal, background = counted.current) =>
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
        { signal, background }
      ).then((env) => {
        counted.current = true;
        return toPage(env);
      }),
    [id, debouncedQ, filters, sort]
  );

  useEffect(() => {
    if (view !== 'table') {
      setPending(false);
      return undefined;
    }
    // The browser answers this view, its whole copy is on its way, or the
    // worker is still working the answer out: no server page.
    if (localServes || holdNetwork || localThinking) {
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
          setState({ data: loaded.data, error: null });
          // One event per view: the local table may have answered it already.
          if (tracked.current.has(key)) return;
          tracked.current.add(key);
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
    queryPage,
    localServes,
    holdNetwork,
    localThinking
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
    if (
      !hit ||
      !resource ||
      view !== 'table' ||
      hit.mode !== 'ingested' ||
      !unfiltered ||
      localServes
    )
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
        fetch: (signal) => queryPage(nextPage, snapshotId, signal, true)
      });
    }, PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      release?.();
    };
  }, [
    hit,
    resource,
    view,
    unfiltered,
    page,
    id,
    debouncedQ,
    filters,
    sort,
    snapshotId,
    queryPage,
    localServes
  ]);

  useEffect(() => {
    if (!showLocal || localData.unsupported) return;
    // One event per view, whichever answered it first.
    if (tracked.current.has(key)) return;
    tracked.current.add(key);
    track('resource_query', {
      resource_id: id,
      query: debouncedQ || '',
      filters: JSON.stringify(debouncedFilters),
      sort: sort || '',
      page: page + 1,
      query_mode: localData.mode || '',
      total: Number(localData.total) || 0,
      status: 'success',
      source: 'local'
    });
  }, [showLocal, localData, key, id, debouncedQ, debouncedFilters, sort, page]);

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

  // Rows a partial table can't give yet (a later page, a filter matching none
  // of the rows held) wait for the full table, with the rows on screen kept.
  const waitingForTable =
    view === 'table' &&
    Boolean(localTable) &&
    !localData &&
    !localThinking &&
    !hit &&
    !canonical &&
    !final;
  // Until the page asked for arrives, the rows last on screen stay (dimmed
  // while it loads), whichever engine drew them.
  const shown = showLocal ? localData : (hit ?? kept ?? state.data);
  useEffect(() => {
    if (shown && shown !== kept) setKept(shown);
  }, [shown, kept]);
  return {
    data: shown,
    error: showLocal || hit ? null : state.error,
    loading:
      showLocal || localThinking ? false : waitingForTable || liveWaiting || (!hit && pending),
    // Set once the rows on screen are the page asked for (not the previous
    // page kept while it loads): the cache key of that page.
    pageKey: showLocal || hit ? key : null,
    // A partial table answered: there may be more rows than it holds.
    partial: Boolean(showLocal && localData?.partial),
    // Matching rows the in-browser table holds, when it answered.
    available: showLocal && localAnswer?.status === 'ok' ? localAnswer.available : null,
    // The in-browser table answered (its export can be built in the browser).
    local: showLocal,
    // The rows held could not read this query, and nothing else will answer.
    unsupported: Boolean(showLocal && localData?.unsupported),
    waitingForTable,
    invalidate
  };
}
