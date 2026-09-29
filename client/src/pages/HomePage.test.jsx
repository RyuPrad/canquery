import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import HomePage from './HomePage.jsx';
import PlacesPage from './PlacesPage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../components/LocalGuides.jsx', () => ({ default: () => null }));
vi.mock('../components/MochiPromotion.jsx', () => ({ default: () => null }));
vi.mock('../components/RecentRail.jsx', () => ({ default: () => null }));
vi.mock('../components/PopularRail.jsx', () => ({ default: () => null }));
vi.mock('../components/HeroChartWidget.jsx', () => ({ default: () => null }));
vi.mock('../api/catalog.js', () => ({
  searchDatasets: vi.fn(), fetchOrganizations: vi.fn(), fetchStats: vi.fn(),
  fetchFeatured: vi.fn(), fetchFeaturedPlaces: vi.fn(), fetchPlaces: vi.fn(), fetchSources: vi.fn()
}));
import { searchDatasets, fetchOrganizations, fetchStats, fetchFeatured, fetchFeaturedPlaces, fetchPlaces, fetchSources } from '../api/catalog.js';

const row = query => ({ id: query || 'all', name: query || 'all', title: { en: 'Results for ' + (query || 'all') },
  resource_count: 1, queryable_count: 0, places: [] });
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.pathname + location.search}</output>
    <button onClick={() => navigate('/?q=trees&format=XLSX&org=new&source=city&mappable=1&place=toronto-on')}>Other search</button>
    <button onClick={() => navigate('/')}>Clear URL</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>;
}
function start(path = '/') {
  return render(<LangProvider><MemoryRouter initialEntries={[path]}>
    <Navigation /><Routes><Route path="/" element={<HomePage />} /><Route path="/places" element={<PlacesPage />} /></Routes>
  </MemoryRouter></LangProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  searchDatasets.mockImplementation(async ({ q }) => ({ data: [row(q)], pagination: { nextCursor: null } }));
  fetchOrganizations.mockResolvedValue({ data: [
    { id: 'o1', name: 'old', title: { en: 'Old publisher', fr: 'Ancien diffuseur' }, dataset_count: 1 },
    { id: 'o2', name: 'new', title: { en: 'New publisher', fr: 'Nouveau diffuseur' }, dataset_count: 2 }
  ], pagination: { nextCursor: null } });
  fetchStats.mockResolvedValue(null);
  fetchFeatured.mockResolvedValue({ data: [] });
  fetchFeaturedPlaces.mockResolvedValue({ data: [
    { id: 'p1', slug: 'oshawa-on', kind: 'municipality', name: { en: 'Oshawa' }, dataset_count: 1 },
    { id: 'p2', slug: 'toronto-on', kind: 'municipality', name: { en: 'Toronto' }, dataset_count: 2 }
  ] });
  fetchSources.mockResolvedValue({ data: [
    { id: 'federal', name: { en: 'Federal' } }, { id: 'city', name: { en: 'City' } }
  ] });
  fetchPlaces.mockResolvedValue({ data: [], pagination: { nextCursor: null } });
});

test('same-route searches and Back/Forward update every filter and the displayed results', async () => {
  start('/?q=parks&format=CSV&org=old&source=federal&mappable=true&place=oshawa-on&keyword=roads');
  expect(await screen.findByText('Results for parks')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Other search' }));
  expect(await screen.findByText('Results for trees')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('trees');
  expect(screen.getByRole('combobox', { name: 'Choose a place' })).toHaveValue('toronto-on');
  expect(screen.getByRole('combobox', { name: 'Choose a source portal' })).toHaveValue('city');
  expect(screen.getByRole('combobox', { name: 'All organizations' })).toHaveValue('new');
  expect(screen.getByRole('button', { name: 'XLSX' })).toHaveClass('cq-pill-active');
  expect(screen.getByRole('button', { name: 'Has a map' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText('Results for parks')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('parks');
  expect(screen.getByRole('combobox', { name: 'Choose a place' })).toHaveValue('oshawa-on');
  expect(screen.getByRole('button', { name: 'CSV' })).toHaveClass('cq-pill-active');
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  expect(await screen.findByText('Results for trees')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear URL' }));
  expect(await screen.findByText('Results for all')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByRole('combobox', { name: 'Choose a place' })).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Has a map' })).toHaveAttribute('aria-pressed', 'false');
});

test('an unfinished search draft cannot overwrite a newly navigated search URL', async () => {
  start('/?q=parks');
  expect(await screen.findByText('Results for parks')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unfinished' } });
  fireEvent.click(screen.getByRole('button', { name: 'Other search' }));
  expect(await screen.findByText('Results for trees')).toBeInTheDocument();
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(screen.getByRole('searchbox')).toHaveValue('trees');
  expect(screen.getByTestId('location').textContent).toContain('q=trees');
  expect(searchDatasets).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'unfinished' }));
});

test('typing is debounced and a filter change keeps the current search draft', async () => {
  start('/?q=parks&utm_source=guide');
  expect(await screen.findByText('Results for parks')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'water' } });
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'parks' }));
  expect(await screen.findByText('Results for water')).toBeInTheDocument();
  expect(screen.getByTestId('location').textContent).toContain('utm_source=guide');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'roads' } });
  fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
  expect(await screen.findByText('Results for roads')).toBeInTheDocument();
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'roads', format: 'CSV' }));
});

test('a remembered place is shareable on arrival but does not override later All Canada navigation', async () => {
  localStorage.setItem('cq-place', 'oshawa-on');
  start();
  await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('place=oshawa-on'));
  fireEvent.click(screen.getByRole('button', { name: 'Clear URL' }));
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ place: undefined })));
  expect(screen.getByRole('combobox', { name: 'Choose a place' })).toHaveValue('');
});

test('the All Canada directory link clears a remembered geographical filter', async () => {
  localStorage.setItem('cq-place', 'oshawa-on');
  start('/places');
  fireEvent.click(await screen.findByRole('link', { name: /All Canada/ }));
  expect(await screen.findByText('Results for all')).toBeInTheDocument();
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ place: undefined }));
  expect(screen.getByRole('combobox', { name: 'Choose a place' })).toHaveValue('');
});

test('the publisher selector is labelled, translated and includes publishers after the first API page', async () => {
  localStorage.setItem('cq-lang', 'fr');
  fetchOrganizations.mockImplementation(async ({ cursor }) => ({ data: cursor ? [
    { id: 'last', name: 'last', title: { en: 'Last publisher', fr: 'Dernier diffuseur' }, dataset_count: 3 }
  ] : [{ id: 'first', name: 'first', title: { en: 'First publisher', fr: 'Premier diffuseur' }, dataset_count: 1 }],
  pagination: { nextCursor: cursor ? null : '100' } }));
  start('/?q=parks');
  expect(await screen.findByRole('option', { name: 'Dernier diffuseur (3)' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Toutes les organisations' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Premier diffuseur (1)' })).toBeInTheDocument();
  expect(fetchOrganizations).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, cursor: '100' }));
});
