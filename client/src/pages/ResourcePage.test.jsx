import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { NotIngestedError } from '../api/client.js';

vi.mock('../api/catalog.js', () => ({
  fetchResource: vi.fn(),
  queryResource: vi.fn(),
  enqueueIngest: vi.fn(),
  fetchJob: vi.fn(),
}));
import { enqueueIngest, fetchJob, fetchResource, queryResource } from '../api/catalog.js';

function resourceEnvelope(id) {
  return {
    data: {
      id,
      name: { en: `Resource ${id}`, fr: null },
      dataset: { id: `dataset-${id}`, name: `dataset-${id}`, title: { en: `Dataset ${id}`, fr: null } },
      query_mode: 'ingested',
      format: 'CSV',
      url: `https://example.test/${id}.csv`,
    },
  };
}

function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/resources/b')}>Open resource B</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchResource.mockImplementation((id) => Promise.resolve(resourceEnvelope(id)));
  queryResource.mockImplementation((id) => Promise.resolve({
    data: {
      fields: [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }],
      records: [{ _id: 1, name: `row-${id}` }],
      total: 200,
    },
    meta: { query_mode: 'ingested' },
  }));
});

describe('ResourcePage navigation', () => {
  test('deep page links are clamped to the server offset ceiling', async () => {
    render(
      <MemoryRouter initialEntries={['/resources/a?page=999']}>
        <Routes>
          <Route path="/resources/:id" element={<ResourcePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('a', {
      q: undefined,
      filters: undefined,
      sort: undefined,
      limit: 50,
      offset: 10000,
    }));
  });

  test('route id changes reset explorer state before querying the next resource', async () => {
    const oldFilters = encodeURIComponent(JSON.stringify({ name: 'old-filter' }));
    render(
      <MemoryRouter initialEntries={[`/resources/a?q=old-search&cf=${oldFilters}&sort=name%20desc&page=3`]}>
        <Navigation />
        <Routes>
          <Route path="/resources/:id" element={<ResourcePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('a', {
      q: 'old-search',
      filters: { name: { op: 'contains', value: 'old-filter' } },
      sort: 'name desc',
      limit: 50,
      offset: 150,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Open resource B' }));

    await screen.findByRole('heading', { name: 'Resource b' });
    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('b', {
      q: undefined,
      filters: undefined,
      sort: undefined,
      limit: 50,
      offset: 0,
    }));
    expect(screen.getByPlaceholderText('Full-text search in this table...')).toHaveValue('');
    expect(screen.getByText('row-b')).toBeInTheDocument();
  });

  test('an already-loaded enqueue response refreshes without persisting or polling a null job', async () => {
    queryResource.mockRejectedValueOnce(new NotIngestedError('Not loaded', 409, { hint: 'Load it' }));
    enqueueIngest.mockResolvedValue({
      data: { id: null, resource_id: 'a', status: 'done', already_loaded: true, row_count: 200 },
    });

    render(
      <MemoryRouter initialEntries={['/resources/a']}>
        <Routes>
          <Route path="/resources/:id" element={<ResourcePage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load this resource' }));

    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    expect(fetchResource).toHaveBeenCalledTimes(2);
    expect(fetchJob).not.toHaveBeenCalled();
    expect(localStorage.getItem('cq-unlock-job-a')).toBeNull();
  });
});
