import { createContext, useContext, useEffect, useId } from 'react';
import { sameUnits, summarizeUnits } from '../utils/chartLoadProgress.js';

// The chart area tells the Chart tab's loading card what it is waiting for:
// the chart code, the table's profile and each chart's numbers. The page owns
// one store; without a provider (the Insights gallery, the home page) the hook
// does nothing.
export const ChartLoadContext = createContext(null);

export function createChartLoadStore() {
  const units = new Map();
  const listeners = new Set();
  let snapshot = summarizeUnits(units.values());
  const emit = () => {
    const next = summarizeUnits(units.values());
    if (sameUnits(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    set(key, kind, state) {
      const current = units.get(key);
      if (current && current.kind === kind && current.state === state) return;
      units.set(key, { kind, state });
      emit();
    },
    remove(key) {
      if (units.delete(key)) emit();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

/**
 * Reports one unit while the calling component is mounted.
 * @param {'chunk' | 'profile' | 'chart'} kind
 * @param {'loading' | 'settled' | 'failed'} state
 */
export function useChartLoadReport(kind, state) {
  const store = useContext(ChartLoadContext);
  const key = useId();
  useEffect(() => {
    store?.set(key, kind, state);
  }, [store, key, kind, state]);
  useEffect(() => {
    if (!store) return undefined;
    return () => store.remove(key);
  }, [store, key]);
}
