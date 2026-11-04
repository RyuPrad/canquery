import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { LangProvider } from '../i18n.jsx';
import CatalogResultsHeader from './CatalogResultsHeader.jsx';

vi.mock('./SaveSearchSlot.jsx', () => ({
  default: ({ search, total }) => <p data-testid="save">{(search?.q ?? 'none') + '|' + String(total)}</p>
}));
const search = { q: 'parks', org: [], format: [], keyword: [], source: [], level: [], place: '', mappable: false, queryable: false, sort: 'relevance' };
const header = props => render(<LangProvider><CatalogResultsHeader sort="relevance" hasQuery onSort={() => {}} search={search} {...props} /></LangProvider>);

test('the hosted save control gets the search and its count', () => {
  header({ total: 42 });
  expect(screen.getByTestId('save')).toHaveTextContent('parks|42');
});

test('while the count is out of date, the save control gets none', () => {
  header({ total: 64000, stale: true });
  expect(screen.getByTestId('save')).toHaveTextContent('parks|null');
  expect(screen.getByRole('status')).toHaveClass('cq-results-stale');
});
