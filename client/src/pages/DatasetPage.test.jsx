import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import DatasetPage from './DatasetPage.jsx';

vi.mock('../api/catalog.js', () => ({
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
      title: { en: `Dataset ${suffix.toUpperCase()}`, fr: null },
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
