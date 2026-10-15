import { useCallback } from 'react';
import { fetchOrganizations, fetchSources } from '../api/catalog.js';
import useScopedOptions from './useScopedOptions.js';

// Publisher and source choices for the unfiltered homepage row. While the
// visitor is filtering, the sidebar's counts replace them, so nothing loads.
export default function useHomeFilterOptions(place, source, enabled) {
  const loadOrganizations = useCallback(
    async (signal) => {
      const rows = [];
      const seenCursors = new Set();
      let cursor;
      do {
        const env = await fetchOrganizations(
          { place: place || undefined, source: source || undefined, limit: 100, cursor },
          { signal }
        );
        if (signal.aborted) return [];
        rows.push(...(env.data || []));
        cursor = env.pagination?.nextCursor || null;
        if (cursor && seenCursors.has(cursor))
          throw new Error('Organization pagination returned a repeated cursor');
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      return rows;
    },
    [place, source]
  );
  const loadSources = useCallback(
    async (signal) => {
      const env = await fetchSources({ place: place || undefined }, { signal });
      return env.data || [];
    },
    [place]
  );
  const loadNothing = useCallback(async () => [], []);
  const organizations = useScopedOptions(
    enabled ? JSON.stringify([place, source]) : 'disabled',
    enabled ? loadOrganizations : loadNothing
  );
  const sources = useScopedOptions(
    enabled ? place : 'disabled',
    enabled ? loadSources : loadNothing
  );
  return { organizations, sources };
}
