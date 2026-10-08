import { describe, beforeEach, vi, expect, test } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchResource: vi.fn(),
  queryResource: vi.fn(),
  prepareResource: vi.fn(),
  recordResourceActivity: vi.fn(() => Promise.resolve()),
  fetchJob: vi.fn(),
}));
vi.mock('../components/MapPanel.jsx', () => ({
  default: ({ resourceId }) => <div>live-map-{resourceId}</div>,
}));
vi.mock('../components/ChartPanel.jsx', () => ({
  default: ({ resourceId, fields, queryMode }) => <div data-testid="chart" data-fields={JSON.stringify(fields)} data-mode={queryMode}>chart-{resourceId}</div>,
}));
import { prepareResource, fetchJob, fetchResource, queryResource, recordResourceActivity } from '../api/catalog.js';

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

function ResourceHistoryNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <button onClick={() => navigate('/resources/a?q=second&sort=name%20desc&page=2')}>Open another resource view</button>
    <button onClick={() => navigate(-1)}>History back</button>
    <output aria-label="Current resource URL">{location.search}</output>
  </>;
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
  test('a ready chart uses metadata without a row query and Table loads the selected page', async () => {
    fetchResource.mockResolvedValue({ data: { ...resourceEnvelope('a').data,
      ingestion: { ingested_at: '2026-09-01', fields: [{ id: 'name', type: 'TEXT' }] } } });
    render(<MemoryRouter initialEntries={['/resources/a?view=chart&page=2&sort=name']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByTestId('chart')).toHaveAttribute('data-fields', '[{"id":"name","type":"TEXT"}]');
    expect(queryResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 100, sort: 'name' }), expect.any(Object));
  });

  test('a failed Table query does not prevent a ready Chart from rendering', async () => {
    queryResource.mockRejectedValue(new Error('Row query unavailable'));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('Row query unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(await screen.findByTestId('chart')).toHaveAttribute('data-mode', 'ingested');
    expect(screen.queryByText('Row query unavailable')).toBeNull();
  });

  test('a legacy field link is reconciled before its first query', async () => {
    fetchResource.mockResolvedValue({ data: { ...resourceEnvelope('a').data,
      ingestion: { fields: [{ id: 'code', type: 'TEXT', legacy_ids: ['old_code'] }] } } });
    render(<MemoryRouter initialEntries={['/resources/a?cf=' + encodeURIComponent(JSON.stringify({ old_code: '=0012' })) + '&sort=old_code%20desc']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a');
    expect(queryResource).toHaveBeenCalled();
    for (const [, options] of queryResource.mock.calls) {
      expect(options.sort).toBe('code desc');
      expect(options.filters).toEqual({ code: { op: 'eq', value: '0012' } });
    }
  });
  test('uses the contextual publisher download title for the heading and breadcrumb', async () => {
    const resource = resourceEnvelope('a');
    resource.data.name.en = 'Download EDI through HTTP';
    resource.data.presentation = { title: { en: 'Southern Cordillera site ten911 (EDI)' } };
    fetchResource.mockResolvedValue(resource);
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    const label = resource.data.presentation.title.en;
    expect(await screen.findByRole('heading', { name: label, level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText(label))
      .toHaveAttribute('aria-current', 'page');
  });
  test('initial metadata loading reserves the explorer without showing controls or starting work', async () => {
    let resolveMetadata;
    fetchResource.mockImplementation(() => new Promise(resolve => { resolveMetadata = resolve; }));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Loading the data...' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByPlaceholderText('Full-text search in this table...')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chart' })).toBeNull();
    expect(queryResource).not.toHaveBeenCalled();
    expect(prepareResource).not.toHaveBeenCalled();
    expect(recordResourceActivity).not.toHaveBeenCalled();
    await act(async () => resolveMetadata(resourceEnvelope('a')));
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Full-text search in this table...')).toBeInTheDocument();
  });

  test.each(['en', 'fr'].flatMap(lang => ['table', 'chart'].map(view => ({ lang, view }))))(
    'a $lang download-only $view visit uses metadata without querying or preparing', async ({ lang, view }) => {
      localStorage.setItem('cq-lang', lang);
      fetchResource.mockResolvedValue({ data: { ...resourceEnvelope('a').data,
        query_mode: 'file-only', format: 'PDF', preparation: { supported: false } } });
      render(<LangProvider><MemoryRouter initialEntries={['/resources/a?view=' + view]}>
        <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
      </MemoryRouter></LangProvider>);
      const link = await screen.findByRole('link', { name: lang === 'fr' ? 'Téléchargez-le ici' : 'Download it here' });
      expect(link).toHaveAttribute('href', 'https://example.test/a.csv');
      expect(queryResource).not.toHaveBeenCalled();
      expect(prepareResource).not.toHaveBeenCalled();
      expect(recordResourceActivity).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('status', { name: /Loading|Chargement/ })).toBeNull();
    }
  );

  test('a download-only resource can still switch between its map and original file', async () => {
    fetchResource.mockResolvedValue({ data: { ...resourceEnvelope('a').data,
      query_mode: 'file-only', preparation: { supported: false },
      map: { available: true, extent: [-79, 43, -78, 44] } } });
    render(<MemoryRouter initialEntries={['/resources/a?view=map']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('live-map-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(await screen.findByRole('link', { name: 'Download it here' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(await screen.findByText('live-map-a')).toBeInTheDocument();
    expect(queryResource).not.toHaveBeenCalled();
    expect(prepareResource).not.toHaveBeenCalled();
  });

  test('unsupported live-filter deep links explain the limitation and can return to live rows', async () => {
    fetchResource.mockResolvedValue({ data: { ...resourceEnvelope('a').data, query_mode: 'datastore', preparation: { supported: false, enabled: true } } });
    queryResource.mockResolvedValue({ data: { fields: [{ id: 'name', type: 'TEXT' }], records: [{ name: 'live-row' }], total: 1 }, meta: { query_mode: 'datastore' } });
    const filters = encodeURIComponent(JSON.stringify({ name: 'Ottawa' }));
    render(<MemoryRouter initialEntries={['/resources/a?cf=' + filters]}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByRole('heading', { name: 'Resource a' });
    expect(await screen.findByText('Precise per-column filtering is not available for this dataset. Use the full-text search box above.')).toBeInTheDocument();
    expect(screen.queryByText('Querying')).toBeNull();
    expect(queryResource).not.toHaveBeenCalled();
    expect(prepareResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear column filters' }));
    expect(await screen.findByText('live-row')).toBeInTheDocument();
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ filters: undefined }), expect.any(Object));
  });

  test('live rows never offer a CSV export with incompatible pending filters', async () => {
    fetchResource.mockResolvedValue({ data: { ...resourceEnvelope('a').data, query_mode: 'datastore', preparation: { supported: false, enabled: true } } });
    queryResource.mockResolvedValue({ data: { fields: [{ id: 'name', type: 'TEXT' }], records: [{ name: 'live-row' }], total: 1 }, meta: { query_mode: 'datastore' } });
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('live-row');
    expect(screen.getByRole('link', { name: 'Download CSV (filtered)' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /name.*filter/ }), { target: { value: '>2' } });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Download CSV (filtered)' })).toBeNull());
    expect(screen.getByText('live-row')).toBeInTheDocument();
    expect(screen.getByText('Showing the previous live results. The current search and column filters are not applied.')).toBeInTheDocument();
  });
  test('a failed metadata read can be retried without reloading the browser', async () => {
    fetchResource.mockRejectedValueOnce(new Error('Metadata temporarily unavailable'));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Metadata temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('row-a')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test.each(['status desc', '_id desc'])('refresh preserves the valid sort %s', async sort => {
    const before = { ...resourceEnvelope('a').data,
      preparation: { supported: true, freshness: 'stale' },
      ingestion: { ingested_at: '2026-09-01', fields: [{ id: 'status desc', type: 'TEXT' }] } };
    const after = { ...before, preparation: { supported: true, freshness: 'current' },
      ingestion: { ...before.ingestion, ingested_at: '2026-09-02' } };
    fetchResource.mockResolvedValueOnce({ data: before }).mockResolvedValue({ data: after });
    prepareResource.mockResolvedValue({ data: { id: 778, status: 'pending' } });
    let finish;
    fetchJob.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter initialEntries={['/resources/a?sort=' + encodeURIComponent(sort)]}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a');
    await waitFor(() => expect(fetchJob).toHaveBeenCalled());
    await act(async () => finish({ data: { id: 778, status: 'done' } }));
    await waitFor(() => expect(fetchResource).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ sort }), expect.any(Object)));
    expect(screen.queryByText('The updated file has different columns. Affected filters or sorting were cleared.')).toBeNull();
  });
  test('same-resource links and Back restore the URL search, sorting and page', async () => {
    render(<MemoryRouter initialEntries={['/resources/a?q=first&page=1']}>
      <ResourceHistoryNavigation />
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ q: 'first', offset: 50 }), expect.any(Object)));
    fireEvent.click(screen.getByRole('button', { name: 'Open another resource view' }));
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ q: 'second', sort: 'name desc', offset: 100 }), expect.any(Object)));
    expect(screen.getByPlaceholderText('Full-text search in this table...')).toHaveValue('second');
    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ q: 'first', sort: undefined, offset: 50 }), expect.any(Object)));
    expect(screen.getByLabelText('Current resource URL')).toHaveTextContent('?q=first&page=1');
  });

  test('editing a query keeps input focus and uses its updated filters for export', async () => {
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a');
    const input = screen.getByPlaceholderText('Full-text search in this table...');
    input.focus();
    fireEvent.change(input, { target: { value: 'Ottawa' } });
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ q: 'Ottawa', offset: 0 }), expect.any(Object)));
    expect(input).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Download CSV (filtered)' }).getAttribute('href')).toContain('q=Ottawa');
    expect(screen.getByRole('link', { name: 'Download CSV (filtered)' })).toHaveAttribute('rel', 'nofollow');
    expect(screen.getByRole('link', { name: 'Download CSV (filtered)' })).toHaveAttribute('download');
  });
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
    expect(screen.getByRole('button', { name: 'Map', pressed: true })).toBeInTheDocument();
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
      ingestion: { ingested_at: '2026-09-01', fields: [{ id: 'province', type: 'TEXT' }] } };
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


