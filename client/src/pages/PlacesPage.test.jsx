import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import PlacesPage from './PlacesPage.jsx';

vi.mock('../api/catalog.js', () => ({ fetchPlaces: vi.fn() }));
import { fetchPlaces } from '../api/catalog.js';

beforeEach(() => {
  vi.clearAllMocks();
  fetchPlaces.mockResolvedValue({ data: [
    {
      id: 'ca-on-durham', slug: 'durham-on', kind: 'region',
      name: { en: 'Durham' }, type: { en: 'Regional municipality' },
      dataset_count: 350, direct_dataset_count: 350, mappable_resource_count: 300
    },
    {
      id: 'sgc-csd-3518017', slug: 'clarington-on', kind: 'municipality',
      name: { en: 'Clarington' }, type: { en: 'Municipality' },
      dataset_count: 350, direct_dataset_count: 0, mappable_resource_count: 300
    }
  ] });
});

describe('PlacesPage', () => {
  test('loads the curated directory and labels inherited regional coverage', async () => {
    render(<MemoryRouter><PlacesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Featured region' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Durham municipalities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clarington/ })).toBeInTheDocument();
    expect(screen.getByText('Regional coverage')).toBeInTheDocument();
    await waitFor(() => expect(fetchPlaces).toHaveBeenCalledWith({
      q: undefined, featured: true, limit: 100
    }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Find a city, region or province...' }), {
      target: { value: 'Toronto' }
    });
    await waitFor(() => expect(fetchPlaces).toHaveBeenCalledWith({
      q: 'Toronto', featured: undefined, limit: 100
    }));
  });
});
