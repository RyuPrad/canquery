import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ChartPanel from './ChartPanel.jsx';

vi.mock('../api/catalog.js', () => ({ queryResource: vi.fn(), fetchResourceProfile: vi.fn() }));
import { queryResource, fetchResourceProfile } from '../api/catalog.js';

const FIELDS = [{ id: '_id', type: 'int' }, { id: 'province', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }];

const PROFILE = {
  row_count: 1000,
  columns: [
    { id: 'province', type: 'TEXT', distinct: 13, nulls: 0 },
    { id: 'amount', type: 'NUMERIC', distinct: 850, nulls: 0, min: 0, max: 100, avg: 42 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchResourceProfile.mockResolvedValue({ data: PROFILE, meta: {} });
  queryResource.mockResolvedValue({
    data: { records: [{ key: 'ON', value: '4' }, { key: 'QC', value: '2' }], total: 2, fields: FIELDS },
    meta: {},
  });
});

describe('ChartPanel', () => {
  test('ingested resources default to an auto Insights dashboard', async () => {
    render(<ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="ingested" />);
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();

    await waitFor(() => expect(fetchResourceProfile).toHaveBeenCalledWith('r1'));
    // KPI row surfaces the headline row count (locale-formatted).
    await waitFor(() => expect(screen.getByText('Total rows')).toBeInTheDocument());
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0);

    // Auto-charts aggregate by the categorical dimension - never the unique _id.
    await waitFor(() =>
      expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({ group_by: 'province', agg: 'count' }))
    );
    const groupBys = queryResource.mock.calls.map((c) => c[1].group_by);
    expect(groupBys).not.toContain('_id');
  });

  test('datastore resources skip Insights and use the series builder', async () => {
    render(<ChartPanel resourceId="d1" q="" filters={{}} fields={FIELDS} queryMode="datastore" />);
    expect(screen.queryByText('Insights')).toBeNull();
    expect(fetchResourceProfile).not.toHaveBeenCalled();
    await waitFor(() => expect(queryResource).toHaveBeenCalled());
    // The series path never sends server-side aggregation params.
    expect(queryResource.mock.calls.every((c) => c[1].group_by === undefined)).toBe(true);
  });

  test('Custom tab aggregates by a sensible default column, not a unique id', async () => {
    render(<ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="ingested" />);
    fireEvent.click(screen.getByText('Custom'));
    await waitFor(() =>
      expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({ group_by: 'province', agg: 'count', sort: 'value desc' }))
    );
  });

  test('count hides the value-column select; switching to sum reveals it', async () => {
    render(<ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="ingested" />);
    fireEvent.click(screen.getByText('Custom'));
    await waitFor(() => expect(screen.getByDisplayValue('count')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('amount')).toBeNull();
    fireEvent.change(screen.getByDisplayValue('count'), { target: { value: 'sum' } });
    await waitFor(() => expect(screen.getByDisplayValue('amount')).toBeInTheDocument());
  });
});
