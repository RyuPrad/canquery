import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import PopularRail from './PopularRail.jsx';
import { fetchPopular } from '../api/catalog.js';

vi.mock('../api/catalog.js', () => ({ fetchPopular: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

test('links each popular table to its dataset by canonical slug, falling back to the id', async () => {
  fetchPopular.mockResolvedValue({ data: [
    { resource_id: 'r1', hits: 3, last_queried_at: '2026-10-01T00:00:00Z', name: { en: 'Permits' }, format: 'CSV',
      dataset: { id: 'd1', name: 'building-permits', title: { en: 'Building permits' } } },
    { resource_id: 'r2', hits: 1, last_queried_at: '2026-10-01T00:00:00Z', name: { en: 'Routes' }, format: 'CSV',
      dataset: { id: 'd2', title: { en: 'Roads' } } },
    { resource_id: 'r3', hits: 1, last_queried_at: '2026-10-01T00:00:00Z', name: { en: 'Orphan' }, format: 'CSV', dataset: null }
  ] });
  render(<MemoryRouter><PopularRail place="oshawa-on" /></MemoryRouter>);
  await screen.findByText('Permits');
  expect(fetchPopular).toHaveBeenCalledWith('oshawa-on');
  const hrefs = screen.getAllByRole('link').map(link => link.getAttribute('href'));
  expect(hrefs).toEqual(['/datasets/building-permits?highlight=r1', '/datasets/d2?highlight=r2', '/resources/r3']);
});
