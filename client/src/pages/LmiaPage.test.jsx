import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import LmiaPage from './LmiaPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { ApiError } from '../api/client.js';

vi.mock('../api/lmia.js', () => ({ fetchLmiaSummary: vi.fn(), searchLmiaEmployers: vi.fn() }));
import { fetchLmiaSummary, searchLmiaEmployers } from '../api/lmia.js';

const PERIODS = [
  { resource_id: 'r-2014', period_key: 201412, period_kind: 'year', period_start: '2014-06-20', period_end: '2014-12-31',
    employers: 3970, positions: 60792, lmias: null },
  { resource_id: 'r-2026q2', period_key: 202606, period_kind: 'quarter', period_start: '2026-04-01', period_end: '2026-06-30',
    employers: 6501, positions: 21515, lmias: 9066 }
];
const SUMMARY = {
  dataset_id: '90fed587-1364-4f33-a9ee-208181dc0b97',
  latest: PERIODS[1], periods: PERIODS, employers_total: 150691,
  provinces: [{ province: 'QC', employers: 2100, positions: 9200 }, { province: 'HO', employers: 3, positions: 4 }],
  streams: [{ stream: 'Low Wage', employers: 3000, positions: 9000 }, { stream: 'Global Talent Stream', employers: 10, positions: 20 }],
  occupations: [{ code: '85101', title: 'Harvesting labourers', noc_version: 2021, employers: 693, positions: 7509 }],
  top_employers: [{ employer_key: 'les entreprises pitre', slug: 'les-entreprises-pitre', employer: 'Les Entreprises Pitre Inc.',
    province: 'QC', city: 'Mont-Laurier', positions: 276 }]
};
const RESULTS = { total: 51, page: 1, page_size: 50, max_page: 200, rows: [
  { employer_key: 'danchar', slug: 'danchar', employer: 'Danchar Ltd', province: 'ON', city: 'Toronto', provinces: ['AB', 'ON'],
    first_period: 201412, last_period: 202606, periods: 2, positions: 15, last_positions: 12 },
  { employer_key: 'danchar farms', slug: 'danchar-farms', employer: 'Danchar Farms', province: 'MB', city: null, provinces: ['MB'],
    first_period: 202606, last_period: 202606, periods: 1, positions: 3, last_positions: 3 }
] };

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lmia" element={<LmiaPage />} />
          <Route path="/lmia/employers/:slug" element={<p>employer page</p>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </LangProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchLmiaSummary.mockResolvedValue({ data: SUMMARY });
  searchLmiaEmployers.mockResolvedValue({ data: RESULTS });
});

describe('LmiaPage', () => {
  test('shows every list, the latest by province, stream and occupation, and the top employers', async () => {
    renderAt('/lmia');
    expect(await screen.findByRole('heading', { level: 1, name: 'Positive LMIA employers list' })).toBeInTheDocument();
    expect(screen.getByText(/from June 20 to December 31, 2014 to Q2 2026\./)).toBeInTheDocument();
    expect(screen.getByText('Latest list · Q2 2026')).toBeInTheDocument();
    expect(screen.getByText('Employers on all lists · 150,691')).toBeInTheDocument();
    const provinces = screen.getByRole('heading', { level: 3, name: 'By province or territory' }).parentElement;
    expect(within(provinces).getByText('Head office outside Canada')).toBeInTheDocument();
    expect(screen.getByText('85101 – Harvesting labourers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Les Entreprises Pitre Inc.' })).toHaveAttribute('href', '/lmia/employers/les-entreprises-pitre');
    expect(screen.getByRole('link', { name: 'June 20 to December 31, 2014 list' })).toHaveAttribute('href', '/resources/r-2014');
    expect(screen.getByRole('link', { name: /How to check an employer/ })).toHaveAttribute('href', '/blog/check-employer-positive-lmia');
    expect(screen.getByText(/It is not a job offer or a work permit/)).toBeInTheDocument();
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
  });

  test('typing a name searches after a pause, keeps it in the address and pages through results', async () => {
    renderAt('/lmia');
    const box = await screen.findByRole('searchbox', { name: 'Employer name, for example Tim Hortons' });
    fireEvent.change(box, { target: { value: 'Danchar Ltd.' } });
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith({ q: 'Danchar Ltd.', province: '', occupation: '', page: 1 },
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(screen.getByTestId('location')).toHaveTextContent('/lmia?q=Danchar+Ltd.');
    expect(await screen.findByText('51 employers')).toBeInTheDocument();
    const results = screen.getByText('51 employers').parentElement;
    expect(within(results).getByRole('link', { name: 'Danchar Ltd' })).toHaveAttribute('href', '/lmia/employers/danchar');
    expect(within(results).getByText(/Toronto, Ontario · on 2 lists, latest Q2 2026 · 15 approved positions/)).toBeInTheDocument();
    expect(within(results).getByText(/Manitoba · on the Q2 2026 list · 3 approved positions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenLastCalledWith(
      { q: 'Danchar Ltd.', province: '', occupation: '', page: 2 }, expect.anything()));
    expect(screen.getByTestId('location')).toHaveTextContent('page=2');
  });

  test('a shared address searches with its filters at once', async () => {
    renderAt('/lmia?q=danchar&province=ON&occupation=72310');
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith(
      { q: 'danchar', province: 'ON', occupation: '72310', page: 1 }, expect.anything()));
    expect(await screen.findByRole('combobox', { name: 'Province or territory' })).toHaveValue('ON');
  });

  test('an occupation that is not a NOC code says so and does not search', async () => {
    renderAt('/lmia');
    const code = await screen.findByRole('textbox', { name: 'NOC code' });
    fireEvent.change(code, { target: { value: '723' } });
    expect(screen.getByText(/Enter a 5-digit NOC 2021 code/)).toBeInTheDocument();
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '72310' } });
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith(
      { q: '', province: '', occupation: '72310', page: 1 }, expect.anything()));
  });

  test('before the first load the page says the history is coming and offers the files', async () => {
    fetchLmiaSummary.mockRejectedValue(new ApiError('not loaded', 503));
    renderAt('/lmia');
    expect(await screen.findByText(/The history of the lists is being loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Every quarterly file' })).toHaveAttribute('href', '/datasets/90fed587-1364-4f33-a9ee-208181dc0b97');
  });

  test('a failed load can be retried', async () => {
    fetchLmiaSummary.mockRejectedValueOnce(new ApiError('down', 500));
    renderAt('/lmia');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Positive LMIA employers list' })).toBeInTheDocument();
    expect(fetchLmiaSummary).toHaveBeenCalledTimes(2);
  });

  test('speaks French', async () => {
    localStorage.setItem('cq-lang', 'fr');
    renderAt('/lmia');
    expect(await screen.findByRole('heading', { level: 1, name: 'Liste des employeurs ayant obtenu une EIMT positive' })).toBeInTheDocument();
    expect(screen.getByText(/du 20 juin au 31 décembre 2014 à T2 2026\./)).toBeInTheDocument();
    const provinces = screen.getByRole('heading', { level: 3, name: 'Par province ou territoire' }).parentElement;
    expect(within(provinces).getByText('Siège social à l’extérieur du Canada')).toBeInTheDocument();
    expect(screen.getByText('Volet des talents mondiaux')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Comment vérifier un employeur/ })).toHaveAttribute('href', '/fr/blog/verifier-employeur-eimt-positive');
  });
});
