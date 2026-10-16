import { describe, beforeEach, afterEach, vi, expect, test } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchResource: vi.fn(),
  queryResource: vi.fn(),
  fetchResourcePreview: vi.fn(),
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
import { prepareResource, fetchJob, fetchResource, queryResource, recordResourceActivity, fetchResourcePreview } from '../api/catalog.js';
import { ApiError, NotIngestedError } from '../api/client.js';
import * as rowPageCache from '../utils/rowPageCache.js';
import { clearResourceHints, rememberResource } from '../utils/resourceHints.js';

const SNAPSHOT_1 = 'cqs1_' + '1'.repeat(64);
const SNAPSHOT_2 = 'cqs1_' + '2'.repeat(64);
const pageEnvelope = (id, offset = 0, total = 200) => ({
  data: {
    fields: [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }],
    records: [{ _id: offset + 1, name: `row-${id}-${offset}` }],
    total,
  },
  meta: { query_mode: 'ingested', snapshot: { id: SNAPSHOT_1 } },
});
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
  rowPageCache.clear();
  // Prefetching is exercised explicitly; elsewhere it would make call counts timing-dependent.
  rowPageCache.pausePrefetch(60 * 1000);
  clearResourceHints();
  fetchResourcePreview.mockRejectedValue(new Error('no preview in this test'));
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

  test('Chart does not display a prior Table total or its row export', async () => {
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a');
    expect(screen.getByRole('link', { name: 'Download CSV (filtered)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    await screen.findByTestId('chart');
    expect(screen.queryByRole('link', { name: 'Download CSV (filtered)' })).toBeNull();
    expect(screen.queryByText('200 rows')).toBeNull();
    expect(queryResource).toHaveBeenCalledTimes(1);
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
      ingestion: { ingested_at: '2026-09-01', snapshot_id: SNAPSHOT_1, fields: [{ id: 'status desc', type: 'TEXT' }] } };
    const after = { ...before, preparation: { supported: true, freshness: 'current' },
      ingestion: { ...before.ingestion, ingested_at: '2026-09-02', snapshot_id: SNAPSHOT_2 } };
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
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ sort, snapshot: SNAPSHOT_2 }), expect.any(Object)));
    expect(queryResource).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('The updated file has different columns. Affected filters or sorting were cleared.')).toBeNull();
  });
  test('same-resource links and Back restore the URL search, sorting and page without refetching a seen page', async () => {
    queryResource.mockImplementation((id, { q, offset }) => Promise.resolve({
      ...pageEnvelope(id, offset), data: { ...pageEnvelope(id, offset).data, records: [{ _id: 1, name: `row-${id}-${q || ''}-${offset}` }] }
    }));
    render(<MemoryRouter initialEntries={['/resources/a?q=first&page=1']}>
      <ResourceHistoryNavigation />
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('row-a-first-50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open another resource view' }));
    expect(await screen.findByText('row-a-second-100')).toBeInTheDocument();
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ q: 'second', sort: 'name desc', offset: 100 }), expect.any(Object));
    expect(screen.getByPlaceholderText('Full-text search in this table...')).toHaveValue('second');
    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(await screen.findByText('row-a-first-50')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Full-text search in this table...')).toHaveValue('first');
    expect(screen.getByLabelText('Current resource URL')).toHaveTextContent('?q=first&page=1');
    expect(queryResource).toHaveBeenCalledTimes(2);
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


describe('ResourcePage row cache', () => {
  const prepared = (snapshot = SNAPSHOT_1) => ({ data: { ...resourceEnvelope('a').data,
    ingestion: { ingested_at: '2026-09-01', snapshot_id: snapshot, row_count: 200, fields: [{ id: 'name', type: 'TEXT' }] } } });
  const visibility = (state) => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });

  beforeEach(() => {
    queryResource.mockImplementation((id, { offset = 0 } = {}) => Promise.resolve(pageEnvelope(id, offset)));
  });

  test('an unseen page keeps the page on screen visible, not the last fetched one, while it loads', async () => {
    let finish;
    queryResource.mockImplementation((id, { offset = 0 } = {}) => offset === 150
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve(pageEnvelope(id, offset)));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-0');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('row-a-50');
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('row-a-0')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Go to page' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 150 }), expect.any(Object)));
    expect(screen.getByText('row-a-0')).toBeInTheDocument();
    expect(screen.queryByText('row-a-50')).toBeNull();
    expect(screen.getByText('Page 4 / 4')).toBeInTheDocument();
    await act(async () => finish(pageEnvelope('a', 150)));
    expect(await screen.findByText('row-a-150')).toBeInTheDocument();
    expect(queryResource).toHaveBeenCalledTimes(3);
  });

  test('returning to a seen page or to the Table shows it without another request', async () => {
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-0');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('row-a-50');
    expect(queryResource).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('row-a-0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    await screen.findByTestId('chart');
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByText('row-a-0')).toBeInTheDocument();
    expect(queryResource).toHaveBeenCalledTimes(2);
  });

  test('prefetches the page behind the current one and then shows it at once', async () => {
    rowPageCache.clear();
    fetchResource.mockResolvedValue(prepared());
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-0');
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 0, snapshot: SNAPSHOT_1 }), expect.any(Object));
    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 50, snapshot: SNAPSHOT_1 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await pause(20);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('row-a-50')).toBeInTheDocument();
    expect(screen.getByText('Page 2 / 4')).toBeInTheDocument();
    expect(queryResource).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(3), { timeout: 1500 });
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 100 }), expect.any(Object));
  });

  test('does not prefetch in a hidden tab or for the last page', async () => {
    rowPageCache.clear();
    visibility('hidden');
    try {
      fetchResource.mockResolvedValue(prepared());
      render(<MemoryRouter initialEntries={['/resources/a']}>
        <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
      </MemoryRouter>);
      await screen.findByText('row-a-0');
      await pause(450);
      expect(queryResource).toHaveBeenCalledTimes(1);
    } finally {
      visibility('visible');
    }
    rowPageCache.clear();
    queryResource.mockImplementation((id, { offset = 0 } = {}) => Promise.resolve(pageEnvelope(id, offset, 60)));
    render(<MemoryRouter initialEntries={['/resources/a?page=1']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-50');
    await pause(450);
    expect(queryResource).toHaveBeenCalledTimes(2);
  });

  test('stops prefetching after a rate limit', async () => {
    rowPageCache.clear();
    fetchResource.mockResolvedValue(prepared());
    queryResource.mockImplementation((id, { offset = 0 } = {}) => offset === 50 && queryResource.mock.calls.length === 2
      ? Promise.reject(new ApiError('Too many requests', 429, { retry_after: 30 }))
      : Promise.resolve(pageEnvelope(id, offset)));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-0');
    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(2), { timeout: 1500 });
    await pause(20);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('row-a-50');
    expect(queryResource).toHaveBeenCalledTimes(3);
    await pause(450);
    expect(queryResource).toHaveBeenCalledTimes(3);
  });

  test('a replaced copy refreshes the metadata and refetches with its snapshot while the rows stay on screen', async () => {
    fetchResource.mockResolvedValueOnce(prepared(SNAPSHOT_1)).mockResolvedValue(prepared(SNAPSHOT_2));
    let finish;
    queryResource.mockImplementation((id, { offset = 0, snapshot } = {}) => {
      if (offset === 50 && snapshot === SNAPSHOT_1) {
        return Promise.reject(new NotIngestedError('The requested snapshot is no longer available', 409, { code: 'SNAPSHOT_UNAVAILABLE' }));
      }
      if (offset === 50) return new Promise(resolve => { finish = resolve; });
      return Promise.resolve(pageEnvelope(id, offset));
    });
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-0');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(fetchResource).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 50, snapshot: SNAPSHOT_2 }), expect.any(Object)));
    expect(screen.getByText('row-a-0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => finish({ ...pageEnvelope('a', 50), meta: { query_mode: 'ingested', snapshot: { id: SNAPSHOT_2 } } }));
    expect(await screen.findByText('row-a-50')).toBeInTheDocument();
    expect(queryResource).toHaveBeenCalledTimes(3);
  });

  test('a resource known to be prepared starts its rows with the metadata and never refetches them', async () => {
    rememberResource({ id: 'a', query_mode: 'ingested', ingestion: { snapshot_id: SNAPSHOT_1 } });
    let resolveMetadata;
    fetchResource.mockImplementation(() => new Promise(resolve => { resolveMetadata = resolve; }));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Loading the data...' })).toHaveAttribute('aria-busy', 'true');
    expect(queryResource).toHaveBeenCalledWith('a', expect.objectContaining({ offset: 0, limit: 50, snapshot: SNAPSHOT_1 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(prepareResource).not.toHaveBeenCalled();
    await act(async () => resolveMetadata(prepared()));
    expect(await screen.findByText('row-a-0')).toBeInTheDocument();
    expect(queryResource).toHaveBeenCalledTimes(1);
    expect(recordResourceActivity).toHaveBeenCalled();
  });

  test('a hint for an unprepared resource or a filtered view starts nothing before the metadata', async () => {
    rememberResource({ id: 'a', query_mode: 'ingestable' });
    fetchResource.mockImplementation(() => new Promise(() => {}));
    const first = render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(queryResource).not.toHaveBeenCalled();
    first.unmount();
    rememberResource({ id: 'a', query_mode: 'ingested', ingestion: { snapshot_id: SNAPSHOT_1 } });
    render(<MemoryRouter initialEntries={['/resources/a?q=ottawa']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await pause(300);
    expect(queryResource).not.toHaveBeenCalled();
  });
});

describe('ResourcePage embedded initial data', () => {
  const embed = ({ path = '/resources/a', page = 0, resource = prepared().data, rows = pageEnvelope('a', 0), version = 1 } = {}) => {
    const element = document.createElement('script');
    element.type = 'application/json';
    element.id = 'cq-initial';
    element.textContent = JSON.stringify({ version, path, page, resource: { data: resource, pagination: { nextCursor: null }, meta: {} }, rows })
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    document.body.appendChild(element);
  };
  const prepared = () => ({ data: { ...resourceEnvelope('a').data,
    ingestion: { ingested_at: '2026-09-01', snapshot_id: SNAPSHOT_1, row_count: 200, fields: [{ id: 'name', type: 'TEXT' }] } } });

  beforeEach(() => {
    queryResource.mockImplementation((id, { offset = 0 } = {}) => Promise.resolve(pageEnvelope(id, offset)));
  });
  afterEach(() => {
    document.getElementById('cq-initial')?.remove();
  });

  test('a direct visit draws the embedded page at once and makes no request for it', async () => {
    embed({ rows: { ...pageEnvelope('a', 0), data: { ...pageEnvelope('a', 0).data, records: [{ _id: 1, name: 'row-inline' }] } } });
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(screen.getByText('row-inline')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Resource a', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('200 rows')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading the data...' })).toBeNull();
    expect(document.getElementById('cq-initial')).toBeNull();
    await waitFor(() => expect(recordResourceActivity).toHaveBeenCalledWith('a', expect.any(Object)));
    expect(fetchResource).not.toHaveBeenCalled();
    expect(queryResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('row-a-50');
    expect(queryResource).toHaveBeenCalledTimes(1);
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 50, snapshot: SNAPSHOT_1 }), expect.any(Object));
  });

  test('a block for another URL, page or snapshot is ignored and the usual requests run', async () => {
    embed({ path: '/resources/a?page=3', page: 3 });
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('row-a-0')).toBeInTheDocument();
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(queryResource).toHaveBeenCalledTimes(1);
    expect(document.getElementById('cq-initial')).toBeNull();
  });

  test('embedded metadata without rows still saves the metadata request', async () => {
    embed({ path: '/resources/a?view=chart', page: null, rows: null });
    render(<MemoryRouter initialEntries={['/resources/a?view=chart']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByTestId('chart')).toHaveAttribute('data-mode', 'ingested');
    expect(fetchResource).not.toHaveBeenCalled();
    expect(queryResource).not.toHaveBeenCalled();
    embed({ path: '/resources/a?page=1', page: null, rows: null });
    render(<MemoryRouter initialEntries={['/resources/a?page=1']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('row-a-50')).toBeInTheDocument();
    expect(fetchResource).not.toHaveBeenCalled();
    expect(queryResource).toHaveBeenCalledTimes(1);
  });

  test('a later metadata refresh fetches as usual', async () => {
    embed();
    recordResourceActivity.mockRejectedValueOnce(new NotIngestedError('expired', 409));
    fetchResource.mockResolvedValue({ data: { ...prepared().data, ingestion: { ...prepared().data.ingestion, snapshot_id: SNAPSHOT_2 } } });
    queryResource.mockImplementation((id, { offset = 0 } = {}) => Promise.resolve({ ...pageEnvelope(id, offset), meta: { query_mode: 'ingested', snapshot: { id: SNAPSHOT_2 } } }));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(screen.getByText('row-a-0')).toBeInTheDocument();
    await waitFor(() => expect(fetchResource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('a', expect.objectContaining({ offset: 0, snapshot: SNAPSHOT_2 }), expect.any(Object)));
    expect(await screen.findByText('row-a-0')).toBeInTheDocument();
  });
});

describe('ResourcePage table frame and page box', () => {
  const prepared = () => ({ data: { ...resourceEnvelope('a').data,
    ingestion: { ingested_at: '2026-09-01', snapshot_id: SNAPSHOT_1, row_count: 200, fields: [{ id: 'name', type: 'TEXT' }] } } });

  beforeEach(() => {
    queryResource.mockImplementation((id, { offset = 0 } = {}) => Promise.resolve(pageEnvelope(id, offset)));
  });

  test('the recorded columns, row count and pager show while the first page loads', async () => {
    fetchResource.mockResolvedValue(prepared());
    let finish;
    queryResource.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByRole('heading', { name: 'Resource a', level: 1 });
    expect(screen.getByRole('status', { name: 'Loading the data...' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('columnheader', { name: 'nameTEXT' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^name · / })).toBeInTheDocument();
    expect(document.querySelectorAll('.cq-skel-cell').length).toBeGreaterThan(0);
    expect(screen.getByText('200 rows')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    // The frame is on screen before the rows effect has even started its request.
    await waitFor(() => expect(queryResource).toHaveBeenCalledTimes(1));
    await act(async () => finish(pageEnvelope('a', 0)));
    expect(await screen.findByText('row-a-0')).toBeInTheDocument();
    expect(document.querySelectorAll('.cq-skel-cell')).toHaveLength(0);
    expect(screen.queryByRole('status', { name: 'Loading the data...' })).toBeNull();
  });

  test('a search keeps the generic count hidden until its page answers', async () => {
    fetchResource.mockResolvedValue(prepared());
    queryResource.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter initialEntries={['/resources/a?q=ottawa']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByRole('heading', { name: 'Resource a', level: 1 });
    await waitFor(() => expect(queryResource).toHaveBeenCalled());
    expect(screen.getByRole('columnheader', { name: 'nameTEXT' })).toBeInTheDocument();
    expect(screen.queryByText('200 rows')).toBeNull();
    expect(screen.queryByText(/Page 1/)).toBeNull();
  });

  test('the page box jumps to a page, clamps to the last page and serves a seen page again at once', async () => {
    fetchResource.mockResolvedValue(prepared());
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    await screen.findByText('row-a-0');
    const box = screen.getByRole('spinbutton', { name: 'Go to page' });
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText('row-a-100')).toBeInTheDocument();
    expect(screen.getByText('Page 3 / 4')).toBeInTheDocument();
    expect(queryResource).toHaveBeenLastCalledWith('a', expect.objectContaining({ offset: 100, snapshot: SNAPSHOT_1 }), expect.any(Object));
    expect(box).toHaveValue(null);
    fireEvent.change(box, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText('row-a-150')).toBeInTheDocument();
    expect(screen.getByText('Page 4 / 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByText('row-a-100')).toBeInTheDocument();
    expect(queryResource).toHaveBeenCalledTimes(3);
  });
});

describe('ResourcePage preview while a file is prepared', () => {
  const unprepared = () => ({ data: { ...resourceEnvelope('a').data, query_mode: 'ingestable',
    preparation: { supported: true, enabled: true, freshness: 'unprepared' } } });
  const prepared = () => ({ data: { ...resourceEnvelope('a').data, preparation: { supported: true, enabled: true, freshness: 'current' },
    ingestion: { ingested_at: '2026-10-16', snapshot_id: SNAPSHOT_1, row_count: 200, fields: [{ id: 'name', type: 'TEXT' }] } } });
  beforeEach(() => {
    queryResource.mockImplementation((id, { offset = 0 } = {}) => Promise.resolve(pageEnvelope(id, offset)));
  });
  const previewEnvelope = () => ({
    data: { fields: [{ id: 'Year', type: 'INTEGER', original_label: 'Year' }, { id: 'City', type: 'TEXT', original_label: 'City' }],
      records: [{ Year: '2024', City: 'preview-ottawa' }, { Year: '2025', City: 'preview-hull' }], truncated: true, sampled_rows: 2, bytes_read: 262144, content_length: 111600495 },
    meta: { query_mode: 'preview' },
  });

  test('shows the first rows and the download progress while the file is prepared, then the real table', async () => {
    fetchResource.mockResolvedValueOnce(unprepared()).mockResolvedValue(prepared());
    fetchResourcePreview.mockResolvedValue(previewEnvelope());
    prepareResource.mockResolvedValue({ data: { id: 777, status: 'pending' } });
    let finish;
    fetchJob.mockResolvedValueOnce({ data: { id: 777, status: 'running', progress: { phase: 'downloading', bytes: 52428800, content_length: 111600495, rows: null, updated_at: '2026-10-16T00:00:00.000Z' } } })
      .mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('preview-ottawa')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Showing the first 2 rows of the file.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'YearINTEGER' })).not.toHaveAttribute('aria-sort');
    expect(screen.queryByRole('textbox', { name: /Year/ })).toBeNull();
    expect(await screen.findByText('Downloading 52.4 MB of 111.6 MB')).toBeInTheDocument();
    expect(screen.getByText('Preparing your table and charts…')).toBeInTheDocument();
    expect(fetchResourcePreview).toHaveBeenCalledWith('a', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(queryResource).not.toHaveBeenCalled();
    await waitFor(() => expect(finish).toBeTruthy(), { timeout: 4000 });
    await act(async () => finish({ data: { id: 777, status: 'done' } }));
    expect(await screen.findByText('row-a-0')).toBeInTheDocument();
    expect(screen.queryByText('preview-ottawa')).toBeNull();
    expect(screen.queryByText('Preview')).toBeNull();
    expect(fetchResourcePreview).toHaveBeenCalledTimes(1);
  });

  test('a failed preview keeps the plain preparation card, and other formats never ask for one', async () => {
    fetchResource.mockResolvedValue(unprepared());
    fetchResourcePreview.mockRejectedValue(new Error('upstream'));
    prepareResource.mockResolvedValue({ data: { id: 778, status: 'pending' } });
    fetchJob.mockImplementation(() => new Promise(() => {}));
    const first = render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('Preparing this file automatically…')).toBeInTheDocument();
    await waitFor(() => expect(fetchResourcePreview).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Preview')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    first.unmount();
    fetchResourcePreview.mockClear();
    fetchResource.mockResolvedValue({ data: { ...unprepared().data, format: 'XLSX', url: 'https://example.test/a.xlsx' } });
    render(<MemoryRouter initialEntries={['/resources/a']}>
      <Routes><Route path="/resources/:id" element={<ResourcePage />} /></Routes>
    </MemoryRouter>);
    expect(await screen.findByText('Preparing this file automatically…')).toBeInTheDocument();
    expect(fetchResourcePreview).not.toHaveBeenCalled();
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
