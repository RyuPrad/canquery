import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ChartPanel from './ChartPanel.jsx';

vi.mock('../api/catalog.js', () => ({ queryResource: vi.fn() }));
import { queryResource } from '../api/catalog.js';

const FIELDS = [{ id: '_id', type: 'int' }, { id: 'province', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }];

beforeEach(() => {
  vi.clearAllMocks();
  queryResource.mockResolvedValue({ data: { records: [], total: 0 }, meta: {} });
});

describe('ChartPanel', () => {
  test('Bar toggle shows only for ingested resources', async () => {
    const { unmount } = render(
      <ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="ingested" />
    );
    expect(screen.getByText('Bar')).toBeInTheDocument();
    unmount();
    render(
      <ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="datastore" />
    );
    expect(screen.queryByText('Bar')).toBeNull();
  });

  test('bar mode renders rect elements from aggregated records', async () => {
    queryResource.mockResolvedValue({
      data: { records: [{ key: 'ON', value: '4' }, { key: 'QC', value: '2' }], total: 2 },
      meta: {}
    });
    const { container } = render(
      <ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="ingested" />
    );
    fireEvent.click(screen.getByText('Bar'));
    await waitFor(() => {
      expect(container.querySelectorAll('rect').length).toBe(2);
    });
    expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({
      group_by: 'province',
      agg: 'count',
      sort: 'value desc',
      limit: 100
    }));
  });

  test('count hides the value-column select', async () => {
    render(
      <ChartPanel resourceId="r1" q="" filters={{}} fields={FIELDS} queryMode="ingested" />
    );
    fireEvent.click(screen.getByText('Bar'));
    await waitFor(() => {
      expect(screen.queryByDisplayValue('amount')).toBeNull();
    });
    fireEvent.change(screen.getByDisplayValue('count'), { target: { value: 'sum' } });
    await waitFor(() => {
      expect(screen.getByDisplayValue('amount')).toBeInTheDocument();
    });
  });
});
