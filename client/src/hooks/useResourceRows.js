import { useState, useEffect, useCallback } from 'react';
import { queryResource } from '../api/catalog.js';
import { NotIngestedError, FileOnlyError, DatastoreFilterError } from '../api/client.js';
import { buildColumnFilters } from '../utils/columnFilter.js';
import { PAGE_SIZE } from '../utils/resourceExplorerState.js';
import { track } from '../utils/analytics.js';

export default function useResourceRows({
  id,
  resource,
  view,
  debouncedQ,
  debouncedFilters,
  sort,
  page,
  reloadKey,
  preparationRequired,
  fileOnly,
  hasNonEq,
  onUnavailable,
  schemaReady,
  setFilterUpgrade
}) {
  const [data, setData] = useState(null);
  const [error, setDataError] = useState(null);
  const [loading, setDataLoading] = useState(true);
  const invalidate = useCallback(() => {
    setData(null);
    setDataError(new NotIngestedError('Resource has no prepared copy', 409));
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (view !== 'table') {
      setDataLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setDataLoading(true);

    if (fileOnly) {
      setData(null);
      setDataError(null);
      setDataLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (
      !resource ||
      !schemaReady ||
      preparationRequired ||
      (resource.query_mode === 'datastore' && hasNonEq)
    ) {
      setDataLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const filters = buildColumnFilters(debouncedFilters);
    const controller = new AbortController();
    queryResource(
      id,
      {
        q: debouncedQ || undefined,
        filters: Object.keys(filters).length ? filters : undefined,
        sort: sort || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      },
      { signal: controller.signal }
    )
      .then((env) => {
        if (!cancelled) {
          setData({
            fields: env.data.fields,
            records: env.data.records,
            total: env.data.total,
            mode: env.meta.query_mode
          });
          setDataError(null);
          track('resource_query', {
            resource_id: id,
            query: debouncedQ || '',
            filters: JSON.stringify(debouncedFilters),
            sort: sort || '',
            page: page + 1,
            query_mode: env.meta.query_mode || '',
            total: Number(env.data.total) || 0,
            status: 'success'
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DatastoreFilterError) {
          // Fallback for the first load before the mode is known: the proxy
          // rejected a non-equality filter, so upgrade to local storage. The
          // rows already on screen stay visible while the ingest runs.
          setFilterUpgrade(true);
          return;
        }
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
        if (err instanceof NotIngestedError && resource.query_mode !== 'ingestable')
          onUnavailable();
        setData(null);
        setDataError(err);
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    id,
    debouncedQ,
    debouncedFilters,
    sort,
    page,
    view,
    reloadKey,
    resource,
    preparationRequired,
    fileOnly,
    hasNonEq,
    onUnavailable,
    schemaReady,
    setFilterUpgrade
  ]);

  return { data, error, loading, invalidate };
}
