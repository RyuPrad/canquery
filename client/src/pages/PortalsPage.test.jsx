import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import PortalsPage from './PortalsPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { ApiError } from '../api/client.js';
import { resetPortalData } from '../utils/portalData.js';
import { DIRECTORY, envelope } from '../test/portalDirectory.js';

vi.mock('../api/portals.js', async (original) => ({ ...(await original()), fetchPortalDirectory: vi.fn() }));
import { fetchPortalDirectory } from '../api/portals.js';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
function Back() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Browser back</button>;
}

function renderAt(path, entries = [path]) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/portals" element={<PortalsPage />} />
          <Route path="*" element={<p>another page</p>} />
        </Routes>
        <Location />
        <Back />
      </MemoryRouter>
    </LangProvider>
  );
}
function embed(path = '/portals', directory = envelope()) {
  const element = document.createElement('script');
  element.type = 'application/json';
  element.id = 'cq-initial';
  element.textContent = JSON.stringify({ version: 1, kind: 'portals', path, directory });
  document.body.append(element);
}
// The portals in the table, top to bottom, by their English or French name.
const names = () => within(screen.getByRole('table')).getAllByRole('rowheader').map((cell) => cell.textContent);
const address = () => screen.getByTestId('location').textContent;
const failure = (status) => new ApiError('failed', status);
// The line that says how many portals the table shows (the test's own address readout is a status too).
const shown = () => screen.getAllByRole('status').find((node) => node.tagName === 'P');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetPortalData();
  fetchPortalDirectory.mockResolvedValue(envelope());
});
afterEach(() => {
  document.getElementById('cq-initial')?.remove();
});

