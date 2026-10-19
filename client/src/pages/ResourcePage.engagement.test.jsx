import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchResource: vi.fn(),
  queryResource: vi.fn(),
  fetchResourcePreview: vi.fn(),
  prepareResource: vi.fn(),
  recordResourceActivity: vi.fn(() => Promise.resolve()),
  fetchJob: vi.fn(),
}));
import { fetchJob, fetchResource, fetchResourcePreview, prepareResource } from '../api/catalog.js';

// Nobody has used the page in this file until its last test presses the
// button: engagement is page-wide and never resets, so the order matters.
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

test('a CSV shows its first rows at once and is prepared when the visitor asks', async () => {
  fetchResource.mockResolvedValue(unprepared());
  renderPage();
  expect(await screen.findByText('preview-ottawa')).toBeInTheDocument();
  expect(screen.getByText('The full table for this file is not loaded yet.')).toBeInTheDocument();
  await act(() => pause(50));
  expect(prepareResource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load the full table' }));
  await waitFor(() => expect(prepareResource).toHaveBeenCalledTimes(1));
  expect(prepareResource).toHaveBeenCalledWith('a');
  expect(await screen.findByText('Preparing this file automatically…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load the full table' })).toBeNull();
  expect(screen.getByText('preview-ottawa')).toBeInTheDocument();
});
