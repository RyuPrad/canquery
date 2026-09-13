import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import DatasetsPage from './DatasetsPage.jsx';
import OrganizationsPage from './OrganizationsPage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({ searchDatasets: vi.fn(), fetchOrganizations: vi.fn() }));
import { searchDatasets, fetchOrganizations } from '../api/catalog.js';

const row = n => ({ id: 'd' + n, name: 'dataset-' + n, title: { en: 'Dataset ' + n, fr: 'Données ' + n },
  resource_count: 1, queryable_count: 0, mappable_count: 0, places: [] });
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>Back</button></>;
}
function start(element, path = '/datasets', language = 'en') {
  localStorage.setItem('cq-lang', language);
  return render(<LangProvider><MemoryRouter initialEntries={[path]}><Location />{element}</MemoryRouter></LangProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  searchDatasets.mockImplementation(async ({ cursor }) => {
    const offset = Number(cursor);
    return { data: offset < 100 ? [row(offset + 1)] : [], pagination: { nextCursor: offset === 0 ? '50' : null } };
  });
});

test('page links, direct URLs and Back select the same catalogue slice', async () => {
  start(<DatasetsPage />);
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  const next = screen.getByRole('link', { name: 'Next' });
  expect(next).toHaveAttribute('href', '/datasets?page=2');
  fireEvent.click(next);
  expect(await screen.findByText('Dataset 51')).toBeInTheDocument();
  expect(screen.queryByText('Dataset 1')).not.toBeInTheDocument();
  expect(searchDatasets).toHaveBeenLastCalledWith({ cursor: '50', limit: 50 });
  expect(screen.getByTestId('location')).toHaveTextContent('/datasets?page=2');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  expect(screen.queryByText('Dataset 51')).not.toBeInTheDocument();
});

test('opens page two directly with localized pagination', async () => {
  start(<DatasetsPage />, '/datasets?page=2', 'fr');
  expect(await screen.findByText('Données 51')).toBeInTheDocument();
  const pager = screen.getByRole('navigation', { name: 'Pages du catalogue' });
  expect(within(pager).getByRole('link', { name: 'Précédente' })).toHaveAttribute('href', '/datasets');
  expect(within(pager).getByText('Page 2')).toHaveAttribute('aria-current', 'page');
});

test.each(['0', '01', '-1', '2&page=3'])('rejects invalid page %s without an API request', async page => {
  start(<DatasetsPage />, '/datasets?page=' + page);
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(searchDatasets).not.toHaveBeenCalled();
});

test('an out-of-range page displays a missing-page state, not an empty successful listing', async () => {
  start(<DatasetsPage />, '/datasets?page=3');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Catalogue pages' })).not.toBeInTheDocument();
});

test('a late previous-page response cannot overwrite the selected page', async () => {
  let finishOld;
  searchDatasets.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  start(<DatasetsPage />, '/datasets?page=2');
  await waitFor(() => expect(searchDatasets).toHaveBeenCalledWith({ cursor: '50', limit: 50 }));
  fireEvent.click(screen.getByRole('link', { name: 'Previous' }));
  expect(await screen.findByText('Dataset 1')).toBeInTheDocument();
  await act(async () => finishOld({ data: [row(51)], pagination: { nextCursor: null } }));
  expect(screen.queryByText('Dataset 51')).not.toBeInTheDocument();
});

test('publisher filtering searches beyond the current page and uses buttons for filtered pagination', async () => {
  fetchOrganizations.mockImplementation(async ({ q, cursor }) => ({
    data: [{ id: 'o', name: 'publisher', title: { en: q ? 'Remote publisher ' + cursor : 'Local publisher' }, dataset_count: 1 }],
    pagination: { nextCursor: q && cursor === '0' ? '50' : null }
  }));
  start(<OrganizationsPage />, '/organizations?page=2');
  expect(await screen.findByText('Local publisher')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'remote' } });
  expect(await screen.findByText('Remote publisher 0')).toBeInTheDocument();
  expect(fetchOrganizations).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'remote', cursor: '0', limit: 50 }));
  expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(fetchOrganizations).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'remote', cursor: '50' })));
  expect(await screen.findByText('Remote publisher 50')).toBeInTheDocument();
});
