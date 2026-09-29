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
  TimeSeriesChart: () => <div>Time chart</div>,
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
});
