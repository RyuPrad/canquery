import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import DatasetsPage from './DatasetsPage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({ searchDatasets: vi.fn(), fetchFeaturedPlaces: vi.fn() }));
import { fetchFeaturedPlaces, searchDatasets } from '../api/catalog.js';

const row = (n) => ({ id: 'd' + n, name: 'dataset-' + n, title: { en: 'Dataset ' + n, fr: 'Données ' + n },
  resource_count: 1, queryable_count: 0, mappable_count: 0, places: [] });
const counts = (extra = {}) => ({
  total: 64218,
  facets: {
    level: [{ value: 'federal', count: 36090 }, { value: 'provincial', count: 11745 }, { value: 'municipal', count: 16000 }],
    access: [{ value: 'queryable', count: 2400 }, { value: 'mappable', count: 1900 }],
    organization: [{ value: 'statcan', label: { en: 'Statistics Canada', fr: 'Statistique Canada' }, count: 7000 }],
    source: [{ value: 'open-canada', label: { en: 'Government of Canada Open Data', fr: null }, count: 48122 }],
    format: [{ value: 'CSV', count: 15831 }, { value: 'PDF', count: 8374 }],
    keyword: [{ value: 'roads', count: 300 }],
    ...extra
  }
});
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.pathname + location.search}</output>
    <button onClick={() => navigate('/datasets?format=PDF&level=municipal')}>Other filters</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>;
}
function start(path = '/datasets', language = 'en') {
  localStorage.setItem('cq-lang', language);
  return render(<LangProvider><MemoryRouter initialEntries={[path]}><Location /><DatasetsPage /></MemoryRouter></LangProvider>);
}
const group = (name) => screen.getByRole('group', { name });
const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  searchDatasets.mockImplementation(async ({ cursor }) => ({
    data: [row(Number(cursor) + 1)],
    pagination: { nextCursor: Number(cursor) === 0 ? '50' : null },
    meta: counts()
  }));
  fetchFeaturedPlaces.mockResolvedValue({ data: [
    { id: 'p1', slug: 'toronto-on', kind: 'municipality', name: { en: 'Toronto' }, dataset_count: 555 }
  ] });
});

test('the unfiltered catalogue shows counts beside durable page links', async () => {
  start();
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  expect(searchDatasets).toHaveBeenLastCalledWith({ cursor: '0', limit: 50, lang: 'en', facets: true });
  expect(screen.getByText('64,218 datasets', { selector: '[role=status]' })).toBeInTheDocument();
  expect(within(group('Government level')).getByRole('checkbox', { name: 'Federal' })).toHaveAccessibleDescription('36,090 datasets');
  expect(within(group('Publisher')).getByRole('checkbox', { name: 'Statistics Canada' })).not.toBeChecked();
  expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/datasets?page=2');
  expect(screen.getByRole('button', { name: 'Reset search' })).toBeDisabled();
});

test('filters write repeated URL keys, switch to button pagination and never become links', async () => {
  start('/datasets?page=2&utm_source=guide');
  expect(await screen.findByText('Dataset 51')).toBeInTheDocument();
  fireEvent.click(within(group('Format')).getByRole('checkbox', { name: 'CSV' }));
  await waitFor(() => expect(location()).toBe('/datasets?utm_source=guide&format=CSV'));
  fireEvent.click(within(group('Format')).getByRole('checkbox', { name: 'PDF' }));
  fireEvent.click(within(group('Data access')).getByRole('checkbox', { name: 'Has a queryable table' }));
  await waitFor(() => expect(location()).toBe('/datasets?utm_source=guide&format=CSV&format=PDF&queryable=true'));
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(
    { format: ['CSV', 'PDF'], queryable: true, lang: 'en', facets: true, limit: 50, cursor: '0' }));
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '50', format: ['CSV', 'PDF'] })));
  expect(location()).not.toContain('page=');
  for (const link of screen.getAllByRole('link')) {
    expect(link.getAttribute('href')).not.toMatch(/[?&](format|level|org|source|keyword|queryable|mappable|sort)=/);
  }
  expect(screen.getByRole('button', { name: 'Remove filter: Has a queryable table' })).toBeInTheDocument();
});

