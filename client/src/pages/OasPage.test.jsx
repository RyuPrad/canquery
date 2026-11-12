import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import OasPage from './OasPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { ApiError } from '../api/client.js';
import { resetOasData } from '../utils/oasData.js';
import { NBSP } from '../utils/oas.js';

vi.mock('../api/oas.js', async (original) => ({ ...(await original()), fetchOasSummary: vi.fn(), fetchOasTable: vi.fn() }));
vi.mock('../utils/analytics.js', () => ({ track: vi.fn() }));
vi.mock('../utils/quietPages.js', async (original) => ({ ...(await original()), reloadDocument: vi.fn() }));
import { fetchOasSummary, fetchOasTable } from '../api/oas.js';
import { track } from '../utils/analytics.js';
import { reloadDocument } from '../utils/quietPages.js';

// A table's bands: $24 wide from 0, a dollar less per band; table 4 has the partner's
// Allowance and table 5 no OAS pension columns.
const bands = (table, top = 113890) => Array.from({ length: 120 }, (_, position) => {
  const amount = top - position * 100;
  return [position * 2400, (position + 1) * 2400 - 1, amount, table === 4 ? amount + 500 : null,
    table === 5 ? null : amount + 76250, table === 5 ? null : amount + 83875];
});
const figures = (table, rows) => ({ table, resource_id: 'res-' + table, row_count: rows.length, max_amount_cents: rows[0][2],
  max_allowance_cents: rows[0][3], ends_at_cents: rows[rows.length - 1][1] + 1 });
const COLUMNS = ['income_from_cents', 'income_to_cents', 'amount_cents', 'allowance_cents', 'with_oas_65_cents', 'with_oas_75_cents'];
const Q4 = { key: 202612, year: 2026, quarter: 4, start: '2026-10-01', end: '2026-12-31', income_year: 2025, loaded_at: '2026-11-11T04:49:54.000Z' };
const Q3 = { key: 202609, year: 2026, quarter: 3, start: '2026-07-01', end: '2026-09-30', income_year: 2025, loaded_at: '2026-07-02T10:00:00.000Z' };
const OAS = { age_65_cents: 76250, age_75_cents: 83875 };
const SUMMARY = {
  dataset_id: 'dfa4daf1-669e-4514-82cd-982f27707ed0', period: Q4, updated_at: Q4.loaded_at, oas: OAS, columns: COLUMNS,
  tables: [1, 2, 3, 4, 5].map((table) => {
    const rows = bands(table);
    return { ...figures(table, rows), condensed: [rows[0], rows[41], rows[83]] };
  }),
  previous: null, periods: [Q4]
};
const WITH_PREVIOUS = { ...SUMMARY, periods: [Q3, Q4],
  previous: { period: Q3, oas: { age_65_cents: 75100, age_75_cents: 82610 }, tables: [1, 2, 3, 4, 5].map((table) => figures(table, bands(table, 112317))) } };
const tableData = (table, period = Q4, top = 113890) => {
  const rows = bands(table, top);
  return { period, oas: OAS, table: figures(table, rows), columns: COLUMNS, rows };
};
const envelope = (data) => ({ data, pagination: { nextCursor: null }, meta: { source: 'canquery', license: 'Open Government Licence - Canada', upstream: null } });

// The block a direct visit carries in its HTML.
function embed(payload) {
  const element = document.createElement('script');
  element.type = 'application/json';
  element.id = 'cq-initial';
  element.textContent = JSON.stringify(payload);
  document.body.appendChild(element);
}
const hubBlock = (overrides = {}) => ({ version: 1, kind: 'oas', path: '/oas', lang: 'en', table: null, summary: envelope(SUMMARY), rows: null, ...overrides });

function Location() {
  const location = useLocation();
  return <pre data-testid="location">{location.pathname + location.search + location.hash + ' ' + JSON.stringify(location.state)}</pre>;
}
const pause = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

