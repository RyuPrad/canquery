import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import OrganizationPage from './OrganizationPage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchOrganization: vi.fn(),
  searchDatasets: vi.fn(),
}));
import { fetchOrganization, searchDatasets } from '../api/catalog.js';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchOrganization.mockResolvedValue({ data: {
    id: 'o1', name: 'city-works',
    title: { en: 'City Works', fr: 'Travaux municipaux' },
    dataset_count: 23, queryable_dataset_count: 4, mappable_dataset_count: 8,
    place: { id: 'p1', slug: 'example-on', name: { en: 'Example', fr: 'Exemple' } },
  } });
  searchDatasets.mockResolvedValue({
    data: [{
      id: 'd1', name: 'roads', title: { en: 'Road network', fr: 'Réseau routier' },
      organization: { name: 'city-works', title: { en: 'City Works', fr: 'Travaux municipaux' } },
      resource_count: 2, queryable_count: 1, mappable_count: 1,
      places: [], provenance: { sources: [] },
    }],
    pagination: { nextCursor: null },
  });
});

describe('OrganizationPage', () => {
  test('shows publisher capability counts, place context, and filtered datasets', async () => {
    render(
      <MemoryRouter initialEntries={['/organizations/city-works']}>
        <Routes><Route path="/organizations/:name" element={<OrganizationPage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'City Works' })).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Organizations' })).toHaveAttribute('href', '/organizations');
    expect(screen.getByText('23 datasets')).toBeInTheDocument();
    expect(screen.getByText('4 queryable')).toBeInTheDocument();
    expect(screen.getByText('8 mappable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example' })).toHaveAttribute('href', '/places/example-on');
    expect(await screen.findByText('Road network')).toBeInTheDocument();
    expect(searchDatasets).toHaveBeenCalledWith(expect.objectContaining({ org: 'city-works', limit: 20 }));

    fireEvent.click(screen.getByRole('button', { name: 'Has a map' }));
    await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({
      org: 'city-works', mappable: true
    })));
  });

  test('keeps the interactive organization page bilingual', async () => {
    localStorage.setItem('cq-lang', 'fr');
    render(
      <LangProvider>
        <MemoryRouter initialEntries={['/organizations/city-works']}>
          <Routes><Route path="/organizations/:name" element={<OrganizationPage />} /></Routes>
        </MemoryRouter>
      </LangProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Travaux municipaux' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exemple' })).toHaveAttribute('href', '/places/example-on');
    expect(screen.getByRole('navigation', { name: 'Fil d’Ariane' })).toBeInTheDocument();
  });
});
