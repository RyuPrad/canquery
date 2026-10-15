import { useEffect, useState } from 'react';

// Facet counts arrive with the first page of results. While the next page
// loads, or when the API could not count, the last good counts stay visible
// (dimmed) instead of the sidebar emptying and jumping.
export default function useFacetSnapshot(meta, loading) {
  const current = meta && meta.facets ? meta : null;
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (current) setLast(current);
  }, [current]);
  const shown = current || last;
  const status = current
    ? 'ready'
    : loading
      ? 'loading'
      : meta && Object.hasOwn(meta, 'facets')
        ? 'unavailable'
        : 'idle';
  return {
    facets: shown ? shown.facets : null,
    total: shown && Number.isSafeInteger(shown.total) ? shown.total : null,
    stale: !current,
    status
  };
}
