import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import useDebouncedValue from './useDebouncedValue.js';
import { readResourceUrl, writeResourceUrl } from '../utils/resourceExplorerState.js';

export default function useResourceUrl(navigationKey) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [initial] = useState(() => readResourceUrl(searchParams));
  const [q, setQ] = useState(initial.q);
  const [columnFilters, setColumnFilters] = useState(initial.columnFilters);
  const [sort, setSort] = useState(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [view, setView] = useState(initial.view);
  const debouncedQ = useDebouncedValue(q, 250);
  const debouncedFilters = useDebouncedValue(columnFilters, 250);
  const resetArmed = useRef(false);
  // Filters and sort renamed to new column ids (a file's columns once its
  // prepared copy arrives) keep the page: the visitor changed nothing.
  const renamed = useRef(
    /** @type {{ from: Record<string, string>, to: Record<string, string>, sort: string | null } | null} */ (
      null
    )
  );
  useEffect(() => {
    // Preserve the page in a newly opened link. Subsequent edits start at zero.
    if (!resetArmed.current) {
      resetArmed.current = true;
      return;
    }
    const rename = renamed.current;
    if (
      rename &&
      sort === rename.sort &&
      (debouncedFilters === rename.to || debouncedFilters === rename.from)
    ) {
      if (debouncedFilters === rename.to) renamed.current = null;
      return;
    }
    renamed.current = null;
    setPage(0);
  }, [debouncedQ, debouncedFilters, sort]);
  /** @param {Record<string, string>} nextFilters @param {string | null} nextSort */
  const rename = useCallback(
    (nextFilters, nextSort) => {
      renamed.current = { from: columnFilters, to: nextFilters, sort: nextSort };
      setColumnFilters(nextFilters);
      setSort(nextSort);
    },
    [columnFilters]
  );
  useEffect(() => {
    const next = writeResourceUrl(searchParams, {
      q: debouncedQ,
      columnFilters: debouncedFilters,
      sort,
      page,
      view
    });
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, {
        replace: true,
        state: { ...location.state, resourceExplorerKey: navigationKey }
      });
    }
  }, [
    debouncedQ,
    debouncedFilters,
    sort,
    page,
    view,
    searchParams,
    setSearchParams,
    location.state,
    navigationKey
  ]);
  return {
    q,
    setQ,
    columnFilters,
    setColumnFilters,
    renameColumns: rename,
    sort,
    setSort,
    page,
    setPage,
    view,
    setView,
    debouncedQ,
    debouncedFilters
  };
}
