import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import PlacePage from './PlacePage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchPlace: vi.fn(),
  fetchSources: vi.fn(),
  searchDatasets: vi.fn(),
}));
import { fetchPlace, fetchSources, searchDatasets } from '../api/catalog.js';

beforeEach(() => {
  vi.clearAllMocks();
  fetchPlace.mockResolvedValue({ data: {
    id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality',
    name: { en: 'Oshawa', fr: 'Oshawa' }, type: { en: 'City', fr: 'Ville' },
    ancestors: [
      { id: 'ca', slug: 'canada', name: { en: 'Canada', fr: 'Canada' } },
      { id: 'ca-on-oshawa', slug: 'oshawa-on', name: { en: 'Oshawa', fr: 'Oshawa' } },
    ],
    dataset_count: 12, direct_dataset_count: 2, mappable_dataset_count: 8, children: [],
  } });
  fetchSources.mockResolvedValue({ data: [{
    id: 'oshawa-hub', name: { en: 'Oshawa Hub', fr: null }, homepage_url: 'https://example.test'
  }] });
  searchDatasets.mockResolvedValue({ data: [{
    id: 'dataset-1', name: 'dataset-1', title: { en: 'Road network', fr: null },
    resource_count: 1, queryable_count: 0, mappable_count: 1,
    places: [], provenance: { sources: [] }
  }], pagination: { nextCursor: null } });
});

describe('PlacePage', () => {
  test('shows ancestry, sources and geographically filtered datasets', async () => {
    render(
      <MemoryRouter initialEntries={['/places/oshawa-on']}>
        <Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Oshawa' })).toBeInTheDocument();
    expect(screen.getByText('Oshawa Hub')).toBeInTheDocument();
    expect(await screen.findByText('Road network')).toBeInTheDocument();
    expect(searchDatasets).toHaveBeenCalledWith(expect.objectContaining({ place: 'oshawa-on', limit: 20 }));
  });

  test('explains inherited coverage and lists a region’s featured municipalities', async () => {
    fetchPlace.mockResolvedValueOnce({ data: {
      id: 'ca-on-durham', slug: 'durham-on', kind: 'region',
      name: { en: 'Durham', fr: 'Durham' }, type: { en: 'Regional municipality', fr: 'Municipalité régionale' },
      ancestors: [{ id: 'ca-on-durham', slug: 'durham-on', name: { en: 'Durham' } }],
      dataset_count: 350, direct_dataset_count: 350, mappable_dataset_count: 300,
      children: [{
        id: 'sgc-csd-3518017', slug: 'clarington-on', kind: 'municipality',
        name: { en: 'Clarington', fr: 'Clarington' }, dataset_count: 350,
        direct_dataset_count: 0
      }]
    } });
    render(
      <MemoryRouter initialEntries={['/places/durham-on']}>
        <Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Durham' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clarington/ })).toBeInTheDocument();
    expect(screen.getByText('Regional coverage')).toBeInTheDocument();
  });
});
