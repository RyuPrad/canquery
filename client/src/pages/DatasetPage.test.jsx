import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import DatasetPage from './DatasetPage.jsx';
import { LangProvider } from '../i18n.jsx';

vi.mock('../api/catalog.js', () => ({
  fetchBlog: vi.fn(() => Promise.resolve({ data: [] })),
  fetchDataset: vi.fn(),
  enqueueIngest: vi.fn(),
  fetchJob: vi.fn(),
}));
import { enqueueIngest, fetchDataset, fetchJob } from '../api/catalog.js';

function datasetEnvelope(queryMode, suffix = 'a') {
  return {
    data: {
      id: `dataset-${suffix}`,
      name: `dataset-${suffix}`,
      title: { en: `Dataset ${suffix.toUpperCase()}`, fr: `Jeu de données ${suffix.toUpperCase()}` },
      notes: { en: 'Notes', fr: null },
      keywords: { en: [], fr: [] },
      organization: null,
      metadata_modified: null,
      resources: [{
        id: `resource-${suffix}`,
        name: { en: `Resource ${suffix.toUpperCase()}`, fr: null },
        format: 'CSV',
        size_bytes: null,
        query_mode: queryMode,
        url: 'https://example.test/a.csv',
      }],
    },
  };
}

function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/datasets/b')}>Open dataset B</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchDataset
    .mockResolvedValueOnce(datasetEnvelope('ingestable'))
    .mockResolvedValue(datasetEnvelope('ingested'));
});

describe('DatasetPage ingestion', () => {
  test('links the publisher to its canonical organization page', async () => {
    const env = datasetEnvelope('datastore');
    env.data.organization = { name: 'city-works', title: { en: 'City Works', fr: null } };
    fetchDataset.mockReset();
    fetchDataset.mockResolvedValue(env);

    render(
      <MemoryRouter initialEntries={['/datasets/dataset-a']}>
        <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: 'City Works' }))
      .toHaveAttribute('href', '/organizations/city-works');
  });

  test.each([
    ['en', 'Breadcrumb', 'Datasets', 'Dataset A'],
    ['fr', 'Fil d’Ariane', 'Jeux de données', 'Jeu de données A'],
  ])('shows the localized %s dataset breadcrumb', async (lang, ariaLabel, rootLabel, currentLabel) => {
    localStorage.setItem('cq-lang', lang);
    fetchDataset.mockReset();
    fetchDataset.mockResolvedValue(datasetEnvelope('ingestable'));

    render(
      <LangProvider>
        <MemoryRouter initialEntries={['/datasets/dataset-a']}>
          <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
        </MemoryRouter>
      </LangProvider>
    );

    const breadcrumb = await screen.findByRole('navigation', { name: ariaLabel });
    expect(within(breadcrumb).getByRole('link', { name: rootLabel })).toHaveAttribute('href', '/datasets');
    expect(within(breadcrumb).getByText(currentLabel)).toHaveAttribute('aria-current', 'page');
  });

  test('opens the correct resource page for a highlight and keeps every file reachable', async () => {
    const env = datasetEnvelope('datastore');
    env.data.resources = Array.from({ length: 55 }, (_, index) => ({
      ...env.data.resources[0],
      id: 'resource-' + (index + 1),
      name: { en: 'Resource ' + (index + 1), fr: null },
    }));
    fetchDataset.mockReset();
    fetchDataset.mockResolvedValue(env);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/datasets/dataset-a?highlight=resource-55']}>
          <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
        </MemoryRouter>
      );
    });

    expect(await screen.findByText('Resource 55')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Resource 55' })).toHaveAttribute('href', '/resources/resource-55');
    fireEvent.click(screen.getByRole('link', { name: 'Previous' }));
    expect(await screen.findByText('Resource 1')).toBeInTheDocument();
    expect(screen.queryByText('Resource 55')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/datasets/dataset-a?page=2');
  });

  test('offers the map before a spatial snapshot has been loaded', async () => {
    const env = datasetEnvelope('ingestable');
    env.data.resources[0].map = { available: true, geometry_type: 'point' };
    fetchDataset.mockReset();
    fetchDataset.mockResolvedValue(env);

    render(
      <MemoryRouter initialEntries={['/datasets/dataset-a']}>
        <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
      </MemoryRouter>
    );

    const mapLink = await screen.findByRole('link', { name: 'Map' });
    expect(mapLink).toHaveAttribute('href', '/resources/resource-a?view=map');
    expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument();
  });

  test('an already-loaded response refreshes the dataset without storing or polling a null job', async () => {
    enqueueIngest.mockResolvedValue({
      data: { id: null, resource_id: 'resource-a', status: 'done', already_loaded: true, row_count: 20 },
    });

    render(
      <MemoryRouter initialEntries={['/datasets/dataset-a']}>
        <Routes>
          <Route path="/datasets/:idOrName" element={<DatasetPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));

    await waitFor(() => expect(fetchDataset).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('link', { name: /Explore data/i })).toBeInTheDocument();
    expect(fetchJob).not.toHaveBeenCalled();
    expect(localStorage.getItem('cq-unlock-job-resource-a')).toBeNull();
  });

  test('route id changes discard the previous dataset state while the next dataset loads', async () => {
    let resolveDatasetB;
    fetchDataset.mockReset();
    fetchDataset.mockImplementation((id) => {
      if (id === 'a') return Promise.resolve(datasetEnvelope('ingestable', 'a'));
      return new Promise((resolve) => { resolveDatasetB = resolve; });
    });

    render(
      <MemoryRouter initialEntries={['/datasets/a']}>
        <Navigation />
        <Routes>
          <Route path="/datasets/:idOrName" element={<DatasetPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'Dataset A' });
    fireEvent.click(screen.getByRole('button', { name: 'Open dataset B' }));

    await waitFor(() => expect(fetchDataset).toHaveBeenCalledWith('b'));
    expect(screen.queryByRole('heading', { name: 'Dataset A' })).not.toBeInTheDocument();

    await act(async () => { resolveDatasetB(datasetEnvelope('ingestable', 'b')); });
    expect(await screen.findByRole('heading', { name: 'Dataset B' })).toBeInTheDocument();
  });
});


test('links download-only files and keeps keyword search as an action', async () => {
  const env = datasetEnvelope('file-only');
  env.data.resources[0].format = 'PDF';
  env.data.keywords.en = ['waiting times'];
  fetchDataset.mockReset();
  fetchDataset.mockResolvedValue(env);
  render(<MemoryRouter initialEntries={['/datasets/dataset-a']}><Routes>
    <Route path="/datasets/:idOrName" element={<DatasetPage />} />
    <Route path="/" element={<p>Filtered search</p>} />
  </Routes></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Resource A' })).toHaveAttribute('href', '/resources/resource-a');
  expect(screen.queryByRole('link', { name: 'waiting times' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'waiting times' }));
  expect(await screen.findByText('Filtered search')).toBeInTheDocument();
  expect(enqueueIngest).not.toHaveBeenCalled();
});
