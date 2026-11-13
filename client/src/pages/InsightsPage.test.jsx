import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InsightsPage from './InsightsPage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchTopDownloads: vi.fn(),
  fetchInsightCards: vi.fn(),
  fetchResourceCharts: vi.fn(),
}));
vi.mock('../components/charts/ChartView.jsx', () => ({ default: ({ chart }) => <div>Chart {chart.id}</div> }));
import { fetchTopDownloads, fetchInsightCards, fetchResourceCharts } from '../api/catalog.js';
import { ANALYSIS, SHARE } from '../test/chartAnalysis.js';

// The engine's card of a dataset, as GET /web-api/v1/insights/charts answers.
const cardOf = (it) => ({ dataset_id: it.dataset_id, title: it.title, resource_id: it.resource_id, snapshot_at: '2026-09-29T12:00:00.000Z',
  rows: 288, kpis: ANALYSIS.kpis, chart: SHARE });

const mkItem = (rank, over = {}) => ({
  rank,
  dataset_id: 'd' + rank,
  dataset_name: 'dataset-' + rank,
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
  fetchInsightCards.mockResolvedValue({ data: [] });
  fetchResourceCharts.mockResolvedValue({ data: ANALYSIS });
});

const renderPage = () => render(<MemoryRouter><InsightsPage /></MemoryRouter>);

describe('InsightsPage top-100', () => {
  test('links every ranked dataset by its canonical slug, falling back to the id', async () => {
    fetchTopDownloads.mockResolvedValue({ data: [mkItem(1), mkItem(2, { dataset_name: null }), mkItem(3), mkItem(4)],
      meta: { period: { year: 2026, month: 5 } } });
    renderPage();
    await screen.findByText('Dataset 4');
    const hrefs = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(hrefs).toContain('/datasets/dataset-1?highlight=r1');
    expect(hrefs).toContain('/datasets/d2?highlight=r2');
    expect(hrefs).toContain('/datasets/dataset-4?highlight=r4');
    expect(hrefs.some(href => href.startsWith('/datasets/d1'))).toBe(false);
  });

  test('shows the leaderboard heading and the snapshot period', async () => {
    fetchTopDownloads.mockResolvedValue({ data: [mkItem(1)], meta: { period: { year: 2026, month: 5 } } });
    renderPage();
    expect(screen.getByText('Top 100 downloaded datasets')).toBeInTheDocument();
    await screen.findByText(/May 2026/i);
  });

  test('the carousel draws the engine\'s cards, with no request per card; the full ranking lists every dataset', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4), mkItem(5)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    // Only d1 + d2 have a card, so only those go in the carousel.
    fetchInsightCards.mockResolvedValue({ data: [cardOf(items[0]), cardOf(items[1])] });
    renderPage();
    expect(await screen.findAllByText('Chart c_aaaaaaaaaaaa')).toHaveLength(2);
    // Both are fetched in the active UI language (default en).
    expect(fetchTopDownloads).toHaveBeenCalledWith('en');
    expect(fetchInsightCards).toHaveBeenCalledWith('en');
    expect(fetchResourceCharts).not.toHaveBeenCalled();
    // The full ranking still lists every dataset, including rank 5.
    await screen.findByText('Dataset 5');
    expect(screen.getAllByText('downloads').length).toBeGreaterThan(0);
  });

  test('without cards the gallery still lists the ranking, and a download-only dataset charts nothing', async () => {
    fetchInsightCards.mockRejectedValue(new Error('Unavailable'));
    fetchTopDownloads.mockResolvedValue({ data: [mkItem(1, { resource_id: null, ingest_status: null })], meta: { period: { year: 2026, month: 5 } } });
    renderPage();
    await screen.findByText('Dataset 1');
    await waitFor(() => expect(fetchResourceCharts).not.toHaveBeenCalled());
    expect(document.getElementById('featured-section')).toBeNull();
  });

  test('empty state when the leaderboard is not seeded yet', async () => {
    fetchTopDownloads.mockResolvedValue({ data: [], meta: { period: null } });
    renderPage();
    await screen.findByText(/leaderboard is being prepared/i);
    expect(fetchResourceCharts).not.toHaveBeenCalled();
  });

  test('a ?focus= deep-link highlights the matching carousel card', async () => {
    const items = [mkItem(1), mkItem(2), mkItem(3), mkItem(4)];
    fetchTopDownloads.mockResolvedValue({ data: items, meta: { period: { year: 2026, month: 5 } } });
    fetchInsightCards.mockResolvedValue({ data: items.map(cardOf) });
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
    fetchInsightCards.mockResolvedValue({ data: items.map(cardOf) });
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
