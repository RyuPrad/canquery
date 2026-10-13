// The open-source edition must work on its own: without an installed extension
// there are no hosted routes, navigation links or account strings.
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { LangProvider, STRINGS } from './i18n.jsx';

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

test('the string table has no account or pricing strings', () => {
  for (const lang of ['en', 'fr']) {
    expect(Object.keys(STRINGS[lang]).filter(key => /^(account|pricing)\./.test(key))).toEqual([]);
  }
});
