import React from 'react';

export default function usePaginatedCollection(fetchPage, deps) {
  const [meta, setMeta] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [nextCursor, setNextCursor] = React.useState(null);
  const seqRef = React.useRef(0);
  const loadMoreRef = React.useRef(null);

  React.useEffect(() => {
    const mySeq = ++seqRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    loadMoreRef.current = null;
    setError(null);
    setMeta(null);
    setItems([]);
    setNextCursor(null);
    fetchPage(null).then(env => {
      if (cancelled || seqRef.current !== mySeq) return;
      setItems(env.data || []);
      setMeta(env.meta || null);
      setNextCursor(env.pagination ? env.pagination.nextCursor : null);
    }).catch(err => {
      if (cancelled || seqRef.current !== mySeq) return;
      setError(err);
    }).finally(() => {
      if (!cancelled && seqRef.current === mySeq) setLoading(false);
    });
    return () => {
      cancelled = true;
      // Invalidate pagination requests as well as the first page, including
      // when the collection unmounts with a load-more request still running.
      seqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = React.useCallback(async () => {
    const mySeq = seqRef.current;
    if (!nextCursor || loading || loadMoreRef.current === mySeq) return;
    loadMoreRef.current = mySeq;
    setLoadingMore(true);
    setError(null);
    try {
      const env = await fetchPage(nextCursor);
      if (seqRef.current !== mySeq) return;
      setItems(prev => prev.concat(env.data || []));
      setNextCursor(env.pagination ? env.pagination.nextCursor : null);
    } catch (err) {
      if (seqRef.current === mySeq) setError(err);
    } finally {
      if (seqRef.current === mySeq) {
        loadMoreRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [nextCursor, loading, fetchPage]);

  return { items, meta, loading, loadingMore, error, hasMore: Boolean(nextCursor), loadMore };
}