describe('the portal directory page', () => {
  test('a direct visit draws from the page’s own data, with no request and no loading state', () => {
    embed();
    renderAt('/portals');
    expect(screen.getByRole('heading', { level: 1, name: 'Canadian open data portals' })).toBeInTheDocument();
    expect(names()).toHaveLength(6);
    expect(fetchPortalDirectory).not.toHaveBeenCalled();
    // The block is used once: a later visit to the page reads what the visit kept.
    expect(document.getElementById('cq-initial')).toBeNull();
  });

  test('without it the page loads the directory once', async () => {
    renderAt('/portals');
    expect(screen.getByText('Loading the portals…')).toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(fetchPortalDirectory).toHaveBeenCalledTimes(1);
    expect(names()[0]).toBe('Government of Canada Open Data');
  });

  test('says what is mirrored and how the portals divide', async () => {
    embed();
    renderAt('/portals');
    expect(screen.getByText(/^CanQuery mirrors 6 Canadian open data portals: 1 federal, 1 provincial or territorial and 3 municipal or regional, 64,485 datasets in all\./)).toBeInTheDocument();
    for (const [label, value] of [['Portals', '6'], ['Datasets', '64,485'], ['Provinces and territories represented', '3'], ['Last read', 'Nov 15, 2026']]) {
      const tile = screen.getAllByText(label).map((node) => node.parentElement).find((node) => node.textContent === value + label);
      expect([label, Boolean(tile)]).toEqual([label, true]);
    }
    expect(shown()).toHaveTextContent('6 portals');
    const levels = screen.getByRole('heading', { name: 'Portals by level of government' }).parentElement;
    expect(within(levels).getByText('Municipal and regional').parentElement).toHaveTextContent('3 portals · 1,361 datasets');
    expect(within(levels).getByText('Federal').parentElement).toHaveTextContent('1 portal · 48,310 datasets');
    const platforms = screen.getByRole('heading', { name: 'Portals by platform' }).parentElement;
    expect(within(platforms).getByText('CKAN').parentElement).toHaveTextContent('4 portals · 49,603 datasets');
    expect(within(platforms).getByText('Other').parentElement).toHaveTextContent('1 portal · 12 datasets');
    const provinces = screen.getByRole('heading', { name: 'Portals by province or territory' }).parentElement;
    expect(within(provinces).getByText('Ontario').parentElement).toHaveTextContent('2 portals · 964 datasets');
    expect(screen.getByRole('heading', { name: 'What the numbers mean' })).toBeInTheDocument();
    expect(screen.getByText(/^Datasets is the number of records CanQuery holds from the portal\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How CanQuery reads its sources' })).toHaveAttribute('href', '/about#data-sources');
  });

  test('each row links the official site, the place, the portal’s datasets in the catalogue and its licence', () => {
    embed();
    renderAt('/portals');
    const row = (name) => screen.getByRole('rowheader', { name: new RegExp('^' + name) }).closest('tr');
    const toronto = row('City of Toronto Open Data');
    const site = within(toronto).getByRole('link', { name: 'City of Toronto Open Data' });
    expect(site).toHaveAttribute('href', 'https://open.toronto.ca/');
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(toronto).getByRole('link', { name: 'Toronto' })).toHaveAttribute('href', '/places/toronto-on');
    expect(toronto).toHaveTextContent('Toronto, Ontario');
    expect(toronto).toHaveTextContent('CKAN');
    expect(within(toronto).getByRole('link', { name: '556 datasets from City of Toronto Open Data in the catalogue' }))
      .toHaveAttribute('href', '/datasets?source=toronto-open-data');
    expect(within(toronto).getByRole('link', { name: '324 datasets from City of Toronto Open Data with a table' }))
      .toHaveAttribute('href', '/datasets?source=toronto-open-data&queryable=true');
    expect(within(toronto).getByRole('link', { name: '157 datasets from City of Toronto Open Data with a map' }))
      .toHaveAttribute('href', '/datasets?source=toronto-open-data&mappable=true');
    expect(within(toronto).getByRole('link', { name: 'Open Government Licence – Toronto' })).toHaveAttribute('href', 'https://open.toronto.ca/open-data-license/');
    expect(toronto).toHaveTextContent('Nov 15, 2026');

    // The federal portal is Canada's; a territory is its own province, named once.
    expect(row('Government of Canada Open Data')).toHaveTextContent('CanadaCKAN48,3102,104310');
    const territory = row('Northwest Territories Open Data');
    expect(within(territory).getAllByText('Northwest Territories')).toHaveLength(1);
    // Eight columns: the level of government has its own summary below, and a filter above.
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent.replace(/[↑↓]/g, '').trim()))
      .toEqual(['Portal', 'Place', 'Platform', 'Datasets', 'With a table', 'With a map', 'Licence', 'Last read']);
    // Nothing to list is not a link; no general licence says so; a licence without an address is plain text.
    expect(within(territory).queryByRole('link', { name: /with a table/ })).toBeNull();
    expect(territory).toHaveTextContent('Set on each dataset');
    const ottawa = row('City of Ottawa Open Data');
    expect(within(ottawa).queryByRole('link', { name: /Open Government Licence/ })).toBeNull();
    expect(ottawa).toHaveTextContent('Open Government Licence – City of Ottawa');
    expect(ottawa).toHaveTextContent('ArcGIS Hub');
    // A portal with no site, place, level or read: its name and what is mirrored.
    const redDeer = row('City of Red Deer Open Data');
    expect(within(redDeer).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/datasets?source=red-deer-hub', '/datasets?source=red-deer-hub&queryable=true']);
    expect(redDeer).toHaveTextContent('City of Red Deer Open DataOther1230Set on each dataset');
  });

  test('typing and the three lists narrow the table in place, and the address keeps them', async () => {
    embed();
    renderAt('/portals', ['/before', '/portals']);
    fireEvent.change(screen.getByPlaceholderText('Filter by portal or place'), { target: { value: 'ontario' } });
    expect(names()).toEqual(['City of Toronto Open Data', 'City of Ottawa Open Data']);
    expect(shown()).toHaveTextContent('2 of 6 portals');
    expect(address()).toBe('/portals?q=ontario');
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'ckan' } });
    expect(names()).toEqual(['City of Toronto Open Data']);
    expect(address()).toBe('/portals?q=ontario&platform=ckan');
    fireEvent.change(screen.getByLabelText('Level of government'), { target: { value: 'federal' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No portal matches these filters.')).toBeInTheDocument();
    expect(shown()).toHaveTextContent('0 of 6 portals');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(names()).toHaveLength(6);
    expect(address()).toBe('/portals');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Province or territory'), { target: { value: 'quebec' } });
    expect(names()).toEqual(['Montréal Open Data']);
    expect(address()).toBe('/portals?province=quebec');
    // Nothing was asked of the server, and the filters were written in place: Back leaves the page.
    expect(fetchPortalDirectory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByText('another page')).toBeInTheDocument();
  });

  test('the lists offer only what the directory holds', () => {
    embed();
    renderAt('/portals');
    const options = (label) => within(screen.getByLabelText(label)).getAllByRole('option').map((option) => option.textContent);
    expect(options('Level of government')).toEqual(['Any level of government', 'Federal', 'Provincial and territorial', 'Municipal and regional']);
    expect(options('Platform')).toEqual(['Any platform', 'CKAN', 'ArcGIS Hub', 'Other']);
    expect(options('Province or territory')).toEqual(['Any province or territory', 'Northwest Territories', 'Ontario', 'Quebec']);
  });

  test('a column heading sorts by it, a second press turns the order around, and the address keeps the choice', () => {
    embed();
    renderAt('/portals');
    const heading = (name) => screen.getByRole('columnheader', { name: new RegExp('^' + name) });
    expect(heading('Datasets')).toHaveAttribute('aria-sort', 'descending');
    expect(heading('Portal')).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(heading('Portal')).getByRole('button'));
    expect(names()).toEqual(['City of Ottawa Open Data', 'City of Red Deer Open Data', 'City of Toronto Open Data',
      'Government of Canada Open Data', 'Montréal Open Data', 'Northwest Territories Open Data']);
    expect(heading('Portal')).toHaveAttribute('aria-sort', 'ascending');
    expect(heading('Datasets')).toHaveAttribute('aria-sort', 'none');
    expect(address()).toBe('/portals?sort=name');
    fireEvent.click(within(heading('Portal')).getByRole('button'));
    expect(names()[0]).toBe('Northwest Territories Open Data');
    expect(heading('Portal')).toHaveAttribute('aria-sort', 'descending');
    expect(address()).toBe('/portals?sort=name&order=desc');
    fireEvent.click(within(heading('With a map')).getByRole('button'));
    expect(names().slice(0, 2)).toEqual(['City of Ottawa Open Data', 'Government of Canada Open Data']);
    expect(address()).toBe('/portals?sort=maps');
    fireEvent.click(within(heading('Last read')).getByRole('button'));
    expect(names()[0]).toBe('Government of Canada Open Data');
    expect(names()[5]).toBe('City of Red Deer Open Data');
    // Back to the directory's own order: nothing is written for it.
    fireEvent.click(within(heading('Datasets')).getByRole('button'));
    expect(address()).toBe('/portals');
    fireEvent.click(within(heading('Datasets')).getByRole('button'));
    expect(names()[0]).toBe('City of Red Deer Open Data');
    expect(address()).toBe('/portals?order=asc');
  });

  test('an address with filters and a sort opens on them, and ignores what it does not know', () => {
    embed('/portals?province=ontario&sort=name&order=desc&platform=&sort=name');
    renderAt('/portals?province=ontario&sort=name&order=desc&platform=&sort=name');
    expect(names()).toEqual(['City of Toronto Open Data', 'City of Ottawa Open Data']);
    expect(screen.getByLabelText('Province or territory')).toHaveValue('ontario');
    expect(fetchPortalDirectory).not.toHaveBeenCalled();
    document.getElementById('cq-initial')?.remove();
  });

  test('a sort the page does not have falls back to the directory’s order', async () => {
    renderAt('/portals?sort=licence&order=sideways&level=galactic');
    await screen.findByText('No portal matches these filters.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(names()[0]).toBe('Government of Canada Open Data');
  });

  test('speaks French: names, counts, days and every label', async () => {
    localStorage.setItem('cq-lang', 'fr');
    embed();
    renderAt('/portals');
    expect(screen.getByRole('heading', { level: 1, name: 'Portails de données ouvertes du Canada' })).toBeInTheDocument();
    expect(screen.getByText(/^CanQuery reproduit 6 portails canadiens de données ouvertes : 1 au palier fédéral, 1 au palier provincial ou territorial et 3 au palier municipal ou régional, soit 64\s485 jeux de données en tout\./)).toBeInTheDocument();
    expect(names().slice(0, 2)).toEqual(['Données ouvertes du gouvernement du Canada', 'Données ouvertes de la Ville de Toronto']);
    const toronto = screen.getByRole('rowheader', { name: /Ville de Toronto/ }).closest('tr');
    expect(toronto).toHaveTextContent('15 nov. 2026');
    expect(toronto).toHaveTextContent('Ontario');
    expect(within(toronto).getByRole('link', { name: /556 jeux de données de Données ouvertes de la Ville de Toronto dans le catalogue/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Northwest Territories Open Data/ }).closest('tr')).toHaveTextContent('Territoires du Nord-Ouest');
    expect(shown()).toHaveTextContent('6 portails');
    fireEvent.change(screen.getByLabelText('Province ou territoire'), { target: { value: 'quebec' } });
    expect(shown()).toHaveTextContent('1 sur 6 portails');
    expect(within(screen.getByLabelText('Province ou territoire')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Toutes les provinces et tous les territoires', 'Ontario', 'Québec', 'Territoires du Nord-Ouest']);
    expect(screen.getByRole('heading', { name: 'Ce que les chiffres signifient' })).toBeInTheDocument();
  });
});

describe('on a phone or a tablet', () => {
  const listeners = [];
  beforeEach(() => {
    // The page asks one question of the screen: is it narrow?
    window.matchMedia = vi.fn((query) => ({ matches: query === '(max-width: 1023px)', media: query,
      addEventListener: (_type, listener) => listeners.push(listener), removeEventListener: () => {} }));
  });
  afterEach(() => { delete window.matchMedia; listeners.length = 0; });
  const cards = () => within(screen.getByRole('list', { name: 'Every portal' })).getAllByRole('listitem');
  const titles = () => cards().map((card) => within(card).getByRole('heading', { level: 3 }).textContent);

  test('each portal is a card with its figures in view, and there is no table to scroll sideways', () => {
    embed();
    renderAt('/portals');
    expect(screen.queryByRole('table')).toBeNull();
    expect(titles()).toEqual(DIRECTORY.portals.map((portal) => portal.name.en));
    const toronto = cards()[1];
    expect(within(toronto).getByRole('link', { name: 'City of Toronto Open Data' })).toHaveAttribute('href', 'https://open.toronto.ca/');
    expect(within(toronto).getByRole('link', { name: 'Toronto' })).toHaveAttribute('href', '/places/toronto-on');
    expect(toronto).toHaveTextContent('Toronto, Ontario · CKAN');
    expect(toronto).toHaveTextContent('Datasets556With a table324With a map157');
    expect(within(toronto).getByRole('link', { name: '324 datasets from City of Toronto Open Data with a table' }))
      .toHaveAttribute('href', '/datasets?source=toronto-open-data&queryable=true');
    expect(toronto).toHaveTextContent('Licence: Open Government Licence – Toronto');
    expect(toronto).toHaveTextContent('Last read: Nov 15, 2026');
    // A portal with no place and no read: its platform alone, and no empty date line.
    const redDeer = cards()[5];
    expect(redDeer).toHaveTextContent('City of Red Deer Open DataOtherDatasets12With a table3With a map0Licence: Set on each dataset');
    expect(redDeer).not.toHaveTextContent('Last read');
    expect(cards()[0]).toHaveTextContent('Canada · CKAN');
  });

  test('a French card writes its labels the French way', () => {
    localStorage.setItem('cq-lang', 'fr');
    embed();
    renderAt('/portals');
    const toronto = within(screen.getByRole('list', { name: 'Tous les portails' })).getAllByRole('listitem')[1];
    expect(toronto).toHaveTextContent('Jeux de données556Avec un tableau324Avec une carte157');
    expect(toronto).toHaveTextContent('Licence : Open Government Licence – Toronto');
    expect(toronto).toHaveTextContent('Dernière lecture : 15 nov. 2026');
    expect(screen.getByLabelText('Trier par')).toHaveValue('datasets:desc');
  });

  test('the filters narrow the cards and a list picks the order, kept in the address like the table’s', () => {
    embed();
    renderAt('/portals');
    fireEvent.change(screen.getByPlaceholderText('Filter by portal or place'), { target: { value: 'ontario' } });
    expect(titles()).toEqual(['City of Toronto Open Data', 'City of Ottawa Open Data']);
    expect(shown()).toHaveTextContent('2 of 6 portals');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    const order = screen.getByLabelText('Sort by');
    expect(order).toHaveValue('datasets:desc');
    expect(within(order).getAllByRole('option').map((option) => option.textContent)).toEqual(['Datasets', 'Portal', 'With a table', 'With a map', 'Last read']);
    fireEvent.change(order, { target: { value: 'name:asc' } });
    expect(titles()[0]).toBe('City of Ottawa Open Data');
    expect(address()).toBe('/portals?sort=name');
    fireEvent.change(order, { target: { value: 'maps:desc' } });
    expect(titles().slice(0, 2)).toEqual(['City of Ottawa Open Data', 'Government of Canada Open Data']);
    expect(address()).toBe('/portals?sort=maps');
    fireEvent.change(order, { target: { value: 'datasets:desc' } });
    expect(address()).toBe('/portals');
  });

  test('an order turned around on a wider screen is still the list’s choice', () => {
    embed('/portals?sort=name&order=desc');
    renderAt('/portals?sort=name&order=desc');
    const order = screen.getByLabelText('Sort by');
    expect(order).toHaveValue('name:desc');
    expect(within(order).getAllByRole('option').map((option) => option.textContent)).toContain('Portal ↓');
    expect(titles()[0]).toBe('Northwest Territories Open Data');
  });

  test('turning the phone draws the table, with the same filter and order', () => {
    embed('/portals?province=ontario&sort=name');
    renderAt('/portals?province=ontario&sort=name');
    expect(titles()).toEqual(['City of Ottawa Open Data', 'City of Toronto Open Data']);
    act(() => { for (const listener of listeners) listener({ matches: false }); });
    expect(names()).toEqual(['City of Ottawa Open Data', 'City of Toronto Open Data']);
    expect(screen.queryByRole('list', { name: 'Every portal' })).toBeNull();
  });
});

describe('a directory of one portal', () => {
  test.each([['en', /^CanQuery mirrors one Canadian open data portal, 48,310 datasets in all\./, '1 portal'],
    ['fr', /^CanQuery reproduit un portail canadien de données ouvertes, soit 48\s310 jeux de données en tout\./, '1 portail']])(
    'reads right in %s', (language, intro, count) => {
      localStorage.setItem('cq-lang', language);
      const one = { ...DIRECTORY, portals: DIRECTORY.portals.slice(0, 1), totals: { portals: 1, datasets: 48310, provinces: 0 },
        platforms: [{ id: 'ckan', portals: 1, datasets: 48310 }], levels: [{ id: 'federal', portals: 1, datasets: 48310 }], provinces: [] };
      embed('/portals', envelope(one));
      renderAt('/portals');
      expect(screen.getByText(intro)).toBeInTheDocument();
      expect(shown().textContent).toBe(count);
      expect(names()).toHaveLength(1);
      // No province has a portal of its own: the list offers none, and the group has no rows.
      expect(within(screen.getAllByRole('combobox')[2]).getAllByRole('option')).toHaveLength(1);
    });
});

describe('when the directory cannot be drawn', () => {
  test('a site that mirrors no portal yet says so, with no table', async () => {
    fetchPortalDirectory.mockRejectedValue(failure(503));
    renderAt('/portals');
    expect(await screen.findByText(/^No open data portal is mirrored here yet\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Canadian open data portals' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a failed read offers to try again, and the page then draws', async () => {
    fetchPortalDirectory.mockRejectedValueOnce(failure(500));
    renderAt('/portals');
    expect(await screen.findByText('The list of portals could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(fetchPortalDirectory).toHaveBeenCalledTimes(2);
  });

  test('a directory kept from earlier in the visit is shown at once and read again behind the page when it is old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
      embed();
      const first = renderAt('/portals');
      expect(names()).toHaveLength(6);
      first.unmount();
      // Six minutes later, back on the page: the directory is here, and a newer one arrives behind it.
      vi.setSystemTime(new Date('2026-11-15T12:06:00Z'));
      const newer = { ...DIRECTORY, portals: DIRECTORY.portals.slice(0, 2), totals: { ...DIRECTORY.totals, portals: 2 } };
      let release;
      fetchPortalDirectory.mockReturnValue(new Promise((resolve) => { release = resolve; }));
      renderAt('/portals');
      expect(names()).toHaveLength(6);
      expect(screen.queryByText('Loading the portals…')).toBeNull();
      await act(async () => { release(envelope(newer)); });
      await waitFor(() => expect(names()).toHaveLength(2));
      expect(fetchPortalDirectory).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a refresh that fails behind the page leaves the directory on screen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
      embed();
      renderAt('/portals').unmount();
      vi.setSystemTime(new Date('2026-11-15T12:06:00Z'));
      fetchPortalDirectory.mockRejectedValue(failure(500));
      renderAt('/portals');
      await act(async () => {});
      expect(names()).toHaveLength(6);
      expect(screen.queryByText('The list of portals could not be loaded.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
