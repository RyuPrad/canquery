import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchResource: vi.fn(),
  queryResource: vi.fn(),
  fetchResourcePreview: vi.fn(),
  fetchResourceRows: vi.fn(),
  prepareResource: vi.fn(),
  recordResourceActivity: vi.fn(() => Promise.resolve()),
  fetchJob: vi.fn(),
}));
import { fetchJob, fetchResource, fetchResourcePreview, fetchResourceRows, prepareResource, queryResource } from '../api/catalog.js';
import { markEngaged } from '../utils/engagement.js';

// Nobody has used the page in this file until its last test: engagement is
// page-wide and never resets, so the order matters.
const unprepared = (format = 'CSV') => ({ data: {
  id: 'a',
  name: { en: 'Resource a', fr: 'Ressource a' },
  dataset: { id: 'dataset-id-a', name: 'dataset-slug-a', title: { en: 'Dataset a', fr: 'Jeu de données a' } },
  query_mode: 'ingestable',
  format,
  url: 'https://example.test/a.' + format.toLowerCase(),
  preparation: { supported: true, enabled: true, freshness: 'unprepared' },
} });
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const renderPage = () => render(<MemoryRouter initialEntries={['/resources/a']}>
  <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  prepareResource.mockResolvedValue({ data: { id: 901, status: 'pending' } });
  fetchJob.mockImplementation(() => new Promise(() => {}));
  fetchResourceRows.mockImplementation(() => new Promise(() => {}));
  fetchResourcePreview.mockResolvedValue({
    data: { fields: [{ id: 'City', type: 'TEXT', original_label: 'City' }], records: [{ City: 'preview-ottawa' }],
      truncated: true, sampled_rows: 1, bytes_read: 262144, content_length: 9000000 },
    meta: { query_mode: 'preview' },
  });
});
afterEach(cleanup);

test('a workbook waits for a person before anything is prepared', async () => {
  fetchResource.mockResolvedValue(unprepared('XLSX'));
  renderPage();
  expect(await screen.findByText('The full table for this file is not loaded yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load the full table' })).toBeInTheDocument();
  await act(() => pause(50));
  expect(prepareResource).not.toHaveBeenCalled();
  expect(fetchResourcePreview).not.toHaveBeenCalled();
});

test('the Chart tab keeps the button while nobody has used the page, with no percentage', async () => {
  fetchResource.mockResolvedValue(unprepared());
  render(<MemoryRouter initialEntries={['/resources/a?view=chart']}>
    <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText('The full table for this file is not loaded yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load the full table' })).toBeInTheDocument();
  await act(() => pause(50));
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(prepareResource).not.toHaveBeenCalled();
});

test('a live table linked with a filter its portal cannot run shows the card, as before, while nobody is there', async () => {
  fetchResource.mockResolvedValue({ data: { ...unprepared().data, query_mode: 'datastore', format: 'CSV' } });
  queryResource.mockResolvedValue({ data: { fields: [{ id: 'name', type: 'text' }], records: [{ name: 'live-row' }], total: 1 },
    meta: { query_mode: 'datastore' } });
  const filters = encodeURIComponent(JSON.stringify({ name: 'Ottawa' }));
  render(<MemoryRouter initialEntries={['/resources/a?cf=' + filters]}>
    <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
  </MemoryRouter>);
  expect(await screen.findByText('Preparing precise filtering for this dataset...')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clear column filters' })).toBeInTheDocument();
  await act(() => pause(50));
  // Crawlers start nothing heavy.
  expect(fetchResourceRows).not.toHaveBeenCalled();
  expect(prepareResource).not.toHaveBeenCalled();
});

test('a CSV shows its first rows as the table at once; the whole file is read and prepared once a person is there', async () => {
  fetchResource.mockResolvedValue(unprepared());
  renderPage();
  expect(await screen.findByText('preview-ottawa')).toBeInTheDocument();
  // No banner and no card: the rows are the table, with its controls.
  expect(screen.queryByText('The full table for this file is not loaded yet.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load the full table' })).toBeNull();
  expect(screen.getByRole('textbox', { name: /City · / })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /City/ })).toBeInTheDocument();
  await act(() => pause(50));
  // Crawlers and agent browsers that only open the page start nothing heavy.
  expect(prepareResource).not.toHaveBeenCalled();
  expect(fetchResourceRows).not.toHaveBeenCalled();
  act(() => markEngaged());
  await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
  expect(prepareResource).toHaveBeenCalledWith('a');
  await waitFor(() => expect(fetchResourceRows).toHaveBeenCalledWith('a', expect.objectContaining({ snapshot: undefined })));
  expect(screen.getByText('preview-ottawa')).toBeInTheDocument();
  expect(screen.queryByText('Preparing this file automatically…')).toBeNull();
});

test('once a person is there, a workbook being prepared shows the table shape under a progress line', async () => {
  // The test above marked the page as used.
  fetchResource.mockResolvedValue(unprepared('XLSX'));
  renderPage();
  await waitFor(() => expect(prepareResource).toHaveBeenCalledWith('a'));
  const preparing = await screen.findByTestId('table-preparing');
  expect(within(preparing).getByRole('status')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load the full table' })).toBeNull();
  // There are no first rows to read from a workbook.
  expect(fetchResourcePreview).not.toHaveBeenCalled();
  expect(fetchResourceRows).not.toHaveBeenCalled();
});
