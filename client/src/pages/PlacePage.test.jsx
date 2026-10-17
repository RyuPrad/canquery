import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import PlacePage from './PlacePage.jsx';
import { LangProvider } from '../i18n.jsx';
import { ApiError, NotFoundError } from '../api/client.js';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchOrganizations: vi.fn(() => Promise.resolve({ data: [] })),
  fetchPlace: vi.fn(),
  fetchPlaces: vi.fn(() => Promise.resolve({ data: [] })),
  fetchPopular: vi.fn(() => Promise.resolve(null)),
  fetchRecentlyUnlocked: vi.fn(() => Promise.resolve(null)),
  fetchSources: vi.fn(),
  searchDatasets: vi.fn(),
}));
import { fetchOrganizations, fetchPlace, fetchPlaces, fetchSources, searchDatasets } from '../api/catalog.js';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchPlace.mockResolvedValue({ data: {
    id: 'ca-on-oshawa', slug: 'oshawa-on', kind: 'municipality', parent_id: 'ca-on-durham',
    name: { en: 'Oshawa', fr: 'Oshawa' }, type: { en: 'City', fr: 'Ville' },
    ancestors: [
      { id: 'ca', slug: 'canada', name: { en: 'Canada', fr: 'Canada' } },
      { id: 'ca-on', slug: 'ontario', kind: 'province', name: { en: 'Ontario', fr: 'Ontario' } },
      { id: 'ca-on-oshawa', slug: 'oshawa-on', name: { en: 'Oshawa', fr: 'Oshawa' } },
    ],
    dataset_count: 12, direct_dataset_count: 2, mappable_dataset_count: 8, children: [],
  } });
  fetchOrganizations.mockResolvedValue({ data: [{
    id: 'o1', name: 'city-of-oshawa', title: { en: 'City of Oshawa', fr: 'Ville d’Oshawa' }, dataset_count: 2
  }] });
  fetchPlaces.mockResolvedValue({ data: [
    { id: 'ca-on-oshawa', slug: 'oshawa-on', name: { en: 'Oshawa' }, dataset_count: 12 },
    { id: 'ca-on-whitby', slug: 'whitby-on', name: { en: 'Whitby' }, dataset_count: 9, direct_dataset_count: 1 }
  ] });
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
  test.each([
    new NotFoundError('Missing place', 404), new ApiError('Temporary catalogue failure', 503)
  ])('recovers from $message when navigating to another place', async error => {
    fetchPlace.mockRejectedValueOnce(error);
    function Navigation() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/places/oshawa-on')}>Valid place</button>;
    }
    render(<MemoryRouter initialEntries={['/places/missing']}>
      <Navigation /><Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText(error.status === 404 ? 'Place not found' : error.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Valid place' }));
    expect(await screen.findByRole('heading', { name: 'Oshawa open data' })).toBeInTheDocument();
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
  });

  test('a different place starts with its own unfiltered catalogue', async () => {
    function Navigation() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/places/another-place')}>Other place</button>;
    }
    render(<MemoryRouter initialEntries={['/places/oshawa-on']}>
      <Navigation /><Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByRole('heading', { name: 'Oshawa open data' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'roads' } });
    fireEvent.click(screen.getByRole('button', { name: 'Has a map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Other place' }));
    await screen.findByRole('heading', { name: 'Oshawa open data' });
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Has a map' })).toHaveAttribute('aria-pressed', 'false');
    expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ place: 'another-place', q: undefined, mappable: undefined }));
  });

  test('shows ancestry, sources and geographically filtered datasets', async () => {
    searchDatasets.mockResolvedValue({ data: [{
      id: 'dataset-1', name: 'dataset-1', title: { en: 'Road network', fr: null },
      resource_count: 1, queryable_count: 0, mappable_count: 1,
      places: [], provenance: { sources: [] }
    }], pagination: { nextCursor: null }, meta: { facets: {
      level: [{ value: 'municipal', count: 10 }, { value: 'federal', count: 2 }],
      access: [{ value: 'queryable', count: 3 }, { value: 'mappable', count: 8 }],
      format: [{ value: 'CSV', count: 7 }]
    } } });
    render(
      <MemoryRouter initialEntries={['/places/oshawa-on']}>
        <Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Oshawa open data' })).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Places' })).toHaveAttribute('href', '/places');
    expect(within(breadcrumb).getByRole('link', { name: 'Canada' })).toHaveAttribute('href', '/places/canada');
    expect(within(breadcrumb).getByText('Oshawa')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Oshawa Hub')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Official portals' })).toBeInTheDocument();
    expect((await screen.findAllByText('Road network')).length).toBeGreaterThan(0);
    expect(searchDatasets).toHaveBeenCalledWith(expect.objectContaining({ place: 'oshawa-on', limit: 50, facets: 1 }));

    // Intro and breakdown come from the counts and the unfiltered facet summary.
    expect(screen.getByText(/12 open datasets for Oshawa, Ontario; 8 with interactive maps; 3 with live tables\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datasets by level and access' })).toBeInTheDocument();
    expect(screen.getByText('Municipal and regional · 10')).toBeInTheDocument();
    expect(screen.getByText('CSV · 7')).toBeInTheDocument();

    // Publishers, maps and the dataset list have their own headings.
    expect(await screen.findByRole('heading', { name: 'Publishers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /City of Oshawa/ })).toHaveAttribute('href', '/organizations/city-of-oshawa');
    expect(fetchOrganizations).toHaveBeenCalledWith({ place: 'oshawa-on', limit: 12 });
    expect(screen.getByRole('heading', { name: 'Datasets with maps' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datasets' })).toBeInTheDocument();

    // Nearby: the province link and the featured siblings under the same parent, never the place itself.
    expect(await screen.findByRole('heading', { name: 'Nearby places' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ontario open data' })).toHaveAttribute('href', '/places/ontario');
    expect(screen.getByRole('heading', { name: 'Other places nearby' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Whitby/ })).toHaveAttribute('href', '/places/whitby-on');
    expect(screen.queryByRole('link', { name: /^Oshawa 12 datasets/ })).not.toBeInTheDocument();
    expect(fetchPlaces).toHaveBeenCalledWith({ parent: 'ca-on-durham', featured: true, limit: 12 });
  });

  test('filtering hides the hub sections and stops asking for facets', async () => {
    render(
      <MemoryRouter initialEntries={['/places/oshawa-on']}>
        <Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: 'Oshawa open data' });
    expect(screen.queryByRole('heading', { name: 'Datasets by level and access' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Has a map' }));
    await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ mappable: true, facets: undefined })));
    expect(screen.queryByRole('heading', { name: 'Datasets with maps' })).not.toBeInTheDocument();
  });

  test('localizes the place breadcrumb in French', async () => {
    localStorage.setItem('cq-lang', 'fr');
    render(
      <LangProvider>
        <MemoryRouter initialEntries={['/places/oshawa-on']}>
          <Routes><Route path="/places/:slug" element={<PlacePage />} /></Routes>
        </MemoryRouter>
      </LangProvider>
    );

    const breadcrumb = await screen.findByRole('navigation', { name: 'Fil d’Ariane' });
    expect(within(breadcrumb).getByRole('link', { name: 'Lieux' })).toHaveAttribute('href', '/places');
    expect(within(breadcrumb).getByText('Oshawa')).toHaveAttribute('aria-current', 'page');
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

    expect(await screen.findByRole('heading', { name: 'Durham open data' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clarington/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Municipalities in this region' })).toBeInTheDocument();
    expect(screen.getByText('Broader-area coverage')).toBeInTheDocument();
  });
});