function renderAt(entry) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/oas" element={<OasPage language="en" table={null} />} />
          <Route path="/oas/table-1" element={<OasPage language="en" table={1} />} />
          <Route path="/oas/table-2" element={<OasPage language="en" table={2} />} />
          <Route path="/fr/sv" element={<OasPage language="fr" table={null} />} />
          <Route path="/fr/sv/tableau-2" element={<OasPage language="fr" table={2} />} />
          <Route path="*" element={<p>another page</p>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </LangProvider>
  );
}
const income = () => screen.getByRole('textbox');
const answer = () => screen.getByRole('status');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  localStorage.clear();
  delete window.__cqHeatmaps;
  resetOasData();
  document.getElementById('cq-initial')?.remove();
  fetchOasSummary.mockResolvedValue(envelope(SUMMARY));
  fetchOasTable.mockImplementation(async (table, period) => envelope(tableData(table, period === Q3.key ? Q3 : Q4, period === Q3.key ? 112317 : 113890)));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the OAS amounts hub', () => {
  test('a direct visit draws from the block in its HTML, with no request and no loading state', () => {
    embed(hubBlock());
    renderAt('/oas');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Guaranteed Income Supplement, Allowance and OAS pension amounts, October to December 2026');
    expect(fetchOasSummary).not.toHaveBeenCalled();
    expect(fetchOasTable).not.toHaveBeenCalled();
    expect(document.getElementById('cq-initial')).toBeNull();
    expect(screen.getByText(/they are based on income for 2025\./)).toBeInTheDocument();
    expect(screen.getByText(/CanQuery is not a government website\./)).toBeInTheDocument();
    expect(screen.getByText('Full OAS pension, age 65 to 74 · $762.50 a month')).toBeInTheDocument();
    expect(screen.queryByText(/apply from/)).not.toBeInTheDocument();
  });

  test('a block for another address, language or shape is not used', async () => {
    for (const block of [hubBlock({ path: '/oas?x=1' }), hubBlock({ lang: 'fr' }), hubBlock({ table: 2 }), hubBlock({ kind: 'guide' }),
      hubBlock({ version: 2 }), hubBlock({ summary: envelope({ ...SUMMARY, tables: SUMMARY.tables.slice(1) }) })]) {
      resetOasData();
      vi.clearAllMocks();
      fetchOasSummary.mockResolvedValue(envelope(SUMMARY));
      document.getElementById('cq-initial')?.remove();
      embed(block);
      const view = renderAt('/oas');
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
      await screen.findByRole('heading', { level: 1 });
      expect(fetchOasSummary).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  test('reached from another page, it loads the summary once and shows every table in short', async () => {
    renderAt('/oas');
    expect(screen.getByText('Loading the benefit amounts…')).toBeInTheDocument();
    await screen.findByRole('heading', { level: 1 });
    expect(fetchOasSummary).toHaveBeenCalledTimes(1);
    const key = screen.getByRole('heading', { name: 'Maximum monthly amounts, October to December 2026' }).closest('section');
    const first = within(key).getByRole('link', { name: 'Table 1: GIS for a single person who receives an OAS pension' });
    expect(first).toHaveAttribute('href', '/oas/table-1');
    // Table 4's two amounts, each on its line; every figure carries its column's name for the phone layout.
    const couple = within(key).getByRole('link', { name: 'Table 4: GIS and Allowance for a couple' }).closest('tr');
    expect(within(couple).getByText('GIS $1,138.90 a month')).toBeInTheDocument();
    expect(within(couple).getByText('Allowance $1,143.90 a month')).toBeInTheDocument();
    expect([...couple.querySelectorAll('td')].map((cell) => cell.dataset.label)).toEqual(['Maximum monthly amount', 'Listed for yearly incomes below']);
    expect(within(key).getAllByText('$1,138.90 a month')).toHaveLength(4);
    expect(within(key).getAllByText('$2,880')).toHaveLength(5);
    for (const table of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('link', { name: `All 120 income bands of Table ${table}` })).toHaveAttribute('href', '/oas/table-' + table);
    }
    const survivor = document.getElementById('table-5');
    expect(within(survivor).getByRole('columnheader', { name: 'Monthly Allowance for the Survivor' })).toBeInTheDocument();
    expect(within(survivor).queryByRole('columnheader', { name: /OAS pension and GIS/ })).not.toBeInTheDocument();
    expect(within(survivor).getByRole('rowheader', { name: '$984.00 to $1,007.99' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Old Age Security payment amounts (Canada.ca)' })).toHaveAttribute('href',
      'https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html');
    expect(screen.getByRole('link', { name: 'Table 3 as a CSV table' })).toHaveAttribute('href', '/resources/res-3');
    expect(screen.getByRole('link', { name: 'Lire en français' })).toHaveAttribute('href', '/fr/sv');
    expect(screen.getByRole('link', { name: 'How to read the tables' })).toHaveAttribute('href', '/blog/guaranteed-income-supplement-amounts');
    expect(screen.queryByText(/Change from/)).not.toBeInTheDocument();
  });

  test('typing an income asks for the table once, never sends the income, and shows the official amounts', async () => {
    embed(hubBlock());
    renderAt('/oas');
    expect(answer()).toHaveTextContent('Type a yearly income to see the monthly amount.');
    fireEvent.change(income(), { target: { value: '2,500' } });
    await waitFor(() => expect(answer()).toHaveTextContent('For a yearly income of $2,500.00'));
    expect(fetchOasTable).toHaveBeenCalledTimes(1);
    expect(fetchOasTable).toHaveBeenCalledWith(1, 202612);
    expect(answer()).toHaveTextContent('Income band $2,496.00 to $2,519.99 · Table 1 · October to December 2026');
    expect(answer()).toHaveTextContent('Monthly GIS$1,034.90 a month');
    expect(answer()).toHaveTextContent('OAS pension and GIS, age 65 to 74$1,797.40 a month');
    expect(answer()).toHaveTextContent('OAS pension and GIS, age 75 and over$1,873.65 a month');
    // The income stays with this history entry: the address does not change.
    await pause(450);
    expect(screen.getByTestId('location')).toHaveTextContent('/oas {"oas":{"income":"2,500","table":1}}');
    fireEvent.change(income(), { target: { value: '2,600.75' } });
    await waitFor(() => expect(answer()).toHaveTextContent('For a yearly income of $2,600.75'));
    expect(fetchOasTable).toHaveBeenCalledTimes(1);
    await pause(1000);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('oas_lookup', { table: 1, language: 'en', placement: 'hub', outcome: 'answer' });
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/2,?[56]00/);
  });

  test('the box is saved at once when it is left, so a link used straight after typing does not lose it', async () => {
    embed(hubBlock());
    renderAt('/oas');
    fireEvent.change(income(), { target: { value: '2,500' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/oas null');
    fireEvent.blur(income());
    expect(screen.getByTestId('location')).toHaveTextContent('/oas {"oas":{"income":"2,500","table":1}}');
    // Nothing more to save afterwards.
    await pause(400);
    expect(screen.getByTestId('location')).toHaveTextContent('/oas {"oas":{"income":"2,500","table":1}}');
  });

  test('a separator typed last is the amount so far; pasted text that is not one amount is refused', async () => {
    embed(hubBlock());
    renderAt('/oas');
    for (const [typed, read] of [['2,', '$2.00'], ['2,5', '$2.50'], ['2,500', '$2,500.00'], ['2,500.', '$2,500.00'], ['  2 500,5 $', '$2,500.50']]) {
      fireEvent.change(income(), { target: { value: typed } });
      await waitFor(() => expect(answer()).toHaveTextContent('For a yearly income of ' + read));
      expect(income()).toHaveAttribute('aria-invalid', 'false');
    }
    // Leading spaces are not kept in the box.
    expect(income()).toHaveValue('2 500,5 $');
    for (const pasted of ['2500\t212', '2500 212', '2 5000']) {
      fireEvent.change(income(), { target: { value: pasted } });
      expect(income()).toHaveAttribute('aria-invalid', 'true');
      expect(answer()).not.toHaveTextContent('a month');
    }
    expect(income()).toHaveAttribute('spellcheck', 'false');
    expect(income()).toHaveAttribute('autocomplete', 'off');
  });

  test('the space for the longest answer is kept out of sight, outside what is read aloud', () => {
    embed(hubBlock());
    renderAt('/oas');
    const reserve = document.querySelector('[data-oas-reserve]');
    expect(reserve).toHaveAttribute('aria-hidden', 'true');
    expect(reserve).toHaveClass('invisible');
    expect(reserve).toHaveTextContent('Monthly GIS$1,138.90 a month');
    expect(reserve.querySelector('a, button')).toBeNull();
    expect(answer()).not.toContainElement(reserve);
    expect(reserve.parentElement).toContainElement(answer());
    // The line for a wrong amount keeps its place too.
    expect(screen.getByText('Enter an amount in dollars, such as 18,000 or 18000.50.')).toHaveClass('invisible');
  });

  test('each situation reads its own table and shows its own amounts', async () => {
    embed(hubBlock());
    renderAt('/oas');
    fireEvent.change(income(), { target: { value: '1000' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly GIS$1,097.90 a month'));
    fireEvent.click(screen.getByRole('radio', { name: /partner receives the Allowance/ }));
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly Allowance$1,102.90 a month'));
    expect(answer()).toHaveTextContent('· Table 4 ·');
    expect(screen.getByText('Combined yearly income of the couple (excluding OAS pension, GIS and Allowance), for 2025.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Surviving spouse or common-law partner, age 60 to 64/ }));
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly Allowance for the Survivor$1,097.90 a month'));
    expect(answer()).not.toHaveTextContent('OAS pension and GIS');
    expect(fetchOasTable.mock.calls.map(([table]) => table)).toEqual([1, 4, 5]);
    // Back on a situation already read: nothing is asked for again.
    fireEvent.click(screen.getByRole('radio', { name: /Single, widowed or divorced, receiving the OAS pension/ }));
    await waitFor(() => expect(answer()).toHaveTextContent('· Table 1 ·'));
    expect(fetchOasTable).toHaveBeenCalledTimes(3);
  });

  test('an income past the table, an amount that is not one, and the table’s edges', async () => {
    embed(hubBlock());
    renderAt('/oas');
    fireEvent.change(income(), { target: { value: '5000' } });
    await waitFor(() => expect(answer()).toHaveTextContent(
      'The table lists no amount for a yearly income of $5,000.00: it lists yearly incomes below $2,880.'));
    await pause(900);
    fireEvent.change(income(), { target: { value: '2879.99' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Income band $2,856.00 to $2,879.99'));
    fireEvent.change(income(), { target: { value: '2880' } });
    await waitFor(() => expect(answer()).toHaveTextContent('lists no amount'));
    fireEvent.change(income(), { target: { value: '0' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly GIS$1,138.90 a month'));
    await pause(900);
    fireEvent.change(income(), { target: { value: '18.000' } });
    await waitFor(() => expect(screen.getByText('Enter an amount in dollars, such as 18,000 or 18000.50.')).not.toHaveClass('invisible'));
    expect(income()).toHaveAttribute('aria-invalid', 'true');
    expect(answer()).not.toHaveTextContent('a month');
    await pause(900);
    fireEvent.change(income(), { target: { value: '' } });
    expect(income()).toHaveAttribute('aria-invalid', 'false');
    expect(answer()).toHaveTextContent('Type a yearly income');
    // Each outcome is counted once, after a pause, never with what was typed, and without saying
    // whether the table lists the income.
    expect(track.mock.calls.map(([, properties]) => properties.outcome)).toEqual(['answer', 'invalid']);
    expect(track.mock.calls.every(([name, properties]) => name === 'oas_lookup' && Object.keys(properties).sort().join() === 'language,outcome,placement,table')).toBe(true);
  });

  test('a table that cannot be read says so and can be asked for again', async () => {
    embed(hubBlock());
    fetchOasTable.mockRejectedValueOnce(new ApiError('Too many requests', 429));
    renderAt('/oas');
    fireEvent.change(income(), { target: { value: '500' } });
    expect(await screen.findByText('The table could not be loaded.')).toBeInTheDocument();
    fireEvent.click(within(answer()).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly GIS$1,118.90 a month'));
    expect(fetchOasTable).toHaveBeenCalledTimes(2);
  });

  test('what was typed and chosen comes back with the history entry, and goes along to the table’s page', async () => {
    embed(hubBlock());
    renderAt({ pathname: '/oas', state: { oas: { income: '1,200', table: 3 } } });
    expect(income()).toHaveValue('1,200');
    expect(screen.getByRole('radio', { name: /receives neither the OAS pension nor the Allowance/ })).toBeChecked();
    await waitFor(() => expect(answer()).toHaveTextContent('· Table 3 ·'));
    expect(fetchOasTable).toHaveBeenCalledWith(3, 202612);
    fireEvent.click(within(answer()).getByRole('link', { name: 'Open the whole table' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/oas/table-3 {"oas":{"income":"1,200","table":3}}'));
    expect(screen.getByText('another page')).toBeInTheDocument();
  });

  test('an income that came back with the history entry is not counted as a new lookup', async () => {
    embed(hubBlock());
    renderAt({ pathname: '/oas', state: { oas: { income: '1,200', table: 1 } } });
    await waitFor(() => expect(answer()).toHaveTextContent('For a yearly income of $1,200.00'));
    await pause(1000);
    expect(track).not.toHaveBeenCalled();
    fireEvent.change(income(), { target: { value: '1,300' } });
    await pause(1000);
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('a quarter that has not started says from when it applies and answers for the quarter in effect too', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    fetchOasSummary.mockResolvedValue(envelope(WITH_PREVIOUS));
    renderAt('/oas');
    expect(await screen.findByText('These amounts apply from October 1, 2026.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change from July to September 2026' })).toBeInTheDocument();
    const change = screen.getByRole('heading', { name: 'Change from July to September 2026' }).closest('section');
    expect(within(change).getByRole('row', { name: 'Table 1, maximum GIS $1,123.17 $1,138.90 +1.4%' })).toBeInTheDocument();
    expect(within(change).getByRole('row', { name: 'Full OAS pension, age 75 and over $826.10 $838.75 +1.5%' })).toBeInTheDocument();
    fireEvent.change(income(), { target: { value: '0' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Until then (July to September 2026)'));
    expect(answer()).toHaveTextContent('From October 1, 2026');
    expect(answer()).toHaveTextContent('Monthly GIS$1,138.90 a month');
    expect(answer()).toHaveTextContent('Monthly GIS$1,123.17 a month');
    expect(fetchOasTable.mock.calls).toEqual(expect.arrayContaining([[1, 202612], [1, 202609]]));
    // Both quarters read the same income year here, so the heading names none.
    expect(answer()).not.toHaveTextContent('if your income for');
  });

  test('the amount until then names its income year when that is another one', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    const earlier = { ...Q3, income_year: 2024 };
    fetchOasSummary.mockResolvedValue(envelope({ ...WITH_PREVIOUS, periods: [earlier, Q4], previous: { ...WITH_PREVIOUS.previous, period: earlier } }));
    renderAt('/oas');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.change(income(), { target: { value: '0' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Until then (July to September 2026), if your income for 2024 was the same'));
  });

  test('the amount until then says so when it cannot be read or when that table does not list the income', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    // The table in effect ends at $1,440; the coming one at $2,880.
    const shorter = WITH_PREVIOUS.previous.tables.map((entry) => ({ ...entry, row_count: 60, ends_at_cents: 144000 }));
    fetchOasSummary.mockResolvedValue(envelope({ ...WITH_PREVIOUS, previous: { ...WITH_PREVIOUS.previous, tables: shorter } }));
    fetchOasTable.mockImplementation(async (table, period) => {
      if (period !== Q3.key) return envelope(tableData(table));
      const data = tableData(table, Q3, 112317);
      return envelope({ ...data, table: shorter[table - 1], rows: data.rows.slice(0, 60) });
    });
    fetchOasTable.mockImplementationOnce(async (table) => envelope(tableData(table)));
    fetchOasTable.mockRejectedValueOnce(new ApiError('Too many requests', 429));
    renderAt('/oas');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.change(income(), { target: { value: '2000' } });
    await waitFor(() => expect(answer()).toHaveTextContent('The amount in effect until then could not be loaded.'));
    expect(answer()).toHaveTextContent('From October 1, 2026');
    expect(answer()).toHaveTextContent('Monthly GIS$1,055.90 a month');
    fireEvent.click(within(answer()).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(answer()).toHaveTextContent(
      'The table in effect until then lists no amount for this income: it lists yearly incomes below $1,440.'));
    // And the other way round: listed until then, not from the coming quarter on.
    fireEvent.change(income(), { target: { value: '1000' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly GIS$1,082.17 a month'));
    expect(answer()).toHaveTextContent('Monthly GIS$1,097.90 a month');
  });

  test('a quarter that has not started stands alone when the loaded quarter before it is not the one running', async () => {
    // October to December is the newest loaded and has not started; the one before it loaded is January to March.
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    const old = { ...Q3, key: 202603, quarter: 1, start: '2026-01-01', end: '2026-03-31' };
    fetchOasSummary.mockResolvedValue(envelope({ ...WITH_PREVIOUS, periods: [old, Q4], previous: { ...WITH_PREVIOUS.previous, period: old } }));
    renderAt('/oas');
    expect(await screen.findByText('These amounts apply from October 1, 2026.')).toBeInTheDocument();
    fireEvent.change(income(), { target: { value: '0' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly GIS$1,138.90 a month'));
    expect(answer()).not.toHaveTextContent('Until then');
    expect(fetchOasTable).toHaveBeenCalledTimes(1);
    // The change table still names the quarter it compares with.
    expect(screen.getByRole('heading', { name: 'Change from January to March 2026' })).toBeInTheDocument();
  });

  test('a quarter that has ended says newer amounts may exist; with two quarters loaded and the newest in effect, one answer', async () => {
    vi.setSystemTime(new Date(2027, 0, 3, 12));
    fetchOasSummary.mockResolvedValue(envelope(WITH_PREVIOUS));
    renderAt('/oas');
    expect(await screen.findByText(/^These are the amounts for October to December 2026\. Newer amounts may have been published since;/)).toBeInTheDocument();
    fireEvent.change(income(), { target: { value: '0' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Monthly GIS$1,138.90 a month'));
    expect(answer()).not.toHaveTextContent('Until then');
    expect(fetchOasTable).toHaveBeenCalledTimes(1);
  });

  test('before a quarter is loaded the page says so; a failure can be retried', async () => {
    fetchOasSummary.mockRejectedValueOnce(new ApiError('not loaded', 503));
    const first = renderAt('/oas');
    expect(await screen.findByText(/The tables of OAS benefit amounts are being loaded\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Old Age Security (OAS): Table of Benefit Amounts, every file' }))
      .toHaveAttribute('href', '/datasets/dfa4daf1-669e-4514-82cd-982f27707ed0');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    first.unmount();
    fetchOasSummary.mockRejectedValueOnce(new Error('network'));
    renderAt('/oas');
    expect(await screen.findByText('The benefit amounts could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('October to December 2026');
  });
});

describe('a table’s page', () => {
  const tableBlock = (overrides = {}) => ({ version: 1, kind: 'oas', path: '/oas/table-2', lang: 'en', table: 2,
    summary: envelope(SUMMARY), rows: envelope(tableData(2)), ...overrides });

  test('a direct visit draws every band from the block, in sections of a round span of income, with no request', () => {
    embed(tableBlock());
    renderAt('/oas/table-2');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Table 2: GIS for the spouse or common-law partner of someone who receives an OAS pension, October to December 2026');
    expect(fetchOasSummary).not.toHaveBeenCalled();
    expect(fetchOasTable).not.toHaveBeenCalled();
    expect(document.querySelectorAll('tr[data-line]')).toHaveLength(120);
    // The table ends at $2,880: sections of $1,000, each opened by the band that holds its round income.
    expect([...document.querySelectorAll('section[id^="income-"]')].map((section) => section.id)).toEqual(['income-0', 'income-1000', 'income-2000']);
    expect(document.getElementById('income-0')).toContainElement(screen.getByRole('heading', { name: 'Yearly income $0.00 to $983.99' }));
    expect(document.getElementById('income-1000').querySelector('tr[data-line]')).toHaveAttribute('data-line', '42');
    const jump = screen.getByRole('navigation', { name: 'Income ranges' });
    expect(within(jump).getAllByRole('link')).toHaveLength(3);
    expect(within(jump).getByRole('link', { name: '$984.00 to $1,991.99' })).toHaveAttribute('href', '#income-1000');
    expect(screen.getByText(/combined yearly income of the couple \(excluding OAS pension and GIS\), for 2025/)).toBeInTheDocument();
    expect(screen.getByText('Maximum monthly GIS · $1,138.90 a month')).toBeInTheDocument();
    expect(screen.getByText('120 income bands')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Table 5: Allowance for the Survivor' })).toHaveAttribute('href', '/oas/table-5');
    expect(screen.getByRole('link', { name: 'OAS and GIS amounts by income' })).toHaveAttribute('href', '/oas');
    expect(screen.getByRole('link', { name: 'Lire en français' })).toHaveAttribute('href', '/fr/sv/tableau-2');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  test('the link to the other language names the same part of the page', () => {
    embed(tableBlock({ path: '/oas/table-2' }));
    renderAt('/oas/table-2#income-1000');
    expect(screen.getByRole('link', { name: 'Lire en français' })).toHaveAttribute('href', '/fr/sv/tableau-2#income-1000');
  });

  test('a block whose table is of another quarter than its summary is not used', async () => {
    embed(tableBlock({ rows: envelope(tableData(2, Q3)) }));
    renderAt('/oas/table-2');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    await screen.findByRole('heading', { level: 1 });
    expect(fetchOasTable).toHaveBeenCalledWith(2, 202612);
  });

  test('reached from another page, it loads the summary, then the table of that quarter', async () => {
    renderAt('/oas/table-2');
    await screen.findByRole('heading', { level: 1 });
    expect(fetchOasSummary).toHaveBeenCalledTimes(1);
    expect(fetchOasTable).toHaveBeenCalledTimes(1);
    expect(fetchOasTable).toHaveBeenCalledWith(2, 202612);
    expect(document.querySelectorAll('tr[data-line]')).toHaveLength(120);
  });

  test('the lookup finds the row in the table that is already drawn', async () => {
    embed(tableBlock());
    renderAt('/oas/table-2');
    fireEvent.change(income(), { target: { value: '100' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Income band $96.00 to $119.99'));
    expect(fetchOasTable).not.toHaveBeenCalled();
    // The row is marked as soon as the lookup answers, and names its figures.
    const found = document.querySelector('tr.cq-oas-found');
    expect(found).toHaveAttribute('data-line', '5');
    expect(within(found).getByRole('rowheader')).toHaveTextContent('$96.00 to $119.99');
    expect([...found.children].map((cell) => cell.getAttribute('data-label'))).toEqual(
      [null, 'Monthly GIS', 'OAS pension and GIS, age 65 to 74', 'OAS pension and GIS, age 75 and over']);
    expect(found).not.toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Show this row in the table' }));
    expect(found).toHaveFocus();
    // Another income moves the mark; the old row loses it and its labels.
    fireEvent.change(income(), { target: { value: '2000' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Income band $1,992.00 to $2,015.99'));
    expect(document.querySelectorAll('tr.cq-oas-found')).toHaveLength(1);
    expect(document.querySelector('tr.cq-oas-found')).toHaveAttribute('data-line', '84');
    expect(found.querySelector('[data-label]')).toBeNull();
    // An income the table does not list, an amount that is not one, and an empty box leave no row marked.
    for (const typed of ['5000', '18.000', '']) {
      fireEvent.change(income(), { target: { value: '2000' } });
      await waitFor(() => expect(document.querySelectorAll('tr.cq-oas-found')).toHaveLength(1));
      fireEvent.change(income(), { target: { value: typed } });
      await waitFor(() => expect(document.querySelectorAll('tr.cq-oas-found')).toHaveLength(0));
      expect(screen.queryByRole('button', { name: 'Show this row in the table' })).not.toBeInTheDocument();
    }
    fireEvent.change(income(), { target: { value: '2000' } });
    await pause(1000);
    expect(track).toHaveBeenCalledWith('oas_lookup', { table: 2, language: 'en', placement: 'table', outcome: 'answer' });
  });

  test('the row is marked again when the page comes back with its income', async () => {
    embed(tableBlock());
    renderAt({ pathname: '/oas/table-2', state: { oas: { income: '2000', table: 2 } } });
    await waitFor(() => expect(document.querySelector('tr.cq-oas-found')).toHaveAttribute('data-line', '84'));
    expect(income()).toHaveValue('2000');
  });

  test('a quarter that has not started: the table page answers for the quarter in effect too', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    embed(tableBlock({ summary: envelope(WITH_PREVIOUS) }));
    renderAt('/oas/table-2');
    expect(screen.getByText('These amounts apply from October 1, 2026.')).toBeInTheDocument();
    fireEvent.change(income(), { target: { value: '0' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Until then (July to September 2026)'));
    expect(answer()).toHaveTextContent('From October 1, 2026');
    expect(answer()).toHaveTextContent('Monthly GIS$1,138.90 a month');
    expect(answer()).toHaveTextContent('Monthly GIS$1,123.17 a month');
    // Only the quarter in effect had to be read; the table on the page is the coming quarter's.
    expect(fetchOasTable.mock.calls).toEqual([[2, 202609]]);
    expect(document.querySelector('tr.cq-oas-found')).toHaveAttribute('data-line', '1');
  });

  test('a page reached after the heatmap recorder was loaded starts again as its own document', async () => {
    window.__cqHeatmaps = true;
    renderAt('/oas/table-2');
    expect(reloadDocument).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Loading the benefit amounts…')).toBeInTheDocument();
    await pause(50);
    expect(fetchOasSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // Without the recorder nothing is reloaded.
    delete window.__cqHeatmaps;
    reloadDocument.mockClear();
    embed(tableBlock());
    renderAt('/oas/table-2').unmount();
    expect(reloadDocument).not.toHaveBeenCalled();
    // The ad loader of an earlier page does the same: no third party's script beside the lookup.
    const loader = document.createElement('script');
    loader.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456';
    loader.type = 'text/plain';
    document.head.appendChild(loader);
    try {
      renderAt('/oas');
      expect(reloadDocument).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    } finally {
      loader.remove();
    }
  });

  test('a summary that is no longer fresh still draws the page, and is read again behind it', async () => {
    embed(tableBlock());
    const first = renderAt('/oas/table-2');
    expect(document.querySelectorAll('tr[data-line]')).toHaveLength(120);
    first.unmount();
    // Six minutes later, on the hub: no loading state, one request behind the page.
    vi.setSystemTime(new Date(2026, 10, 11, 12, 6));
    const reloaded = { ...SUMMARY, updated_at: '2026-11-11T17:05:00.000Z' };
    fetchOasSummary.mockResolvedValue(envelope(reloaded));
    const hub = renderAt('/oas');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Loading the benefit amounts…')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchOasSummary).toHaveBeenCalledTimes(1));
    hub.unmount();
    // The amounts were loaded again since: the table read before is asked for again.
    await pause(20);
    renderAt('/oas/table-2');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(fetchOasTable).toHaveBeenCalledWith(2, 202612);
  });

  test('a summary that cannot be read again leaves the page as it is', async () => {
    embed(hubBlock());
    renderAt('/oas').unmount();
    vi.setSystemTime(new Date(2026, 10, 11, 12, 6));
    fetchOasSummary.mockRejectedValue(new Error('offline'));
    renderAt('/oas');
    await waitFor(() => expect(fetchOasSummary).toHaveBeenCalledTimes(1));
    await pause(20);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('October to December 2026');
    expect(screen.queryByText('The benefit amounts could not be loaded.')).not.toBeInTheDocument();
  });
});

describe('a visit that arrives at a band of the table', () => {
  const tableBlock = () => ({ version: 1, kind: 'oas', path: '/oas/table-2', lang: 'en', table: 2, summary: envelope(SUMMARY), rows: envelope(tableData(2)) });
  let snapshot;
  let scrollBy;
  // The server's HTML, scrolled by the browser: its 73rd band is the last one at or above
  // the middle of the window (384), at 380. The application's own rows are 30 px apart,
  // with that band at 1000.
  function arrive({ scrollY = 2800 } = {}) {
    snapshot = document.createElement('div');
    snapshot.className = 'cq-seo-snapshot';
    snapshot.innerHTML = '<table data-cq-amounts="true"><tbody>' + '<tr><th>band</th></tr>'.repeat(120) + '</tbody></table>';
    document.body.appendChild(snapshot);
    const served = [...snapshot.querySelectorAll('tr')];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      const index = served.indexOf(this);
      // A rectangle read from the application's rows would be 12 px off while the page fades in.
      const top = index >= 0 ? 380 + (index - 72) * 40 : this.dataset.line ? 1012 + (Number(this.dataset.line) - 73) * 30 : 0;
      return { top, bottom: top + 30, left: 0, right: 0, width: 0, height: 30, x: 0, y: top, toJSON: () => ({}) };
    });
    // Their layout offsets say where they are: 1000 px down the window for the 73rd band.
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function offset() {
      return this.dataset.line ? scrollY + 1000 + (Number(this.dataset.line) - 73) * 30 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(null);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollY);
    scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  }
  afterEach(() => {
    snapshot?.remove();
    vi.restoreAllMocks();
  });

  test('draws its table with that band at the same height', () => {
    arrive();
    embed(tableBlock());
    renderAt('/oas/table-2');
    expect(document.querySelectorAll('tr[data-line]')).toHaveLength(120);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, 620);
  });

  test('also when the table has to be loaded first', async () => {
    arrive();
    renderAt('/oas/table-2');
    expect(scrollBy).not.toHaveBeenCalled();
    await screen.findByRole('heading', { level: 1 });
    expect(scrollBy).toHaveBeenCalledWith(0, 620);
  });

  test('leaves the window alone at the top of the page, for an address that names a range, and after a reload', () => {
    arrive({ scrollY: 0 });
    embed(tableBlock());
    renderAt('/oas/table-2').unmount();
    expect(scrollBy).not.toHaveBeenCalled();

    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(2800);
    resetOasData();
    embed({ ...tableBlock(), path: '/oas/table-2#income-240' });
    renderAt('/oas/table-2#income-240').unmount();
    expect(scrollBy).not.toHaveBeenCalled();

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' }]);
    resetOasData();
    embed(tableBlock());
    renderAt('/oas/table-2');
    expect(document.querySelectorAll('tr[data-line]')).toHaveLength(120);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test('the hub keeps the window where the browser left it', () => {
    arrive();
    embed(hubBlock());
    renderAt('/oas');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('the French pages', () => {
  test('speak French from the first render, whatever the interface was, and set it for the rest of the site', async () => {
    localStorage.setItem('cq-lang', 'en');
    embed(hubBlock({ path: '/fr/sv', lang: 'fr' }));
    renderAt('/fr/sv');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Montants du Supplément de revenu garanti, de l’Allocation et de la pension de la Sécurité de la vieillesse, octobre à décembre 2026');
    expect(screen.getByRole('heading', { name: 'Trouver un montant' })).toBeInTheDocument();
    // Queries read no-break spaces as spaces; the page itself prints them.
    const pension = screen.getByText('Pleine pension de la SV, 65 à 74 ans · 762,50 $ par mois');
    expect(pension.textContent).toContain('762,50' + NBSP + '$ par mois');
    expect(screen.getByRole('link', { name: 'Read in English' })).toHaveAttribute('href', '/oas');
    expect(screen.getByRole('link', { name: 'Comment lire les tableaux' })).toHaveAttribute('href', '/fr/blog/supplement-revenu-garanti-tableau-montants');
    expect(screen.getByRole('link', { name: 'Montant des paiements de la Sécurité de la vieillesse (Canada.ca)' })).toHaveAttribute('href',
      'https://www.canada.ca/fr/services/prestations/pensionspubliques/securite-vieillesse/paiements.html');
    await waitFor(() => expect(document.documentElement.lang).toBe('fr'));
    expect(localStorage.getItem('cq-lang')).toBe('fr');
    fireEvent.change(income(), { target: { value: '2 500,50' } });
    await waitFor(() => expect(answer()).toHaveTextContent('Pour un revenu annuel de 2 500,50 $'));
    expect(answer()).toHaveTextContent('SRG mensuel1 034,90 $ par mois');
    expect(answer()).toHaveTextContent('Tranche de revenu : 2 496,00 $ à 2 519,99 $ · Tableau 1 · octobre à décembre 2026');
  });

  test('a French table page links its French neighbours', async () => {
    renderAt('/fr/sv/tableau-2');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Tableau 2 : SRG pour l’époux ou le conjoint de fait d’une personne qui reçoit la pension de la SV, octobre à décembre 2026');
    expect(screen.getByRole('link', { name: 'Tableau 5 : Allocation au survivant' })).toHaveAttribute('href', '/fr/sv/tableau-5');
    expect(screen.getByRole('link', { name: 'Montants de la SV et du SRG selon le revenu' })).toHaveAttribute('href', '/fr/sv');
    expect(screen.getByRole('link', { name: 'Read in English' })).toHaveAttribute('href', '/oas/table-2');
    expect(screen.getByRole('heading', { name: 'Revenu annuel de 0,00' + NBSP + '$ à 983,99' + NBSP + '$' })).toBeInTheDocument();
  });
});
