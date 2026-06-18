import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InsightsPage from './InsightsPage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchTopDownloads: vi.fn(),
  fetchResourceProfile: vi.fn(),
  queryResource: vi.fn(),
}));
import { fetchTopDownloads, fetchResourceProfile, queryResource } from '../api/catalog.js';

const PROFILE = { row_count: 420, columns: [
  { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
  { id: 'amount', type: 'NUMERIC', distinct: 400, nulls: 0, avg: 25000, min: 0, max: 500000 },
] };

const mkItem = (rank, over = {}) => ({
  rank,
  dataset_id: 'd' + rank,
  title: { en: 'Dataset ' + rank },
  department: 'Dept ' + rank,
  downloads: 1000 - rank,
  history: [{ y: 2026, m: 4, d: 900 - rank }, { y: 2026, m: 5, d: 1000 - rank }],
  resource_id: 'r' + rank,
  ingest_status: 'ready',
  row_count: 100,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchResourceProfile.mockResolvedValue({ data: PROFILE });
  queryResource.mockResolvedValue({ data: { records: [{ key: 'Approved', value: '200' }, { key: 'Pending', value: '120' }], total: 2 } });
});

const renderPage = () => render(<MemoryRouter><InsightsPage /></MemoryRouter>);

describe('InsightsPage top-100', () => {
  test('shows the leaderboard heading and the snapshot period', async () => {
    fetchTopDownloads.mockResolvedValue({ data: [mkItem(1)], meta: { period: { year: 2026, month: 5 } } });
    renderPage();
    expect(screen.getByText('Top 100 downloaded datasets')).toBeInTheDocument();
    await screen.findByText(/May 2026/i);
  });

  test('renders the top 3 as podium cards and the rest as compact rows', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4), mkItem(5)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    renderPage();
    // Podium card #1 profiles its representative resource.
    await waitFor(() => expect(fetchResourceProfile).toHaveBeenCalledWith('r1'));
    // Long-tail row #4 renders with a downloads label.
    await screen.findByText('Dataset 4');
    expect(screen.getAllByText('downloads').length).toBeGreaterThan(0);
  });

  test('a download-only dataset (no resource) does not profile', async () => {
    fetchTopDownloads.mockResolvedValue({ data: [mkItem(1, { resource_id: null, ingest_status: null })], meta: { period: { year: 2026, month: 5 } } });
    renderPage();
    await screen.findByText('Dataset 1');
    await waitFor(() => expect(fetchResourceProfile).not.toHaveBeenCalled());
  });

  test('empty state when the leaderboard is not seeded yet', async () => {
    fetchTopDownloads.mockResolvedValue({ data: [], meta: { period: null } });
    renderPage();
    await screen.findByText(/leaderboard is being prepared/i);
    expect(fetchResourceProfile).not.toHaveBeenCalled();
  });

  test('a ?focus= deep-link highlights the matching dataset card', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    render(<MemoryRouter initialEntries={['/insights?focus=d2']}><InsightsPage /></MemoryRouter>);
    await screen.findByText('Dataset 2');
    await waitFor(() => {
      const el = document.getElementById('ds-d2');
      expect(el).toBeTruthy();
      expect(el.className).toContain('cq-focus-ring');
    });
  });
});
