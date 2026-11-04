import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test } from 'vitest';
import RecentlyViewedRail from './RecentlyViewedRail.jsx';
import { LangProvider } from '../i18n.jsx';
import { rememberView } from '../utils/recentlyViewed.js';

afterEach(() => localStorage.clear());
const mount = () => render(<LangProvider><MemoryRouter><RecentlyViewedRail /></MemoryRouter></LangProvider>);

test('shows nothing until something was opened, then the views newest first', () => {
  const { container } = mount();
  expect(container).toBeEmptyDOMElement();
  act(() => {
    rememberView({ kind: 'dataset', id: 'd1', title: { en: 'Building permits', fr: 'Permis de construire' }, path: '/datasets/permits' });
    rememberView({ kind: 'resource', id: 'r1', title: { en: 'Permits 2026', fr: '' }, path: '/resources/r1' });
  });
  const rail = screen.getByRole('region', { name: 'Recently viewed' });
  expect(within(rail).getAllByRole('link').map(link => [link.textContent.includes('File') ? 'file' : 'dataset', link.getAttribute('href')]))
    .toEqual([['file', '/resources/r1'], ['dataset', '/datasets/permits']]);
  expect(within(rail).getByText('Kept only in this browser.')).toBeInTheDocument();
  fireEvent.click(within(rail).getByRole('button', { name: 'Clear the recently viewed list' }));
  expect(screen.queryByRole('region', { name: 'Recently viewed' })).toBeNull();
  expect(localStorage.getItem('cq-recent')).toBeNull();
  // Focus stays where the list was, on what happened.
  expect(screen.getByRole('status')).toHaveTextContent('Recently viewed list cleared.');
  expect(screen.getByRole('status')).toHaveFocus();
});

test('a view with an unknown time shows no time, and a hostile stored time cannot break the page', () => {
  localStorage.setItem('cq-recent', JSON.stringify([
    { kind: 'dataset', id: 'd1', title: { en: 'Far future', fr: '' }, path: '/datasets/d1', at: 1e17 },
    { kind: 'dataset', id: 'd1', title: { en: 'Far future', fr: '' }, path: '/datasets/d1', at: 5 }
  ]));
  mount();
  const links = within(screen.getByRole('region', { name: 'Recently viewed' })).getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0].textContent).toBe('DatasetFar future');
});

test('speaks French and keeps the English title when there is no French one', () => {
  localStorage.setItem('cq-lang', 'fr');
  rememberView({ kind: 'dataset', id: 'd1', title: { en: 'Building permits', fr: 'Permis de construire' }, path: '/datasets/permits' });
  rememberView({ kind: 'resource', id: 'r1', title: { en: 'Permits 2026', fr: '' }, path: '/resources/r1' });
  mount();
  const rail = screen.getByRole('region', { name: 'Consultés récemment' });
  expect(within(rail).getByText('Permis de construire')).toBeInTheDocument();
  expect(within(rail).getByText('Permits 2026')).toBeInTheDocument();
  expect(within(rail).getByRole('button', { name: 'Effacer la liste des consultations récentes' })).toHaveTextContent('Effacer');
});
