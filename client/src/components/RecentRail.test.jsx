import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import RecentRail from './RecentRail.jsx';
import { fetchRecentlyUnlocked } from '../api/catalog.js';

vi.mock('../api/catalog.js', () => ({ fetchRecentlyUnlocked: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

test('links each recently loaded table to its dataset by canonical slug, falling back to the id', async () => {
  fetchRecentlyUnlocked.mockResolvedValue({ data: [
    { resource_id: 'r1', ingested_at: '2026-10-01T00:00:00Z', row_count: 10, name: { en: 'Permits' }, format: 'CSV',
      dataset: { id: 'd1', name: 'building-permits', title: { en: 'Building permits' } } },
    { resource_id: 'r2', ingested_at: '2026-10-01T00:00:00Z', row_count: 10, name: { en: 'Routes' }, format: 'CSV',
      dataset: { id: 'd2', title: { en: 'Roads' } } }
  ] });
  render(<MemoryRouter><RecentRail /></MemoryRouter>);
  await screen.findByText('Permits');
  const hrefs = screen.getAllByRole('link').map(link => link.getAttribute('href'));
  expect(hrefs).toEqual(['/datasets/building-permits?highlight=r1', '/datasets/d2?highlight=r2']);
});
