import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChartBuilder from './ChartBuilder.jsx';
import { queryResource } from '../api/catalog.js';

vi.mock('../api/catalog.js', () => ({ queryResource: vi.fn() }));
vi.mock('./charts/Visuals.jsx', () => ({
  ChartCard: ({ children }) => <section>{children}</section>,
  ChartSkeleton: () => <div>Chart loading</div>,
  ChartEmpty: ({ label }) => <div>{label}</div>,
  DonutChart: () => <div>Donut chart</div>,
  CategoryBar: () => <div>Bar chart</div>,
  TimeSeriesChart: ({ records }) => <div>Time chart {records.map((r) => r.key).join(',')}</div>,
}));

const fields = [{ id: '_id', type: 'INTEGER' }, { id: 'province', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }];
beforeEach(() => {
  vi.clearAllMocks();
  queryResource.mockResolvedValue({ data: { records: [{ key: 'ON', value: 2 }], total: 1 } });
});

describe('custom aggregation controls', () => {
  test('every select has its visible control label', async () => {
    render(<ChartBuilder resourceId="r1" fields={fields} queryMode="ingested" />);
    expect(screen.getByRole('combobox', { name: 'X axis' })).toHaveValue('province');
    fireEvent.change(screen.getByRole('combobox', { name: 'Function' }), { target: { value: 'sum' } });
    expect(screen.getByRole('combobox', { name: 'Value column' })).toHaveValue('amount');
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ agg: 'sum', agg_column: 'amount' }), expect.any(Object)));
  });

  test('min on a text-only schema selects a real column and preserves text results', async () => {
    queryResource.mockImplementation((_id, params) => Promise.resolve({ data: { records: [{ key: 'ON', value: params.agg === 'min' ? 'Ottawa' : 2 }], total: 1 } }));
    render(<ChartBuilder resourceId="r1" fields={fields.filter(field => field.type !== 'NUMERIC')} queryMode="ingested" />);
    await waitFor(() => expect(queryResource).toHaveBeenCalled());
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'min' } });
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ agg: 'min', agg_column: 'province' }), expect.any(Object)));
    expect(await screen.findByText('Ottawa')).toBeInTheDocument();
    expect(screen.queryByText('No data yet.')).toBeNull();
  });

  test('date extrema remain readable and every aggregation retains active search filters', async () => {
    queryResource.mockImplementation((_id, params) => Promise.resolve({ data: { records: [{ key: 'ON', value: params.agg_column === 'recorded_at' ? '2026-09-29T00:00:00.000Z' : 2 }], total: 1 } }));
    const filters = { province: { op: 'eq', value: 'ON' } };
    render(<ChartBuilder resourceId="r1" q="Ottawa" filters={filters} fields={[...fields, { id: 'recorded_at', type: 'TIMESTAMPTZ' }]} queryMode="ingested" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Function' }), { target: { value: 'max' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Value column' }), { target: { value: 'recorded_at' } });
    expect(await screen.findByText('2026-09-29T00:00:00.000Z')).toBeInTheDocument();
    expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ q: 'Ottawa', filters, agg: 'max', agg_column: 'recorded_at' }), expect.any(Object));
    fireEvent.change(screen.getByRole('combobox', { name: 'Function' }), { target: { value: 'sum' } });
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ agg: 'sum', agg_column: 'amount' }), expect.any(Object)));
    expect(queryResource.mock.calls.some(([, params]) => params.agg === 'sum' && params.agg_column === 'recorded_at')).toBe(false);
  });

  test('a schema with no recorded columns shows an empty state instead of an endless skeleton', () => {
    render(<ChartBuilder resourceId="r1" fields={[fields[0]]} queryMode="ingested" />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
    expect(screen.queryByText('Chart loading')).toBeNull();
    expect(queryResource).not.toHaveBeenCalled();
  });

  test('date axes fetch the newest periods and render them chronologically', async () => {
    queryResource.mockResolvedValue({ data: { records: [{ key: '2026', value: 3 }, { key: '2025', value: 2 }], total: 40 } });
    const dateFields = [{ id: 'recorded_at', type: 'TIMESTAMPTZ' }, { id: 'amount', type: 'NUMERIC' }];
    render(<ChartBuilder resourceId="r1" fields={dateFields} queryMode="ingested" />);
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ group_by: 'recorded_at', sort: 'key desc', limit: 100 }), expect.any(Object)));
    expect(await screen.findByText('Time chart 2025,2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Line' })).toBeInTheDocument();
  });

  test('categorical axes do not offer a line and keep largest-first bars', async () => {
    render(<ChartBuilder resourceId="r1" fields={fields} queryMode="ingested" />);
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ group_by: 'province', sort: 'value desc' }), expect.any(Object)));
    expect(screen.queryByRole('button', { name: 'Line' })).toBeNull();
  });

  test('year-like columns from the profile classifier still offer a line', async () => {
    const yearFields = [{ id: 'fiscal_year', type: 'INTEGER' }, { id: 'amount', type: 'NUMERIC' }];
    const classified = { dates: [{ id: 'fiscal_year', bucket: null }], dimensions: [], measures: [{ id: 'amount' }], columns: [{ id: 'fiscal_year', distinct: 10 }] };
    render(<ChartBuilder resourceId="r1" fields={yearFields} queryMode="ingested" classified={classified} />);
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ group_by: 'fiscal_year', agg: 'avg', sort: 'key desc' }), expect.any(Object)));
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('donut is unavailable for averages and for too many groups', async () => {
    const classified = { dates: [], dimensions: [{ id: 'province', distinct: 40 }], measures: [], columns: [{ id: 'province', distinct: 40 }] };
    render(<ChartBuilder resourceId="r1" fields={fields} queryMode="ingested" classified={classified} />);
    const donut = await screen.findByRole('button', { name: /Donut unavailable: too many groups/ });
    expect(donut).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Function' }), { target: { value: 'avg' } });
    expect(screen.getByRole('button', { name: /Donut unavailable: only counts and sums/ })).toBeDisabled();
  });

  test('a donut that would be incomplete explains why bars are shown', async () => {
    queryResource.mockResolvedValue({ data: { records: [{ key: 'ON', value: 2 }], total: 30 } });
    const classified = { dates: [], dimensions: [{ id: 'province', distinct: 5 }], measures: [], columns: [{ id: 'province', distinct: 5 }] };
    render(<ChartBuilder resourceId="r1" fields={fields} queryMode="ingested" classified={classified} />);
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('r1', expect.objectContaining({ group_by: 'province', limit: 16 }), expect.any(Object)));
    expect(await screen.findByText(/more groups than a donut can show/)).toBeInTheDocument();
    expect(screen.getByText('Bar chart')).toBeInTheDocument();
  });
});

describe('the loading card', () => {
  test('counts the custom chart until it draws, and an empty schema at once', async () => {
    const { ChartLoadContext, createChartLoadStore } = await import('../hooks/useChartLoadReport.js');
    const store = createChartLoadStore();
    let resolve;
    queryResource.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<ChartLoadContext.Provider value={store}><ChartBuilder resourceId="r1" fields={fields} queryMode="ingested" /></ChartLoadContext.Provider>);
    await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 0 }));
    resolve({ data: { records: [{ key: 'ON', value: 2 }], total: 1 } });
    await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 }));
    view.unmount();

    render(<ChartLoadContext.Provider value={store}><ChartBuilder resourceId="r1" fields={[{ id: '_id', type: 'INTEGER' }]} queryMode="ingested" /></ChartLoadContext.Provider>);
    expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 });
  });
});
