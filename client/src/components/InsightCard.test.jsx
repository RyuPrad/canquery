import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import InsightCard from './InsightCard.jsx';
import { fetchResourceCharts } from '../api/catalog.js';
import { ANALYSIS, SHARE } from '../test/chartAnalysis.js';

vi.mock('../api/catalog.js', () => ({ fetchResourceCharts: vi.fn() }));
vi.mock('./charts/ChartView.jsx', () => ({ default: ({ chart }) => <div>Chart {chart.id}</div> }));
const tile = (id, props = {}) => <MemoryRouter><InsightCard item={{ resource_id: id, name: { en: 'Dataset' } }} {...props} /></MemoryRouter>;
const engineCard = { dataset_id: 'd1', title: { en: 'Dataset' }, resource_id: 'english', snapshot_at: '2026-09-29T12:00:00.000Z', rows: 288,
  kpis: ANALYSIS.kpis, chart: SHARE };

beforeEach(() => { vi.clearAllMocks(); });

test('a tile with the engine\'s card draws it with its figures and asks for nothing', () => {
  render(tile('english', { card: engineCard }));
  expect(screen.getByText('Chart c_aaaaaaaaaaaa')).toBeInTheDocument();
  expect(screen.getByText('288')).toBeInTheDocument();
  expect(screen.getByText('≥ 1,000')).toBeInTheDocument();
  expect(fetchResourceCharts).not.toHaveBeenCalled();
});

test('without a card, the tile asks the engine for one chart as a background read', async () => {
  fetchResourceCharts.mockResolvedValueOnce({ data: ANALYSIS });
  render(tile('english'));
  expect(await screen.findByText('Chart c_aaaaaaaaaaaa')).toBeInTheDocument();
  expect(fetchResourceCharts).toHaveBeenCalledWith('english', { lang: 'en', purpose: 'card', limit: 1 }, { background: true });
});

test('a table with no chart worth a card says so', async () => {
  fetchResourceCharts.mockResolvedValueOnce({ data: { ...ANALYSIS, status: 'no_charts', charts: [], kpis: [{ role: 'rows', value: 5 }] } });
  render(tile('english'));
  expect(await screen.findByText("We couldn't auto-detect chartable columns here.")).toBeInTheDocument();
});

test('a replacement representative resource never displays the previous chart', async () => {
  fetchResourceCharts.mockResolvedValueOnce({ data: ANALYSIS }).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(tile('english'));
  expect(await screen.findByText('Chart c_aaaaaaaaaaaa')).toBeInTheDocument();
  view.rerender(tile('french'));
  expect(screen.queryByText('Chart c_aaaaaaaaaaaa')).not.toBeInTheDocument();
});

test('links to the canonical dataset slug when the API supplies one, else to the id', () => {
  fetchResourceCharts.mockImplementation(() => new Promise(() => {}));
  const named = render(<MemoryRouter><InsightCard item={{ resource_id: 'r1', name: { en: 'Dataset' },
    dataset: { id: 'd1', name: 'roads', title: { en: 'Roads' } } }} /></MemoryRouter>);
  expect(named.container.querySelector('a[href="/datasets/roads?highlight=r1"]')).not.toBeNull();
  named.unmount();
  const byId = render(<MemoryRouter><InsightCard item={{ resource_id: 'r1', name: { en: 'Dataset' },
    dataset: { id: 'd1', title: { en: 'Roads' } } }} /></MemoryRouter>);
  expect(byId.container.querySelector('a[href="/datasets/d1?highlight=r1"]')).not.toBeNull();
});

test('a previous error does not hide a successfully loaded replacement', async () => {
  fetchResourceCharts.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ data: ANALYSIS });
  const view = render(tile('english'));
  expect(await screen.findByText("Couldn't load insights for this table.")).toBeInTheDocument();
  view.rerender(tile('french'));
  await act(async () => {});
  expect(await screen.findByText('Chart c_aaaaaaaaaaaa')).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load insights for this table.")).not.toBeInTheDocument();
});
