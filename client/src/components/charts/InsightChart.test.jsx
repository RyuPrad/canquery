import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import InsightChart from './InsightChart.jsx';
import { queryResource } from '../../api/catalog.js';

vi.mock('../../api/catalog.js', () => ({ queryResource: vi.fn() }));
vi.mock('./Visuals.jsx', () => ({
  ChartCard: ({ subtitle, children }) => <section><p>{subtitle}</p>{children}</section>,
  ChartSkeleton: () => <div>Chart loading</div>,
  ChartEmpty: ({ label }) => <div>{label}</div>,
  DonutChart: () => <div>Donut chart</div>,
  CategoryBar: () => <div>Bar chart</div>,
  TimeSeriesChart: ({ records }) => <div>Time chart {records.map((r) => r.key).join(',')}</div>,
}));

beforeEach(() => vi.clearAllMocks());

test('time insights show the latest window in chronological order', async () => {
  queryResource.mockResolvedValue({ data: { records: [{ key: '2024', value: 3 }, { key: '2023', value: null }, { key: '2022', value: 1 }], total: 150 } });
  const spec = { kind: 'timeseries', role: 'time', column: 'fiscal_year', agg: 'count', bucket: null, categorical: true, colorOffset: 0 };
  render(<InsightChart resourceId="r1" spec={spec} />);
  await waitFor(() => expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({ sort: 'key desc', limit: 100 }), expect.any(Object)));
  expect(await screen.findByText('Time chart 2022,2024')).toBeInTheDocument();
  expect(screen.getByText(/Latest 2 periods/)).toBeInTheDocument();
});

test('breakdowns keep their largest groups first', async () => {
  queryResource.mockResolvedValue({ data: { records: [{ key: 'ON', value: 3 }], total: 1 } });
  const spec = { kind: 'bar', role: 'breakdown', column: 'province', agg: 'count', colorOffset: 1 };
  render(<InsightChart resourceId="r1" spec={spec} />);
  await waitFor(() => expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({ sort: 'value desc', limit: 12 }), expect.any(Object)));
  expect(await screen.findByText('Bar chart')).toBeInTheDocument();
});

test('tells the loading card when its numbers arrive or fail', async () => {
  const { ChartLoadContext, createChartLoadStore } = await import('../../hooks/useChartLoadReport.js');
  const store = createChartLoadStore();
  let resolve;
  queryResource.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const spec = { kind: 'bar', role: 'breakdown', column: 'province', agg: 'count', colorOffset: 1 };
  const view = render(<ChartLoadContext.Provider value={store}><InsightChart resourceId="r1" spec={spec} /></ChartLoadContext.Provider>);
  await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 0 }));
  resolve({ data: { records: [{ key: 'ON', value: 3 }], total: 1 } });
  await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 }));
  view.unmount();
  expect(store.getSnapshot().count).toBe(0);

  queryResource.mockRejectedValueOnce(new Error('rate limited'));
  render(<ChartLoadContext.Provider value={store}><InsightChart resourceId="r1" spec={spec} /></ChartLoadContext.Provider>);
  await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 }));
});
