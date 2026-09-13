import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { pageNumber, PAGE_SIZE } from '../utils/catalogPagination.js';

// Unfiltered catalogue pages have durable URLs. Search controls keep their
// existing local state and use buttons, so filters do not create crawl paths.
export default function useCatalogPage(fetchPage, deps, filtered = false) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const filterKey = JSON.stringify([pathname, ...deps]);
  const [selection, setSelection] = useState({ key: null, page: 1 });
  const page = filtered ? (selection.key === filterKey ? selection.page : 1) : pageNumber(params);
  const [state, setState] = useState({ key: null, items: [], loading: true, error: null, meta: null, hasMore: false });
  const requestKey = JSON.stringify([filterKey, page]);

  useEffect(() => {
    if (!filtered && params.getAll('page').length === 1 && params.get('page') === '1') {
      const next = new URLSearchParams(params);
      next.delete('page');
      setParams(next, { replace: true });
    }
  }, [filtered, params, setParams]);

  useEffect(() => {
    if (selection.key !== filterKey) setSelection({ key: filterKey, page: 1 });
  }, [filterKey, selection.key]);

  useEffect(() => {
    if (page === null) return;
    let cancelled = false;
    Promise.resolve().then(() => cancelled ? null : fetchPage(String((page - 1) * PAGE_SIZE)))
      .then(env => {
        if (!cancelled) setState({ key: requestKey, items: env.data || [], loading: false, error: null,
          meta: env.meta || null, hasMore: Boolean(env.pagination?.nextCursor) });
      })
      .catch(error => {
        if (!cancelled) setState({ key: requestKey, items: [], loading: false, error, meta: null, hasMore: false });
      });
    return () => { cancelled = true; };
    // fetchPage closes over exactly the criteria supplied in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = state.key === requestKey ? state : { items: [], loading: page !== null, error: null, meta: null, hasMore: false };
  return { items: current.items, loading: current.loading, error: current.error,
    meta: current.meta, hasMore: current.hasMore, page, path: pathname,
    notFound: page === null || (!current.loading && !current.error && page > 1 && current.items.length === 0),
    onPage: filtered ? number => setSelection({ key: filterKey, page: number }) : undefined };
}
