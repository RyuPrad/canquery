import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CatalogFilters from './CatalogFilters.jsx';
import CatalogFilterLayout from './CatalogFilterLayout.jsx';
import CatalogResultsHeader from './CatalogResultsHeader.jsx';
import { LangProvider } from '../i18n.jsx';
import { EMPTY_CATALOG_SEARCH } from '../utils/catalogSearchState.js';

const publishers = Array.from({ length: 12 }, (_, i) => ({
  value: 'org-' + i,
  label: { en: 'Publisher ' + i, fr: i === 11 ? 'Éditeur onze' : null },
  count: 100 - i
}));
const facets = {
  level: [{ value: 'federal', count: 36090 }, { value: 'municipal', count: 16000 }],
  access: [{ value: 'queryable', count: 120 }, { value: 'mappable', count: 0 }],
  organization: publishers,
  source: [{ value: 'open-canada', label: { en: 'Government of Canada Open Data', fr: null }, count: 48122 }],
  format: [{ value: 'CSV', count: 1 }],
  keyword: []
};

function renderFilters(props = {}, language = 'en') {
  localStorage.setItem('cq-lang', language);
  const handlers = { onToggle: vi.fn(), onFlag: vi.fn(), onReset: vi.fn(), onRetry: vi.fn() };
  render(
    <LangProvider>
      <CatalogFilters search={EMPTY_CATALOG_SEARCH} facets={facets} status="ready" {...handlers} {...props} />
    </LangProvider>
  );
  return handlers;
}
const group = (name) => screen.getByRole('group', { name });

afterEach(() => localStorage.clear());

describe('CatalogFilters', () => {
  test('names each checkbox by its value and describes it with the count', () => {
    renderFilters();
    const federal = within(group('Government level')).getByRole('checkbox', { name: 'Federal' });
    expect(federal).toHaveAccessibleDescription('36,090 datasets');
    expect(within(group('Government level')).getByRole('checkbox', { name: 'Provincial and territorial' })).toHaveAccessibleDescription('0 datasets');
    expect(within(group('Format')).getByRole('checkbox', { name: 'CSV' })).toHaveAccessibleDescription('1 dataset');
    expect(screen.queryByRole('group', { name: 'Keywords' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
  });

  test('long groups show the top eight, then everything with a search box', () => {
    const { onToggle } = renderFilters({ search: { ...EMPTY_CATALOG_SEARCH, org: ['org-11'] } });
    const publishersGroup = group('Publisher');
    expect(within(publishersGroup).getAllByRole('checkbox')).toHaveLength(9);
    expect(within(publishersGroup).getByRole('checkbox', { name: 'Publisher 11' })).toBeChecked();
    fireEvent.click(within(publishersGroup).getByRole('button', { name: 'Show all (12)' }));
    expect(within(publishersGroup).getAllByRole('checkbox')).toHaveLength(12);
    fireEvent.change(within(publishersGroup).getByRole('searchbox', { name: 'Find a publisher' }), { target: { value: 'publisher 3' } });
    expect(within(publishersGroup).getAllByRole('checkbox').map((box) => box.getAttribute('aria-describedby') && box.labels[0].textContent))
      .toEqual(['Publisher 397', 'Publisher 1189']);
    fireEvent.click(within(publishersGroup).getByRole('checkbox', { name: 'Publisher 3' }));
    expect(onToggle).toHaveBeenCalledWith('org', 'org-3');
  });

  test('flags, reset and unavailable counts call their handlers', () => {
    const { onFlag, onReset, onRetry } = renderFilters({ facets: null, status: 'unavailable', search: { ...EMPTY_CATALOG_SEARCH, mappable: true } });
    expect(within(group('Data access')).getByRole('checkbox', { name: 'Has a map' })).toBeChecked();
    expect(within(group('Data access')).getByRole('checkbox', { name: 'Has a map' })).not.toHaveAttribute('aria-describedby');
    fireEvent.click(within(group('Data access')).getByRole('checkbox', { name: 'Has a queryable table' }));
    expect(onFlag).toHaveBeenCalledWith('queryable');
    expect(screen.getByRole('status')).toHaveTextContent('Counts are temporarily unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(within(group('Format')).getAllByRole('checkbox').map((box) => box.labels[0].textContent))
      .toEqual(['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML']);
    fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
    expect(onReset).toHaveBeenCalled();
  });

  test('labels and counts follow the French interface', () => {
    renderFilters({}, 'fr');
    expect(within(group('Ordre de gouvernement')).getByRole('checkbox', { name: 'Fédéral' })).toHaveAccessibleDescription(/^36\s090 jeux de données$/);
    fireEvent.click(within(group('Éditeur')).getByRole('button', { name: 'Tout afficher (12)' }));
    expect(within(group('Éditeur')).getByRole('checkbox', { name: 'Éditeur onze' })).toBeInTheDocument();
    expect(within(group('Portail source')).getByRole('checkbox', { name: 'Government of Canada Open Data' })).toBeInTheDocument();
  });
});

describe('CatalogResultsHeader', () => {
  test('counts results, offers orders that fit the search and removes chips', () => {
    const onSort = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = render(<LangProvider><CatalogResultsHeader total={1} sort="relevance" hasQuery={false} onSort={onSort}
      chips={[{ key: 'format', value: 'CSV', label: 'CSV' }]} onRemove={onRemove} /></LangProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('1 dataset');
    const order = screen.getByRole('combobox', { name: 'Order by' });
    expect(within(order).getAllByRole('option').map((option) => option.textContent)).toEqual(['Recently updated', 'Title A–Z', 'Title Z–A']);
    fireEvent.change(order, { target: { value: 'title_desc' } });
    expect(onSort).toHaveBeenCalledWith('title_desc');
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: CSV' }));
    expect(onRemove).toHaveBeenCalledWith({ key: 'format', value: 'CSV', label: 'CSV' });
    rerender(<LangProvider><CatalogResultsHeader total={null} sort="updated" hasQuery onSort={onSort} chips={[]} onRemove={onRemove} /></LangProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Results');
    expect(screen.getByRole('combobox', { name: 'Order by' })).toHaveValue('updated');
  });
});

describe('CatalogFilterLayout', () => {
  const narrow = (matches) => vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  }));
  afterEach(() => vi.restoreAllMocks());
  const layout = (activeCount = 0) => render(
    <LangProvider><MemoryRouter><CatalogFilterLayout activeCount={activeCount} sidebar={<button>Inside filters</button>}>
      <p>Results</p>
    </CatalogFilterLayout></MemoryRouter></LangProvider>
  );

  test('wide screens keep the filters beside the results', () => {
    narrow(false);
    layout();
    expect(screen.getByRole('complementary', { name: 'Filters' })).toContainElement(screen.getByRole('button', { name: 'Inside filters' }));
  });

  test('narrow screens disclose the filters and Escape returns focus to the toggle', () => {
    narrow(true);
    layout(2);
    const toggle = screen.getByRole('button', { name: 'Filters (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Inside filters' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const inside = screen.getByRole('button', { name: 'Inside filters' });
    expect(screen.getByRole('region', { name: 'Filters' })).toHaveAttribute('id', toggle.getAttribute('aria-controls'));
    inside.focus();
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Inside filters' })).toBeNull();
    expect(toggle).toHaveFocus();
  });
});
