import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
function Back() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Browser back</button>;
}
const pause = ms => act(() => new Promise(resolve => setTimeout(resolve, ms)));

function renderAt(path) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lmia" element={<LmiaPage />} />
          <Route path="/lmia/employers/:slug" element={<p>employer page</p>} />
        </Routes>
        <Location />
        <Back />
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
    expect(screen.getByText(/each quarter, from June 20, 2014 to Q2 2026\./)).toBeInTheDocument();
    expect(screen.getByText('Latest list · Q2 2026')).toBeInTheDocument();
    expect(screen.getByText('Employers across all lists · 150,691')).toBeInTheDocument();
    const provinces = screen.getByRole('heading', { level: 3, name: 'By province or territory' }).parentElement;
    expect(within(provinces).getByText('Head office outside Canada')).toBeInTheDocument();
    expect(within(provinces).getByText('3 employers · 4 positions')).toBeInTheDocument();
    expect(screen.getByText('85101 – Harvesting labourers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Les Entreprises Pitre Inc.' })).toHaveAttribute('href', '/lmia/employers/les-entreprises-pitre');
    expect(screen.getByRole('link', { name: 'June 20 to December 31, 2014 list' })).toHaveAttribute('href', '/resources/r-2014');
    expect(screen.getByRole('link', { name: /How to check an employer/ })).toHaveAttribute('href', '/blog/check-employer-positive-lmia');
    expect(screen.getByText(/It is not a job offer or a work permit/)).toBeInTheDocument();
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
  });

  test('typing a name searches after a pause, keeps it in the address and pages through results', async () => {
    renderAt('/lmia');
    const box = await screen.findByRole('searchbox', { name: 'Employer, e.g. Tim Hortons' });
    fireEvent.change(box, { target: { value: 'Danchar Ltd.' } });
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith({ q: 'Danchar Ltd.', province: '', occupation: '', page: 1 },
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(screen.getByTestId('location')).toHaveTextContent('/lmia?q=Danchar+Ltd.');
    expect(await screen.findByText('51 employers, page 1 of 2')).toBeInTheDocument();
    const results = screen.getByText('51 employers, page 1 of 2').parentElement;
    expect(within(results).getByRole('link', { name: 'Danchar Ltd' })).toHaveAttribute('href', '/lmia/employers/danchar');
    expect(within(results).getByText(/Toronto, Ontario · on 2 lists, latest Q2 2026 · 15 approved positions in all/)).toBeInTheDocument();
    expect(within(results).getByText(/Manitoba · on the Q2 2026 list · 3 approved positions in all/)).toBeInTheDocument();
    searchLmiaEmployers.mockResolvedValue({ data: { ...RESULTS, page: 2, rows: RESULTS.rows.slice(1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenLastCalledWith(
      { q: 'Danchar Ltd.', province: '', occupation: '', page: 2 }, expect.anything()));
    expect(screen.getByTestId('location')).toHaveTextContent('page=2');
    // The new page is announced and takes focus at its first line.
    const line = await screen.findByText('51 employers, page 2 of 2');
    expect(line).toHaveAttribute('role', 'status');
    await waitFor(() => expect(line).toHaveFocus());
    // Paging is a step Back returns from.
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/lmia?q=Danchar+Ltd.'));
  });

  test('a province chosen while a typed name waits is kept, and so is a code when a name follows it', async () => {
    renderAt('/lmia');
    const box = await screen.findByRole('searchbox');
    fireEvent.change(box, { target: { value: 'tim' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Province or territory' }), { target: { value: 'NL' } });
    await pause(450);
    expect(screen.getByTestId('location').textContent).toBe('/lmia?province=NL&q=tim');
    expect(screen.getByRole('combobox', { name: 'Province or territory' })).toHaveValue('NL');
    fireEvent.change(screen.getByRole('textbox', { name: 'NOC code' }), { target: { value: '72310' } });
    await pause(320);
    fireEvent.change(box, { target: { value: 'timber' } });
    await pause(450);
    expect(screen.getByTestId('location').textContent).toBe('/lmia?province=NL&q=timber&occupation=72310');
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenLastCalledWith(
      { q: 'timber', province: 'NL', occupation: '72310', page: 1 }, expect.anything()));
  });

  test('a filter starts again from the first page, and Back brings the earlier search back into the box', async () => {
    renderAt('/lmia?q=danchar');
    const box = await screen.findByRole('searchbox');
    expect(box).toHaveValue('danchar');
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/lmia?q=danchar&page=2'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Province or territory' }), { target: { value: 'ON' } });
    expect(screen.getByTestId('location').textContent).toBe('/lmia?q=danchar&province=ON');
    fireEvent.change(box, { target: { value: 'acme' } });
    await pause(450);
    expect(screen.getByTestId('location').textContent).toBe('/lmia?q=acme&province=ON');
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/lmia?q=danchar'));
    expect(box).toHaveValue('danchar');
    expect(screen.getByRole('combobox', { name: 'Province or territory' })).toHaveValue('');
  });

  test('one letter alone does not search; with a province it does', async () => {
    renderAt('/lmia');
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'a' } });
    await pause(400);
    expect(screen.getByText('Type at least 2 letters, or choose a province or an occupation.')).toBeInTheDocument();
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Province or territory' }), { target: { value: 'ON' } });
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith({ q: 'a', province: 'ON', occupation: '', page: 1 }, expect.anything()));
    expect(screen.queryByText(/Type at least 2 letters/)).not.toBeInTheDocument();
  });

  test('one approved position is singular, in English and French', async () => {
    const single = { ...RESULTS, total: 1, rows: [{ ...RESULTS.rows[1], positions: 1 }] };
    searchLmiaEmployers.mockResolvedValue({ data: single });
    const view = renderAt('/lmia?q=danchar');
    expect(await screen.findByText(/on the Q2 2026 list · 1 approved position in all$/)).toBeInTheDocument();
    expect(screen.getByText('1 employer')).toBeInTheDocument();
    view.unmount();
    localStorage.setItem('cq-lang', 'fr');
    renderAt('/lmia?q=danchar');
    expect(await screen.findByText(/sur la liste T2 2026 · 1 poste approuvé en tout$/)).toBeInTheDocument();
  });

  test('a refused search and too many searches are explained', async () => {
    searchLmiaEmployers.mockRejectedValueOnce(new ApiError('bad', 400));
    const view = renderAt('/lmia?q=danchar');
    expect(await screen.findByText(/Check the search: a name of up to 100 characters/)).toBeInTheDocument();
    view.unmount();
    searchLmiaEmployers.mockRejectedValueOnce(new ApiError('slow down', 429));
    renderAt('/lmia?q=danchar');
    expect(await screen.findByText('Too many searches in a minute. Wait a moment and try again.')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveAttribute('maxlength', '100');
  });

  test('a shared address searches with its filters at once', async () => {
    renderAt('/lmia?q=danchar&province=ON&occupation=72310');
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith(
      { q: 'danchar', province: 'ON', occupation: '72310', page: 1 }, expect.anything()));
    expect(await screen.findByRole('combobox', { name: 'Province or territory' })).toHaveValue('ON');
  });

  test('an occupation that is not a NOC code says so once the box is left, and leaves the search', async () => {
    renderAt('/lmia');
    const code = await screen.findByRole('textbox', { name: 'NOC code' });
    fireEvent.change(code, { target: { value: '723' } });
    expect(screen.queryByText(/Enter a 5-digit NOC 2021 code/)).not.toBeInTheDocument();
    expect(code).toHaveAttribute('aria-invalid', 'false');
    fireEvent.blur(code);
    expect(screen.getByText(/Enter a 5-digit NOC 2021 code, or a 4-digit NOC 2011 code for lists before April 2024\./)).toBeInTheDocument();
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await pause(400);
    expect(searchLmiaEmployers).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '72310' } });
    await waitFor(() => expect(searchLmiaEmployers).toHaveBeenCalledWith(
      { q: '', province: '', occupation: '72310', page: 1 }, expect.anything()));
    expect(code).toHaveAttribute('aria-invalid', 'false');
    // Letters are an error at once; a code that stops being one leaves the address.
    fireEvent.change(code, { target: { value: '7231x' } });
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await pause(400);
    expect(screen.getByTestId('location').textContent).toBe('/lmia');
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
    expect(screen.getByText(/chaque trimestre, du 20 juin 2014 au T2 2026\./)).toBeInTheDocument();
    expect(screen.getByText('Les intitulés des professions sont ceux des fichiers anglais de l’éditeur.')).toBeInTheDocument();
    const provinces = screen.getByRole('heading', { level: 3, name: 'Par province ou territoire' }).parentElement;
    expect(within(provinces).getByText('Siège social à l’extérieur du Canada')).toBeInTheDocument();
    expect(screen.getByText('Volet des talents mondiaux')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Comment vérifier un employeur/ })).toHaveAttribute('href', '/fr/blog/verifier-employeur-eimt-positive');
  });
});