test('a keepalive detecting expiry refreshes metadata and prepares once', async () => {
  const { NotIngestedError } = await import('../api/client.js');
  recordResourceActivity.mockRejectedValueOnce(new NotIngestedError('expired', 409));
  const cold = { ...resourceEnvelope('a').data, query_mode: 'ingestable', preparation: { supported: true, enabled: true, freshness: 'unprepared' } };
  const ready = { ...resourceEnvelope('a').data, ingestion: { ingested_at: '2026-09-27' }, preparation: { supported: true, enabled: true, freshness: 'current' } };
  fetchResource.mockResolvedValueOnce(resourceEnvelope('a')).mockResolvedValueOnce({ data: cold }).mockResolvedValue({ data: ready });
  prepareResource.mockResolvedValue({ data: { id: 888, status: 'pending' } });
  fetchJob.mockResolvedValue({ data: { id: 888, status: 'done' } });
  render(<MemoryRouter initialEntries={['/resources/a']}>
    <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
  </MemoryRouter>);
  await waitFor(() => expect(fetchResource).toHaveBeenCalledTimes(3));
  expect(await screen.findByText('row-a')).toBeInTheDocument();
  expect(prepareResource).toHaveBeenCalledTimes(1);
  expect(recordResourceActivity).toHaveBeenCalled();
});
