import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import HomeQuickFilters from './HomeQuickFilters.jsx';
import { LangProvider } from '../i18n.jsx';
import { EMPTY_CATALOG_SEARCH } from '../utils/catalogSearchState.js';

const facets = {
  level: [
    { value: 'federal', count: 36090 },
    { value: 'provincial', count: 12085 },
    { value: 'municipal', count: 16007 }
  ],
  access: [{ value: 'queryable', count: 2193 }, { value: 'mappable', count: 0 }],
  format: [{ value: 'HTML', count: 32869 }, { value: 'CSV', count: 29804 }],
  organization: [],
  source: [],
  keyword: []
};

beforeEach(() => localStorage.clear());

function quick(props = {}, lang = 'en') {
  localStorage.setItem('cq-lang', lang);
  const handlers = { onToggle: vi.fn(), onFlag: vi.fn(), onAllFilters: vi.fn() };
  const tree = (extra = {}) => (
    <LangProvider>
      <MemoryRouter>
        <HomeQuickFilters search={EMPTY_CATALOG_SEARCH} facets={facets} total={64232} {...handlers} {...props} {...extra} />
      </MemoryRouter>
    </LangProvider>
  );
  const view = render(tree());
  return { ...handlers, rerender: (extra) => view.rerender(tree(extra)) };
}
const row = (name = 'Filter by') => screen.getByRole('group', { name });

test('before a search, chips show whole-catalogue counts and All filters leads to the catalogue', () => {
  const { onToggle, onFlag, onAllFilters } = quick();
  const federal = within(row()).getByRole('button', { name: 'Federal' });
  expect(federal).toHaveAttribute('aria-pressed', 'false');
  expect(federal).toHaveTextContent('36,090');
  expect(federal).toHaveAccessibleDescription('36,090 datasets');
  expect(within(row()).getByRole('button', { name: 'CSV' })).toHaveTextContent('29,804');
  fireEvent.click(federal);
  expect(onToggle).toHaveBeenCalledWith('level', 'federal');
  fireEvent.click(within(row()).getByRole('button', { name: 'Has a queryable table' }));
  expect(onFlag).toHaveBeenCalledWith('queryable');
  const all = within(row()).getByRole('link', { name: 'All filters' });
  expect(all).toHaveAttribute('href', '/datasets');
  fireEvent.click(all);
  expect(onAllFilters).toHaveBeenCalled();
});

test('a value nothing matches is disabled only while its count is current and it is not chosen', () => {
  const { rerender } = quick();
  expect(within(row()).getByRole('button', { name: 'Has a map' })).toBeDisabled();
  rerender({ stale: true });
  expect(within(row()).getByRole('button', { name: 'Has a map' })).toBeEnabled();
  rerender({ stale: false, search: { ...EMPTY_CATALOG_SEARCH, mappable: true } });
  const map = within(row()).getByRole('button', { name: 'Has a map' });
  expect(map).toBeEnabled();
  expect(map).toHaveAttribute('aria-pressed', 'true');
});

test('while searching, the label is the result count, chosen chips are pressed and All filters is a button', () => {
  const { onAllFilters } = quick({
    filtering: true,
    total: 1234,
    search: { ...EMPTY_CATALOG_SEARCH, q: 'parks', level: ['federal'], format: ['CSV'], queryable: true }
  });
  expect(within(row()).getByText('1,234 datasets')).toBeInTheDocument();
  for (const name of ['Federal', 'CSV', 'Has a queryable table']) {
    expect(within(row()).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  }
  expect(within(row()).getByRole('button', { name: 'Municipal and regional' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(row()).queryByRole('link', { name: 'All filters' })).toBeNull();
  fireEvent.click(within(row()).getByRole('button', { name: 'All filters' }));
  expect(onAllFilters).toHaveBeenCalled();
});

test('without counts the chips still work and show no numbers', () => {
  const { onToggle } = quick({ facets: null, total: null, stale: true, filtering: true });
  expect(within(row()).getByText('Filter by')).toBeInTheDocument();
  const federal = within(row()).getByRole('button', { name: 'Federal' });
  expect(federal).not.toHaveAttribute('aria-describedby');
  expect(federal).toHaveTextContent(/^Federal$/);
  fireEvent.click(federal);
  expect(onToggle).toHaveBeenCalledWith('level', 'federal');
});

test('French labels and counts use the French number format', () => {
  quick({}, 'fr');
  const federal = within(row('Filtrer par')).getByRole('button', { name: 'Fédéral' });
  expect(federal.textContent.replace(/\s/g, ' ')).toContain('36 090');
  expect(federal).toHaveAccessibleDescription(/^36\s090 jeux de données$/);
  expect(within(row('Filtrer par')).getByRole('link', { name: 'Tous les filtres' })).toHaveAttribute('href', '/datasets');
});
