// The hosted edition's TopLink: in the top row on wide screens, and first in
// the menu panel on phones, where following it closes the menu.
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navbar from './Navbar.jsx';
import { LangProvider } from '../i18n.jsx';
import { ThemeProvider } from '../theme.jsx';

vi.mock('../extensions.js', () => ({
  hostedPart: () => ({
    TopLink: ({ placement, onNavigate }) => <a href="/account" data-placement={placement} onClick={event => { event.preventDefault(); onNavigate?.(); }}>Account link</a>,
  }),
}));

function start() {
  render(<MemoryRouter><ThemeProvider><LangProvider><Navbar /></LangProvider></ThemeProvider></MemoryRouter>);
}

test('the hosted top link sits in the top row and first in the phone menu', () => {
  start();
  const top = screen.getByRole('link', { name: 'Account link' });
  expect(top).toHaveAttribute('data-placement', 'nav');
  expect(top.closest('.cq-navbar-account-desktop')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  const panel = screen.getByRole('navigation', { name: 'Navigation' });
  const links = within(panel).getAllByRole('link');
  expect(links[0]).toHaveAccessibleName('Account link');
  expect(links[0]).toHaveAttribute('data-placement', 'nav_menu');
  fireEvent.click(links[0]);
  expect(screen.queryByRole('navigation', { name: 'Navigation' })).not.toBeInTheDocument();
});

