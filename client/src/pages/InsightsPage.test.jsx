import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InsightsPage from './InsightsPage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchRecentlyUnlocked: vi.fn(),
  fetchResourceProfile: vi.fn(),
  queryResource: vi.fn(),
}));
import { fetchRecentlyUnlocked, fetchResourceProfile, queryResource } from '../api/catalog.js';

const ITEM = { resource_id: 'r1', name: { en: 'Grants by province' }, dataset: { title: { en: 'Federal Grants' } }, row_count: 420, ingested_at: '2026-06-14' };
const PROFILE = { row_count: 420, columns: [
  { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
  { id: 'amount', type: 'NUMERIC', distinct: 400, nulls: 0, avg: 25000, min: 0, max: 500000 },
] };

beforeEach(() => {
  vi.clearAllMocks();
  fetchRecentlyUnlocked.mockResolvedValue({ data: [ITEM] });
  fetchResourceProfile.mockResolvedValue({ data: PROFILE });
  queryResource.mockResolvedValue({ data: { records: [{ key: 'Approved', value: '200' }, { key: 'Pending', value: '120' }, { key: 'Rejected', value: '100' }], total: 3 } });
});

const renderPage = () => render(<MemoryRouter><InsightsPage /></MemoryRouter>);

describe('InsightsPage gallery', () => {
  test('shows the page heading', () => {
    renderPage();
    expect(screen.getByText('Data, visualized')).toBeInTheDocument();
  });

  test('lists unlocked resources and profiles each card with a real-dimension hero chart', async () => {
    renderPage();
    expect(fetchRecentlyUnlocked).toHaveBeenCalled();
    await screen.findByText('Grants by province');
    await waitFor(() => expect(fetchResourceProfile).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({ group_by: 'status' })));
    const groupBys = queryResource.mock.calls.map((c) => c[1].group_by);
    expect(groupBys).not.toContain('_id');
  });

  test('empty state when nothing is unlocked', async () => {
    fetchRecentlyUnlocked.mockResolvedValue({ data: [] });
    renderPage();
    await screen.findByText(/No visualized datasets yet/i);
    expect(fetchResourceProfile).not.toHaveBeenCalled();
  });
});
