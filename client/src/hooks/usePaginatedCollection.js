import React from 'react';

export default function usePaginatedCollection(fetchPage, deps) {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [nextCursor, setNextCursor] = React.useState(null);
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    const mySeq = ++seqRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(null).then(env => {
      if (cancelled || seqRef.current !== mySeq) return;
      setItems(env.data || []);
      setNextCursor(env.pagination ? env.pagination.nextCursor : null);
    }).catch(err => {
      if (cancelled || seqRef.current !== mySeq) return;
      setError(err);
    }).finally(() => {
      if (!cancelled && seqRef.current === mySeq) setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = React.useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const env = await fetchPage(nextCursor);
      setItems(prev => prev.concat(env.data || []));
      setNextCursor(env.pagination ? env.pagination.nextCursor : null);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, fetchPage]);

  return { items, loading, loadingMore, error, hasMore: Boolean(nextCursor), loadMore };
}
