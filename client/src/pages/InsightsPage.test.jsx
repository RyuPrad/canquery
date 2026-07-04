import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InsightsPage from './InsightsPage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchTopDownloads: vi.fn(),
  fetchFeatured: vi.fn(),
  fetchResourceProfile: vi.fn(),
  queryResource: vi.fn(),
}));
import { fetchTopDownloads, fetchFeatured, fetchResourceProfile, queryResource } from '../api/catalog.js';

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
  // Default: nothing is chartable, so no carousel renders unless a test opts in.
  fetchFeatured.mockResolvedValue({ data: [] });
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

  test('the carousel charts only the chartable datasets; the full ranking lists them all', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4), mkItem(5)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    // Only d1 + d2 produce a chart server-side, so only those go in the carousel.
    fetchFeatured.mockResolvedValue({ data: [{ dataset_id: 'd1' }, { dataset_id: 'd2' }] });
    renderPage();
    // The carousel card for d1 profiles its representative resource...
    await waitFor(() => expect(fetchResourceProfile).toHaveBeenCalledWith('r1'));
    // ...and the leaderboard is fetched in the active UI language (default en).
    expect(fetchTopDownloads).toHaveBeenCalledWith('en');
    expect(fetchFeatured).toHaveBeenCalledWith('en');
    // ...but a non-chartable dataset (only a list row) never profiles.
    expect(fetchResourceProfile).not.toHaveBeenCalledWith('r4');
    // The full ranking still lists every dataset, including rank 5.
    await screen.findByText('Dataset 5');
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

  test('a ?focus= deep-link highlights the matching carousel card', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    fetchFeatured.mockResolvedValue({ data: items.map((it) => ({ dataset_id: it.dataset_id })) });
    render(<MemoryRouter initialEntries={['/insights?focus=d2']}><InsightsPage /></MemoryRouter>);
    await waitFor(() => {
      const el = document.getElementById('ds-d2');
      expect(el).toBeTruthy();
      expect(el.className).toContain('cq-focus-ring');
    });
  });

  // Regression: dropping the ?focus param re-runs the deep-link effect, and a
  // pulse timer owned by that effect gets cancelled by its cleanup - the ring
  // then never clears (cq-focus-ring's box-shadow is static, only the pulse
  // animation ends). The timer lives on highlightId now.
  test('the deep-link highlight ring clears after the pulse', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    fetchFeatured.mockResolvedValue({ data: items.map((it) => ({ dataset_id: it.dataset_id })) });
    vi.useFakeTimers();
    try {
      render(<MemoryRouter initialEntries={['/insights?focus=d2']}><InsightsPage /></MemoryRouter>);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(document.getElementById('ds-d2').className).toContain('cq-focus-ring');
      await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
      expect(document.getElementById('ds-d2').className).not.toContain('cq-focus-ring');
    } finally {
      vi.useRealTimers();
    }
  });
});
