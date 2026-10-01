import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const contextualPreview = () => ({
  dataset_id: 'chart-dataset', title: { en: 'Grants by status' }, kind: 'donut',
  points: [{ key: 'Approved', label: 'Approved', value: 3 }, { key: 'Pending', label: 'Pending', value: 1 }],
  context: { resource_id: 'chart-resource', group_by: 'status', agg: 'count', agg_column: null,
    bucket: null, group_type: 'TEXT', snapshot_at: '2026-09-29T23:30:00.000Z', snapshot_rows: 4,
    total_groups: 2, displayed_groups: 2, limited: false, missing_periods: [] },
});

test.each([
  { lang: 'en', title: 'Search Canadian open data',
    subtitle: 'Search Canadian government datasets by place and topic. Find CSV downloads, explore supported tables and maps, and use CanQuery’s free API.',
    search: 'Find Canadian government datasets by place, topic, publisher and format.',
    explore: 'Download original files, prepare eligible CSV and Excel files as tables, or explore supported maps.',
    query: 'Filter and sort supported tables, export up to 10,000 rows as CSV, or query data with CanQuery’s free API.' },
  { lang: 'fr', title: 'Recherchez des données ouvertes canadiennes',
    subtitle: 'Recherchez des jeux de données des gouvernements canadiens par lieu et sujet. Trouvez des fichiers CSV, explorez les tableaux et cartes pris en charge et utilisez l’API gratuite de CanQuery.',
    search: 'Trouvez des jeux de données des gouvernements canadiens par lieu, sujet, organisme et format.',
    explore: 'Téléchargez les fichiers d’origine, préparez les fichiers CSV et Excel admissibles sous forme de tableaux ou explorez les cartes prises en charge.',
    query: 'Filtrez et triez les tableaux pris en charge, exportez jusqu’à 10 000 lignes en CSV ou interrogez les données avec l’API gratuite de CanQuery.' },
])('the $lang homepage explains government data discovery and qualified access capabilities', async copy => {
  localStorage.setItem('cq-lang', copy.lang);
  start();
  expect(await screen.findByRole('heading', { level: 1, name: copy.title })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByText(copy.subtitle)).toBeInTheDocument();
  expect(screen.getByText(copy.search)).toBeInTheDocument();
  expect(screen.getByText(copy.explore)).toBeInTheDocument();
  expect(screen.getByText(copy.query)).toBeInTheDocument();
});

test('the chart section is omitted when every preview is metadata-poor, malformed or flat', async () => {
  const flat = contextualPreview();
  flat.points = flat.points.map(point => ({ ...point, value: 2 }));
  const legacy = contextualPreview();
  delete legacy.context;
  fetchFeatured.mockResolvedValue({ data: [legacy, flat, { ...contextualPreview(), kind: 'unknown' }] });
  start();
  expect(await screen.findByText('Results for all')).toBeInTheDocument();
  await waitFor(() => expect(fetchFeatured).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: 'A closer look at the data' })).not.toBeInTheDocument();
});

test('one explainable preview is enough to display the chart section', async () => {
  fetchFeatured.mockResolvedValue({ data: [contextualPreview()] });
  start();
  expect(await screen.findByRole('heading', { name: 'A closer look at the data' })).toBeInTheDocument();
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

test('an unfiltered visit offers six previews and a link to the full catalogue', async () => {
  searchDatasets.mockImplementation(async ({ limit }) => ({
    data: Array.from({ length: limit }, (_, i) => row('preview-' + i)),
    pagination: { nextCursor: String(limit) },
  }));
  start();
  expect(await screen.findAllByRole('link', { name: /^Results for preview-/ })).toHaveLength(6);
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6 }));
  expect(screen.getByRole('link', { name: /Browse all datasets/ })).toHaveAttribute('href', '/datasets');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

test.each(['q=parks', 'org=old', 'format=CSV', 'keyword=roads', 'place=oshawa-on', 'source=federal', 'mappable=true'])(
  'an active %s criterion retains full search pagination', async params => {
    searchDatasets.mockResolvedValue({ data: [row('filtered')], pagination: { nextCursor: '20' } });
    start('/?' + params);
    expect(await screen.findByText('Results for filtered')).toBeInTheDocument();
    expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20 }));
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Browse all datasets/ })).toBeNull();
  }
);

test('Load more and Back/Forward switch cleanly between previews and search results', async () => {
  searchDatasets.mockImplementation(async ({ q, limit, cursor }) => ({
    data: Array.from({ length: limit }, (_, i) => row((q || 'preview') + '-' + (Number(cursor) + i))),
    pagination: { nextCursor: String(Number(cursor) + limit) },
  }));
  start();
  expect(await screen.findAllByRole('link', { name: /^Results for preview-/ })).toHaveLength(6);
  fireEvent.click(screen.getByRole('button', { name: 'Other search' }));
  expect(await screen.findAllByRole('link', { name: /^Results for trees-/ })).toHaveLength(20);
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(screen.getAllByRole('link', { name: /^Results for trees-/ })).toHaveLength(40));
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'trees', limit: 20, cursor: '20' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findAllByRole('link', { name: /^Results for preview-/ })).toHaveLength(6);
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  expect(await screen.findAllByRole('link', { name: /^Results for trees-/ })).toHaveLength(20);
});

test('clearing the last filter restores preview mode', async () => {
  start('/?format=CSV');
  expect(await screen.findByText('Results for all')).toBeInTheDocument();
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20 }));
  fireEvent.click(screen.getByRole('button', { name: 'All formats' }));
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ format: undefined, limit: 6 })));
  expect(await screen.findByRole('link', { name: /Browse all datasets/ })).toBeInTheDocument();
});

test('an obsolete preview request cannot replace a newly navigated search', async () => {
  let resolvePreview;
  searchDatasets.mockImplementation(({ q }) => q
    ? Promise.resolve({ data: [row(q)], pagination: { nextCursor: '20' } })
    : new Promise(resolve => { resolvePreview = resolve; }));
  start();
  fireEvent.click(screen.getByRole('button', { name: 'Other search' }));
  expect(await screen.findByText('Results for trees')).toBeInTheDocument();
  await act(async () => resolvePreview({ data: [row('obsolete')], pagination: { nextCursor: null } }));
  expect(screen.queryByText('Results for obsolete')).toBeNull();
  expect(screen.getByText('Results for trees')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
});
