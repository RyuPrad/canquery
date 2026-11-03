import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import LmiaEmployerPage from './LmiaEmployerPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { NotFoundError } from '../api/client.js';

vi.mock('../api/lmia.js', () => ({ fetchLmiaEmployer: vi.fn() }));
import { fetchLmiaEmployer } from '../api/lmia.js';

const EMPLOYER = {
  key: 'danchar', slug: 'danchar', name: 'Danchar Ltd', names: ['Danchar Ltd', 'DANCHAR LTD.'], provinces: ['AB', 'ON'],
  first_period: 201512, last_period: 202606, lists: 2, positions: 15, lmias: 3, truncated: false,
  lmias_since: { period_key: 202606, kind: 'quarter', start: '2026-04-01', end: '2026-06-30' },
  periods: [
    { period_key: 202606, kind: 'quarter', start: '2026-04-01', end: '2026-06-30', resource_id: 'r-2026q2', positions: 12, lmias: 3,
      provinces: ['ON'], streams: ['High Wage'], occupations: [{ code: '72311', title: 'Cabinetmakers', noc_version: 2021, positions: 7 },
        { code: '72310', title: 'Carpenters', noc_version: 2021, positions: 5 }],
      addresses: [{ address: 'Toronto, ON M5J 2X5', city: 'Toronto', province: 'ON' }] },
    { period_key: 201512, kind: 'year', start: '2015-01-01', end: '2015-12-31', resource_id: 'r-2015', positions: 3, lmias: null,
      provinces: ['AB'], streams: [], occupations: [], addresses: [{ address: 'Calgary, AB T2P 1J9', city: 'Calgary', province: 'AB' }] }
  ]
};

function renderAt(path) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/lmia/employers/:slug" element={<LmiaEmployerPage />} /></Routes>
      </MemoryRouter>
    </LangProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fetchLmiaEmployer.mockResolvedValue({ data: EMPLOYER });
});

describe('LmiaEmployerPage', () => {
  test('shows the employer on each list, newest first, with its official file', async () => {
    renderAt('/lmia/employers/danchar');
    expect(await screen.findByRole('heading', { level: 1, name: 'Danchar Ltd' })).toBeInTheDocument();
    expect(fetchLmiaEmployer).toHaveBeenCalledWith('danchar', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText('On 2 positive LMIA employers lists, from 2015 to Q2 2026.')).toBeInTheDocument();
    expect(screen.getByText('Provinces and territories: Alberta, Ontario')).toBeInTheDocument();
    expect(screen.getByText('Also listed as: DANCHAR LTD.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['Q2 2026 list', '2015 list']);
    expect(screen.getByText(/Approved positions: 12 · Approved LMIAs: 3 · High Wage/)).toBeInTheDocument();
    expect(screen.getByText('72311 – Cabinetmakers')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Official file' }).map(link => link.getAttribute('href')))
      .toEqual(['/resources/r-2026q2', '/resources/r-2015']);
    expect(screen.getByRole('link', { name: 'Search every employer' })).toHaveAttribute('href', '/lmia');
    // The 2015 list has no LMIA counts, so the total says where it starts.
    expect(screen.getByText(/Approved LMIAs since Q2 2026/)).toHaveTextContent('Approved LMIAs since Q2 2026 · 3');
    expect(screen.getByText('Different employers can share a name. Compare the addresses on each list before you rely on a match.')).toBeInTheDocument();
    expect(screen.queryByText(/oldest lists are not shown/)).not.toBeInTheDocument();
  });

  test('a history too long to show whole counts every list and says what is left out', async () => {
    fetchLmiaEmployer.mockResolvedValue({ data: { ...EMPLOYER, lists: 9, positions: 9001, truncated: true } });
    renderAt('/lmia/employers/danchar');
    expect(await screen.findByText('On 9 positive LMIA employers lists.')).toBeInTheDocument();
    expect(screen.getByText('Lists · 9')).toBeInTheDocument();
    expect(screen.getByText('This history is long, so its oldest lists are not shown. The totals above count every list.')).toBeInTheDocument();
  });

  test('an employer on no list says so', async () => {
    fetchLmiaEmployer.mockRejectedValue(new NotFoundError('missing', 404));
    renderAt('/lmia/employers/nobody');
    expect(await screen.findByRole('heading', { level: 1, name: 'This employer is not on any list' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search every employer' })).toHaveAttribute('href', '/lmia');
  });

  test('speaks French', async () => {
    localStorage.setItem('cq-lang', 'fr');
    renderAt('/lmia/employers/danchar');
    expect(await screen.findByText('Sur 2 listes d’employeurs ayant obtenu une EIMT positive, de 2015 au T2 2026.')).toBeInTheDocument();
    expect(screen.getByText(/Postes approuvés : 12 · EIMT approuvées : 3 · Volet des postes à haut salaire/)).toBeInTheDocument();
    expect(screen.getByText('Aussi inscrit sous : DANCHAR LTD.')).toBeInTheDocument();
    expect(screen.getByText(/EIMT approuvées depuis le T2 2026/)).toHaveTextContent('EIMT approuvées depuis le T2 2026 · 3');
  });
});