test('typing is debounced into the URL and Best match appears only for a search', async () => {
  start();
  await screen.findByText('Dataset 1');
  const order = screen.getByRole('combobox', { name: 'Order by' });
  expect(within(order).getAllByRole('option').map((option) => option.textContent)).toEqual(['Recently updated', 'Title A–Z', 'Title Z–A']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'water' } });
  expect(location()).toBe('/datasets');
  await waitFor(() => expect(location()).toBe('/datasets?q=water'));
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'water' })));
  expect(within(screen.getByRole('combobox', { name: 'Order by' })).getAllByRole('option').map((option) => option.textContent))
    .toEqual(['Best match', 'Recently updated', 'Title A–Z', 'Title Z–A']);
  fireEvent.change(screen.getByRole('combobox', { name: 'Order by' }), { target: { value: 'title' } });
  await waitFor(() => expect(location()).toBe('/datasets?q=water&sort=title'));
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'water', sort: 'title', lang: 'en' })));
});

test('Reset clears the search, every filter and the order', async () => {
  start('/datasets?q=roads&org=statcan&level=federal&mappable=true&sort=title_desc');
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('roads');
  expect(within(group('Publisher')).getByRole('checkbox', { name: 'Statistics Canada' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Remove filter: Statistics Canada' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
  await waitFor(() => expect(location()).toBe('/datasets'));
  expect(screen.getByRole('searchbox')).toHaveValue('');
  await waitFor(() => expect(searchDatasets).toHaveBeenLastCalledWith({ cursor: '0', limit: 50, lang: 'en', facets: true }));
});

test('unavailable counts keep the results and can be retried', async () => {
  searchDatasets.mockImplementation(async () => ({ data: [row(1)], pagination: { nextCursor: null }, meta: { total: null, facets: null } }));
  start('/datasets?format=CSV');
  expect(await screen.findByText('Counts are temporarily unavailable.')).toBeInTheDocument();
  expect(screen.getByText('Dataset 1')).toBeInTheDocument();
  expect(screen.getByText('Results', { selector: '[role=status]' })).toBeInTheDocument();
  expect(within(group('Format')).getByRole('checkbox', { name: 'CSV' })).toBeChecked();
  const calls = searchDatasets.mock.calls.length;
  searchDatasets.mockImplementation(async () => ({ data: [row(1)], pagination: { nextCursor: null }, meta: counts() }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('64,218 datasets', { selector: '[role=status]' })).toBeInTheDocument();
  expect(searchDatasets.mock.calls.length).toBe(calls + 1);
});

test('Back and Forward restore each filtered search', async () => {
  start('/datasets?format=CSV');
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Other filters' }));
  await waitFor(() => expect(within(group('Format')).getByRole('checkbox', { name: 'PDF' })).toBeChecked());
  expect(within(group('Government level')).getByRole('checkbox', { name: 'Municipal and regional' })).toBeChecked();
  expect(within(group('Format')).getByRole('checkbox', { name: 'CSV' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(within(group('Format')).getByRole('checkbox', { name: 'CSV' })).toBeChecked());
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ format: ['CSV'] }));
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  await waitFor(() => expect(within(group('Format')).getByRole('checkbox', { name: 'PDF' })).toBeChecked());
});

test('opening the place group loads places, and a place clears publisher and source', async () => {
  start('/datasets?org=statcan&source=open-canada&lang=fr');
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  expect(fetchFeaturedPlaces).not.toHaveBeenCalled();
  const summary = screen.getByText('Place', { selector: '.cq-filter-group-title' }).closest('details');
  summary.open = true;
  fireEvent(summary, new Event('toggle'));
  await waitFor(() => expect(fetchFeaturedPlaces).toHaveBeenCalledTimes(1));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Choose a place' }), { target: { value: 'toronto-on' } });
  await waitFor(() => expect(location()).toBe('/datasets?lang=fr&place=toronto-on'));
  expect(screen.getByRole('button', { name: 'Remove filter: Toronto' })).toBeInTheDocument();
});

test('the French catalogue localizes counts and orders', async () => {
  start('/datasets?q=parcs', 'fr');
  expect(await screen.findByText(/^64\s218 jeux de données$/, { selector: '[role=status]' })).toBeInTheDocument();
  expect(within(screen.getByRole('combobox', { name: 'Trier par' })).getAllByRole('option').map((option) => option.textContent))
    .toEqual(['Pertinence', 'Mis à jour récemment', 'Titre A–Z', 'Titre Z–A']);
  expect(searchDatasets).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'parcs', lang: 'fr', facets: true }));
});
