import { describe, expect, test } from 'vitest';
import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChartLoadContext, createChartLoadStore, useChartLoadReport } from './useChartLoadReport.js';

function Unit({ kind, initial = 'loading' }) {
  const [state, setState] = useState(initial);
  useChartLoadReport(kind, state);
  return <button type="button" onClick={() => setState('settled')}>{kind + ' ' + state}</button>;
}

describe('chart load store', () => {
  test('sums units and keeps one snapshot until something changes', () => {
    const store = createChartLoadStore();
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    const empty = store.getSnapshot();
    expect(empty).toEqual({ count: 0, chunk: 0, profile: null, charts: { total: 0, settled: 0 } });
    store.set('a', 'profile', 'loading');
    store.set('b', 'chart', 'loading');
    const loading = store.getSnapshot();
    expect(loading).toEqual({ count: 2, chunk: 0, profile: 'loading', charts: { total: 2 - 1, settled: 0 } });
    store.set('b', 'chart', 'loading');
    expect(store.getSnapshot()).toBe(loading);
    store.set('b', 'chart', 'settled');
    store.remove('a');
    store.remove('missing');
    expect(store.getSnapshot()).toEqual({ count: 1, chunk: 0, profile: null, charts: { total: 1, settled: 1 } });
    expect(calls).toBe(4);
  });

  test('a component reports while mounted, also under StrictMode, and nothing happens without a provider', () => {
    const store = createChartLoadStore();
    const { rerender } = render(
      <StrictMode>
        <ChartLoadContext.Provider value={store}>
          <Unit kind="profile" />
          <Unit kind="chart" />
        </ChartLoadContext.Provider>
      </StrictMode>
    );
    expect(store.getSnapshot()).toEqual({ count: 2, chunk: 0, profile: 'loading', charts: { total: 1, settled: 0 } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'chart loading' })); });
    expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 });
    rerender(
      <StrictMode>
        <ChartLoadContext.Provider value={store}>
          <Unit kind="profile" />
        </ChartLoadContext.Provider>
      </StrictMode>
    );
    expect(store.getSnapshot()).toEqual({ count: 1, chunk: 0, profile: 'loading', charts: { total: 0, settled: 0 } });

    render(<Unit kind="chart" />);
    expect(screen.getAllByRole('button', { name: 'chart loading' })).toHaveLength(1);
  });
});
