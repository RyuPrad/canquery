import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import Navbar from './Navbar.jsx';
import { LangProvider, useLang } from '../i18n.jsx';
import { ThemeProvider } from '../theme.jsx';

vi.mock('../utils/analytics.js', () => ({ track: vi.fn() }));
import { track } from '../utils/analytics.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'canquery';
  vi.clearAllMocks();
});

function NavigationFixture({ translations }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { setBlogTranslations } = useLang();
  useEffect(() => {
    if (translations) setBlogTranslations(translations);
  }, [translations, setBlogTranslations]);
  return <>
    <button onClick={() => navigate('/resources/example?view=map')}>Visit resource</button>
    <output data-testid="location">{location.pathname + location.search}</output>
  </>;
}

function start({ path = '/', translations } = {}) {
  render(<MemoryRouter initialEntries={[path]}><ThemeProvider><LangProvider>
    <Navbar /><NavigationFixture translations={translations} />
  </LangProvider></ThemeProvider></MemoryRouter>);
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  return screen.getByRole('navigation', { name: 'Navigation' });
}

test('discloses ordinary links and removes closed navigation from focus order', () => {
  start();
  const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('navigation', { name: 'Navigation' })).not.toBeInTheDocument();
  const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(primary).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/datasets', '/places', '/insights']);

  const panel = openMenu();
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).toHaveAttribute('aria-controls', panel.id);
  expect(within(panel).getByRole('link', { name: 'Search', exact: true })).toHaveAttribute('href', '/');
  expect(within(panel).getByRole('link', { name: 'Organizations' })).toHaveAttribute('href', '/organizations');
  expect(within(panel).getByRole('link', { name: 'Data guides' })).toHaveAttribute('href', '/blog');
  expect(within(panel).getByRole('link', { name: 'API docs' })).toHaveAttribute('href', '/docs');
  expect(within(panel).getByRole('link', { name: 'open.canada.ca' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'EN', exact: true })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'FR', exact: true })).toHaveLength(1);

  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(panel).not.toBeInTheDocument();
});

test('Escape returns focus to the trigger and interaction inside keeps the panel open', () => {
  start();
  const panel = openMenu();
  const link = within(panel).getByRole('link', { name: 'Organizations' });
  fireEvent.pointerDown(link);
  expect(panel).toBeInTheDocument();
  link.focus();
  fireEvent.keyDown(link, { key: 'Escape' });
  const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('outside interaction dismisses the panel without moving focus', () => {
  start();
  const panel = openMenu();
  const outside = screen.getByRole('button', { name: 'Visit resource' });
  outside.focus();
  fireEvent.pointerDown(outside);
  expect(panel).not.toBeInTheDocument();
  expect(outside).toHaveFocus();
});

test('route changes and selecting the current route dismiss the panel', async () => {
  start();
  let panel = openMenu();
  fireEvent.click(within(panel).getByRole('link', { name: 'Search', exact: true }));
  expect(panel).not.toBeInTheDocument();
  panel = openMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Visit resource' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/resources/example?view=map'));
  expect(panel).not.toBeInTheDocument();
});

test('both theme controls retain the preference and analytics behavior', () => {
  start();
  const panel = openMenu();
  fireEvent.click(within(panel).getByRole('button', { name: 'Toggle light / dark theme' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'canquery-light');
  expect(localStorage.getItem('cq-theme')).toBe('canquery-light');
  expect(track).toHaveBeenLastCalledWith('ui_theme', { theme: 'light' });
  fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle light / dark theme' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'canquery');
  expect(track).toHaveBeenLastCalledWith('ui_theme', { theme: 'dark' });
});

test('language controls keep their selected state and translate disclosure links', () => {
  start();
  fireEvent.click(screen.getByRole('button', { name: 'FR', exact: true }));
  expect(screen.getByRole('button', { name: 'FR', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(track).toHaveBeenLastCalledWith('ui_language', { language: 'fr' });
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu de navigation' }));
  const panel = screen.getByRole('navigation', { name: 'Navigation' });
  expect(within(panel).getByRole('link', { name: 'Guides des données' })).toHaveAttribute('href', '/fr/blog');
  expect(within(panel).getByRole('link', { name: 'Rechercher', exact: true })).toHaveAttribute('href', '/');
});

test('blog language controls remain disabled until article translations resolve', () => {
  start({ path: '/blog/parks' });
  expect(screen.getByRole('button', { name: 'EN', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'FR', exact: true })).toBeDisabled();
});

test('resolved blog language switching follows the paired article URL and closes navigation', async () => {
  start({ path: '/blog/parks', translations: {
    pathname: '/blog/parks', paths: { en: '/blog/parks', fr: '/fr/blog/parcs' },
  } });
  const french = screen.getByRole('button', { name: 'FR', exact: true });
  await waitFor(() => expect(french).toBeEnabled());
  const panel = openMenu();
  fireEvent.click(french);
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/fr/blog/parcs'));
  expect(panel).not.toBeInTheDocument();
  expect(track).toHaveBeenLastCalledWith('ui_language', { language: 'fr' });
});
