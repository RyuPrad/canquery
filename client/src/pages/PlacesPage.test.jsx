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
      parent: { id: 'ca-on-durham', name: { en: 'Durham' } },
      dataset_count: 350, direct_dataset_count: 0, mappable_resource_count: 300
    },
    {
      id: 'sgc-cd-3521', slug: 'peel-on', kind: 'region',
      name: { en: 'Peel' }, type: { en: 'Regional municipality' },
      dataset_count: 901, direct_dataset_count: 139, mappable_resource_count: 609
    },
    {
      id: 'sgc-csd-3521005', slug: 'mississauga-on', kind: 'municipality',
      name: { en: 'Mississauga' }, type: { en: 'City' },
      parent: { id: 'sgc-cd-3521', name: { en: 'Peel' } },
      dataset_count: 429, direct_dataset_count: 290, mappable_resource_count: 222
    },
    {
      id: 'sgc-csd-3521024', slug: 'caledon-on', kind: 'municipality',
      name: { en: 'Caledon' }, type: { en: 'Town' },
      parent: { id: 'sgc-cd-3521', name: { en: 'Peel' } },
      dataset_count: 139, direct_dataset_count: 0, mappable_resource_count: 106
    },
    {
      id: 'sgc-cd-3520', slug: 'toronto-on', kind: 'municipality',
      name: { en: 'Toronto' }, type: { en: 'City' },
      parent: { id: 'ca-on', name: { en: 'Ontario' } },
      dataset_count: 556, direct_dataset_count: 556, mappable_resource_count: 187
    }
  ] });
});

describe('PlacesPage', () => {
  test('loads the curated directory and labels inherited regional coverage', async () => {
    render(<MemoryRouter><PlacesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Featured regions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Municipalities in Durham' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Municipalities in Peel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured cities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Toronto/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clarington/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mississauga/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Caledon/ })).toBeInTheDocument();
    expect(screen.getAllByText('Broader-area coverage')).toHaveLength(2);
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
