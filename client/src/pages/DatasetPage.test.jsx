import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
    expect(screen.getByRole('link', { name: 'Explore data' })).toHaveAttribute('href', '/resources/resource-a');
  });

  test('lists unprepared resources without admitting jobs or polling them', async () => {
    render(
      <MemoryRouter initialEntries={['/datasets/dataset-a']}>
        <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'Explore data' })).toHaveAttribute('href', '/resources/resource-a');
    expect(enqueueIngest).not.toHaveBeenCalled();
    expect(fetchJob).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();
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

describe('DatasetPage embedded data', () => {
  const guide = { id: 'g1', lang: 'en', path: '/blog/g1', title: 'Read the dataset', description: 'How to read it.', topic: 't', query: 'q', translations: {} };
  const embed = (path, envelope = datasetEnvelope('ingested')) => {
    const element = document.createElement('script');
    element.type = 'application/json';
    element.id = 'cq-initial';
    element.textContent = JSON.stringify({ version: 1, kind: 'dataset', path, dataset: envelope,
      guides: { en: { data: [guide] }, fr: { data: [] } } });
    document.body.appendChild(element);
  };
  const renderAt = (entry) => render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
    </MemoryRouter>
  );

  test('renders the dataset and its guides from the page without fetching either', async () => {
    const { fetchBlog } = await import('../api/catalog.js');
    fetchDataset.mockReset();
    embed('/datasets/dataset-a');
    renderAt('/datasets/dataset-a');

    expect(screen.getByRole('heading', { level: 1, name: 'Dataset A' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Read the dataset' })).toHaveAttribute('href', '/blog/g1');
    expect(fetchDataset).not.toHaveBeenCalled();
    expect(fetchBlog).not.toHaveBeenCalled();
    expect(document.getElementById('cq-initial')).toBeNull();
  });

  test('fetches as usual when the block answers another URL', async () => {
    fetchDataset.mockReset();
    fetchDataset.mockResolvedValue(datasetEnvelope('ingested'));
    embed('/datasets/dataset-a?page=2');
    renderAt('/datasets/dataset-a');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dataset A' })).toBeInTheDocument();
    expect(fetchDataset).toHaveBeenCalledWith('dataset-a');
    expect(document.getElementById('cq-initial')).toBeNull();
  });
});

describe('DatasetPage file filter', () => {
  // These tests render 50-card lists; the full suite runs them under parallel load.
  const slow = { timeout: 5000 };
  const species = ['Skate', 'Sébaste', 'Plaice'];
  // 120 files: ten per year from 2000 to 2011, English and French in turn, every fourth an XLSX.
  function fileList(count = 120) {
    return Array.from({ length: count }, (_, index) => {
      const year = 2000 + Math.floor(index / 10);
      const language = index % 2 === 0 ? 'en' : 'fr';
      const format = index % 4 === 3 ? 'XLSX' : 'CSV';
      const name = `${year} ${species[index % 3]} ${index + 1}`;
      return {
        id: 'file-' + (index + 1),
        name: { en: name, fr: null },
        format,
        language,
        size_bytes: null,
        query_mode: 'file-only',
        url: `https://example.test/${index + 1}.${format.toLowerCase()}`,
        presentation: {
          title: { en: `${name} (${language === 'en' ? 'English' : 'French'}, ${format})`, fr: `${name} (${language === 'en' ? 'anglais' : 'français'}, ${format})` },
          formats: [format],
          languages: [language],
        },
      };
    });
  }
  function envelopeWith(resources) {
    const env = datasetEnvelope('file-only');
    env.data.resources = resources;
    return env;
  }
  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname + location.search}</output>;
  }
  const renderAt = (entry) => render(
    <LangProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route path="/datasets/:idOrName" element={<DatasetPage />} /></Routes>
        <LocationProbe />
      </MemoryRouter>
    </LangProvider>
  );
  const fileLinks = () => screen.getAllByRole('link').filter(link => link.getAttribute('href')?.startsWith('/resources/'));

  beforeEach(() => {
    fetchDataset.mockReset();
    fetchDataset.mockResolvedValue(envelopeWith(fileList()));
  });

  test('narrows the files by name, year and language with counts that follow the other choices', async () => {
    renderAt('/datasets/dataset-a');
    const search = await screen.findByRole('textbox', { name: 'Search file names' }, slow);
    expect(screen.queryByText(/Showing/, { selector: 'span' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'skate' } });
    expect(screen.getByText('Showing 40 of 120 files', { selector: 'span' })).toBeInTheDocument();
    expect(fileLinks()[0]).toHaveTextContent('2000 Skate 1 (English, CSV)');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/datasets/dataset-a?q=skate'), slow);

    const year = screen.getByRole('combobox', { name: 'Year' });
    expect(within(year).getByRole('option', { name: '2001 (3)' })).toBeInTheDocument();
    fireEvent.change(year, { target: { value: '2001' } });
    expect(screen.getByText('Showing 3 of 120 files', { selector: 'span' })).toBeInTheDocument();
    expect(fileLinks().map(link => link.textContent)).toEqual([
      '2001 Skate 13 (English, CSV)',
      '2001 Skate 16 (French, XLSX)',
      '2001 Skate 19 (English, CSV)',
    ]);
    const language = screen.getByRole('combobox', { name: 'Language' });
    expect(within(language).getByRole('option', { name: 'English (2)' })).toBeInTheDocument();
    expect(within(language).getByRole('option', { name: 'French (1)' })).toBeInTheDocument();
    fireEvent.change(language, { target: { value: 'fr' } });
    expect(fileLinks().map(link => link.textContent)).toEqual(['2001 Skate 16 (French, XLSX)']);
    expect(screen.getByTestId('location')).toHaveTextContent('/datasets/dataset-a?q=skate&year=2001&language=fr');
  });

  test('pages a long filtered list with buttons and leaves ?page alone, then clears back to links', async () => {
    renderAt('/datasets/dataset-a?page=2');
    expect(await screen.findByText('Page 2', undefined, slow)).toHaveAttribute('aria-current', 'page');

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'en' } });
    expect(screen.getByText('Showing 60 of 120 files', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toHaveAttribute('aria-current', 'page');
    expect(fileLinks()).toHaveLength(50);
    expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2', undefined, slow)).toHaveAttribute('aria-current', 'page');
    expect(fileLinks().map(link => link.getAttribute('href'))).toEqual(
      Array.from({ length: 10 }, (_, index) => '/resources/file-' + (101 + index * 2))
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/datasets/dataset-a?page=2&language=en');
    expect(document.activeElement).toHaveTextContent('Resources');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText(/Showing/, { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/datasets\/dataset-a\?page=2$/);
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/datasets/dataset-a');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search file names' }));
  });

  test('a shared link opens the filtered list, and an empty result says so', async () => {
    renderAt('/datasets/dataset-a?year=2003&language=fr');
    expect(await screen.findByText('Showing 5 of 120 files', { selector: 'span' }, slow)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveValue('2003');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search file names' }), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No files match these filters.')).toBeInTheDocument();
    expect(fileLinks()).toHaveLength(0);
  });

  test('a highlighted file is shown even when the filters would hide it', async () => {
    renderAt('/datasets/dataset-a?language=en&highlight=file-2');
    expect(await screen.findByRole('link', { name: '2000 Sébaste 2 (French, CSV)' }, slow)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/datasets\/dataset-a$/), slow);
    expect(screen.queryByText(/Showing/, { selector: 'span' })).not.toBeInTheDocument();
  });

  test('embedded data with a filtered address is used as it is', async () => {
    const element = document.createElement('script');
    element.type = 'application/json';
    element.id = 'cq-initial';
    element.textContent = JSON.stringify({ version: 1, kind: 'dataset', path: '/datasets/dataset-a?language=fr',
      dataset: envelopeWith(fileList()), guides: { en: { data: [] }, fr: { data: [] } } });
    document.body.appendChild(element);
    renderAt('/datasets/dataset-a?language=fr');
    expect(screen.getByText('Showing 60 of 120 files', { selector: 'span' })).toBeInTheDocument();
    expect(fetchDataset).not.toHaveBeenCalled();
  });

  test('a dataset with one file still has the search box, and dropdowns appear only when they narrow', async () => {
    fetchDataset.mockResolvedValue(datasetEnvelope('ingestable'));
    const { unmount } = renderAt('/datasets/dataset-a');
    expect(await screen.findByRole('textbox', { name: 'Search file names' }, slow)).toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    unmount();

    fetchDataset.mockResolvedValue(envelopeWith(fileList(12).map(entry => ({ ...entry, format: 'CSV', presentation: { ...entry.presentation, formats: ['CSV'] } }))));
    renderAt('/datasets/dataset-a');
    await screen.findByRole('textbox', { name: 'Search file names' }, slow);
    expect(screen.getAllByRole('combobox').map(select => select.getAttribute('aria-label'))).toEqual(['Year', 'Language']);
  });

  test('announces a new count once choosing settles and keeps the filtered page across Back', async () => {
    function BackStub() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate(-1)}>Back to the dataset</button>;
    }
    render(
      <LangProvider>
        <MemoryRouter initialEntries={['/datasets/dataset-a']}>
          <Routes>
            <Route path="/datasets/:idOrName" element={<DatasetPage />} />
            <Route path="/resources/:id" element={<BackStub />} />
          </Routes>
        </MemoryRouter>
      </LangProvider>
    );
    const language = await screen.findByRole('combobox', { name: 'Language' }, slow);
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.change(language, { target: { value: 'en' } });
    expect(screen.getByRole('status')).toHaveTextContent('');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Showing 60 of 120 files'), slow);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2', undefined, slow)).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('link', { name: '2010 Sébaste 101 (English, CSV)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the dataset' }, slow));
    expect(await screen.findByText('Page 2', undefined, slow)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '2010 Sébaste 101 (English, CSV)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  });

  test('speaks French and reports filter use', async () => {
    const trackEvent = vi.fn(() => Promise.resolve());
    window.umami = { track: trackEvent };
    localStorage.setItem('cq-lang', 'fr');
    try {
      renderAt('/datasets/dataset-a');
      const search = await screen.findByRole('textbox', { name: 'Rechercher par nom de fichier' }, slow);
      expect(within(screen.getByRole('combobox', { name: 'Année' })).getByRole('option', { name: 'Toutes les années' })).toBeInTheDocument();
      fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), { target: { value: 'XLSX' } });
      expect(screen.getByText('Fichiers affichés : 30 sur 120', { selector: 'span' })).toBeInTheDocument();
      expect(trackEvent).toHaveBeenCalledWith('catalog_filter', { filter: 'dataset_file_format', value: 'XLSX', dataset_id: 'dataset-a', results: 30 });
      fireEvent.change(search, { target: { value: 'sébaste' } });
      await waitFor(() => expect(trackEvent).toHaveBeenCalledWith('catalog_filter', { filter: 'dataset_file_search', value: 'sébaste', dataset_id: 'dataset-a', results: 10 }), slow);
      fireEvent.click(screen.getByRole('button', { name: 'Effacer les filtres' }));
      expect(trackEvent).toHaveBeenCalledWith('catalog_filter', { action: 'clear', surface: 'dataset_files', dataset_id: 'dataset-a' });
    } finally {
      delete window.umami;
    }
  });
});
