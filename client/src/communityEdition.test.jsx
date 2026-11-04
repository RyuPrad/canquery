// The open-source edition must work on its own: without an installed extension
// there are no hosted routes, navigation links or account strings.
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { LangProvider, STRINGS } from './i18n.jsx';
import QueryGateSlot from './components/QueryGateSlot.jsx';
import { allowQuery } from './utils/queryGate.js';

vi.mock('./extensions.js', () => ({ hostedPart: (_modules, fallback) => fallback }));

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))));
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

test.each(['/pricing', '/account', '/login', '/signup', '/forgot-password', '/reset-password', '/terms'])('%s is not a page', async path => {
  render(<MemoryRouter initialEntries={[path]}><LangProvider><App /></LangProvider></MemoryRouter>);
  expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
});

test('navigation and footer link only to core pages', async () => {
  const { container } = render(<MemoryRouter initialEntries={['/about']}><LangProvider><App /></LangProvider></MemoryRouter>);
  await act(async () => {});
  for (const path of ['/pricing', '/account', '/terms', '/signup']) expect(container.querySelector(`a[href="${path}"]`)).toBeNull();
});

test('the string table has no account, pricing, alert or sign-up prompt strings', () => {
  for (const lang of ['en', 'fr']) {
    expect(Object.keys(STRINGS[lang]).filter(key => /^(account|pricing|alerts|gate)\./.test(key))).toEqual([]);
  }
});

test('table searches are never refused, counted or followed by a sign-up prompt', () => {
  for (const kind of ['search', 'filter', 'sort', 'page']) {
    for (let index = 0; index < 5; index += 1) {
      expect(allowQuery(kind, { resource: 'a', value: 'x' + index, page: index + 1 })).toBe(true);
    }
  }
  expect(localStorage.getItem('cq-query-meter')).toBeNull();
  const { container } = render(<QueryGateSlot resourceId="a" datasetId="d" />);
  expect(container).toBeEmptyDOMElement();
});
