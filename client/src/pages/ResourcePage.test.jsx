import { describe, beforeEach, vi, expect, test } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchResource: vi.fn(),
  queryResource: vi.fn(),
  prepareResource: vi.fn(),
  fetchJob: vi.fn(),
}));
vi.mock('../components/MapPanel.jsx', () => ({
  default: ({ resourceId }) => <div>live-map-{resourceId}</div>,
}));
import { prepareResource, fetchJob, fetchResource, queryResource } from '../api/catalog.js';

function resourceEnvelope(id) {
  return {
    data: {
      id,
      name: { en: `Resource ${id}`, fr: `Ressource ${id}` },
      dataset: {
        id: `dataset-id-${id}`,
        name: `dataset-slug-${id}`,
        title: { en: `Dataset ${id}`, fr: `Jeu de données ${id}` }
      },
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
  test.each([
    ['en', 'Breadcrumb', 'Datasets', 'Dataset a', 'Resource a'],
    ['fr', 'Fil d’Ariane', 'Jeux de données', 'Jeu de données a', 'Ressource a'],
  ])('shows the localized %s resource hierarchy with its canonical dataset slug', async (
    lang, ariaLabel, rootLabel, datasetLabel, resourceLabel
  ) => {
    localStorage.setItem('cq-lang', lang);
    render(
      <LangProvider>
        <MemoryRouter initialEntries={['/resources/a']}>
          <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
        </MemoryRouter>
      </LangProvider>
    );

    const breadcrumb = await screen.findByRole('navigation', { name: ariaLabel });
    expect(within(breadcrumb).getByRole('link', { name: rootLabel })).toHaveAttribute('href', '/datasets');
    expect(within(breadcrumb).getByRole('link', { name: datasetLabel }))
      .toHaveAttribute('href', '/datasets/dataset-slug-a');
    expect(within(breadcrumb).getByText(resourceLabel)).toHaveAttribute('aria-current', 'page');
  });

  test('opens a live map without querying or loading the table first', async () => {
    fetchResource.mockResolvedValue({
      ...resourceEnvelope('a'),
      data: { ...resourceEnvelope('a').data, query_mode: 'ingestable', map: { available: true, extent: [-79, 43, -78, 44] } },
    });

    render(
      <MemoryRouter initialEntries={['/resources/a?view=map']}>
        <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('live-map-a')).toBeInTheDocument();
    expect(queryResource).not.toHaveBeenCalled();
    expect(prepareResource).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Full-text search in this table...')).not.toBeInTheDocument();
  });

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
    }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
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
    }, expect.objectContaining({ signal: expect.any(AbortSignal) })));

    fireEvent.click(screen.getByRole('button', { name: 'Open resource B' }));

    await screen.findByRole('heading', { name: 'Resource b' });
    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('b', {
      q: undefined,
      filters: undefined,
      sort: undefined,
      limit: 50,
      offset: 0,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(screen.getByPlaceholderText('Full-text search in this table...')).toHaveValue('');
    expect(screen.getByText('row-b')).toBeInTheDocument();
  });

  test('an already-loaded enqueue response refreshes without persisting or polling a null job', async () => {
    fetchResource.mockResolvedValueOnce({ data: { ...resourceEnvelope('a').data, query_mode: 'ingestable', preparation: { supported: true, enabled: true, freshness: 'unprepared' } } });
    prepareResource.mockResolvedValue({
      data: { id: null, resource_id: 'a', status: 'done', already_loaded: true, row_count: 200 },
    });

    render(
      <MemoryRouter initialEntries={['/resources/a']}>
        <Routes>
          <Route path="/resources/:id" element={<ResourcePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(prepareResource).toHaveBeenCalledWith('a'));
    expect(screen.queryByRole('button', { name: 'Load this resource' })).toBeNull();

    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    expect(fetchResource).toHaveBeenCalledTimes(2);
    expect(fetchJob).not.toHaveBeenCalled();
    expect(localStorage.getItem('cq-unlock-job-a')).toBeNull();
  });

  test('a refreshed schema clears removed filters and sorting while keeping the old copy usable', async () => {
    const before = { ...resourceEnvelope('a').data,
      preparation: { supported: true, freshness: 'stale' },
      ingestion: { ingested_at: '2026-09-01', fields: [{ id: 'name', type: 'TEXT' }] } };
    const after = { ...before, preparation: { supported: true, freshness: 'current' },
      ingestion: { ingested_at: '2026-09-02', fields: [{ id: 'province', type: 'TEXT' }] } };
    fetchResource.mockResolvedValueOnce({ data: before }).mockResolvedValue({ data: after });
    prepareResource.mockResolvedValue({ data: { id: 777, status: 'pending' } });
    let finish;
    fetchJob.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const filters = encodeURIComponent(JSON.stringify({ name: 'old-name' }));
    render(<MemoryRouter initialEntries={[`/resources/a?cf=${filters}&sort=name%20desc&page=1`]}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    await waitFor(() => expect(fetchJob).toHaveBeenCalled());
    await act(async () => finish({ data: { id: 777, status: 'done' } }));
    expect(await screen.findByText('The updated file has different columns. Affected filters or sorting were cleared.')).toBeInTheDocument();
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({
      filters: undefined, sort: undefined, offset: 0, limit: 50
    }), expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(prepareResource).toHaveBeenCalledTimes(1);
  });
});
