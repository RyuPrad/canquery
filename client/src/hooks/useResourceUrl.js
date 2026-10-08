import { useState, useRef, useEffect } from 'react';
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
  useEffect(() => {
    // Preserve the page in a newly opened link. Subsequent edits start at zero.
    if (!resetArmed.current) {
      resetArmed.current = true;
      return;
    }
    setPage(0);
  }, [debouncedQ, debouncedFilters, sort]);
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
