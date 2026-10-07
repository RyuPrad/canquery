import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LangProvider } from '../i18n.jsx';
import AccountPage from './AccountPage.jsx';
import AuthPage from './AuthPage.jsx';
import PricingPage from './PricingPage.jsx';
import { accountRequest, authRequest } from '../api/account.js';

vi.mock('../api/account.js', () => ({ accountRequest: vi.fn(), authRequest: vi.fn() }));
const account = { plan: 'free', mode: 'sandbox', user: { email: 'fixture@example.test' }, remaining: 1000, limit: 1000, used: 0, reserved: 0,
  resets_at: '2026-11-01T00:00:00Z', key_limit: 1, rate_limit: 30, concurrency: 1, keys: [], usage: [] };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { vi.restoreAllMocks(); });

test('a newly created key is shown once and never stored in browser storage', async () => {
  const secret = 'cq_fixture_secret';
  accountRequest.mockImplementation(path => Promise.resolve(path === '/keys' ? { secret } : account));
  const first = render(<AccountPage />);
  await screen.findByText('fixture@example.test');
  fireEvent.change(screen.getByRole('textbox', { name: 'Key name' }), { target: { value: 'Integration' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
  expect(await screen.findByDisplayValue(secret)).toHaveAttribute('readonly');
  expect(accountRequest).toHaveBeenCalledWith('/keys', { method: 'POST', body: JSON.stringify({ name: 'Integration' }) });
  expect(JSON.stringify(localStorage)).not.toContain(secret);
  expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  fireEvent.click(screen.getByRole('button', { name: 'Hide key' }));
  expect(screen.queryByDisplayValue(secret)).toBeNull();
  first.unmount(); render(<AccountPage />);
  await screen.findByText('fixture@example.test');
  expect(screen.queryByDisplayValue(secret)).toBeNull();
});

test('revocation is scoped to the displayed key and downgrade disables new key creation', async () => {
  accountRequest.mockResolvedValue({ ...account, keys: [{ id: 'owned-key', name: 'Production', prefix: 'cq_prefix', enabled: false }] });
  render(<AccountPage />);
  expect(await screen.findByRole('button', { name: 'Create key' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/keys/owned-key', { method: 'DELETE' }));
});

test('expired sessions show a sign-in action and omit account data', async () => {
  accountRequest.mockRejectedValue({ status: 401 });
  render(<AccountPage />);
  expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(screen.queryByText('fixture@example.test')).toBeNull();
});

test('signup sends the accepted terms version with a same-origin callback', async () => {
  authRequest.mockResolvedValue({});
  render(<MemoryRouter initialEntries={['/signup']}><AuthPage /></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Fixture owner' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'fixture@example.test' } });
  fireEvent.change(document.querySelector('input[name=password]'), { target: { value: 'long-fixture-password' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(document.querySelector('form'));
  await waitFor(() => expect(authRequest).toHaveBeenCalledWith('sign-up/email', expect.objectContaining({ termsVersion: '2026-10-06', callbackURL: window.location.origin + '/account' }), 'en'));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
});

test('password reset keeps the token out of the visible URL and sends it only with the reset request', async () => {
  window.history.replaceState(null, '', '/reset-password?token=fixture-reset-token');
  authRequest.mockResolvedValue({});
  render(<MemoryRouter initialEntries={['/reset-password']}><AuthPage /></MemoryRouter>);
  expect(window.location.search).toBe('');
  fireEvent.change(document.querySelector('input[name=password]'), { target: { value: 'new-long-fixture-password' } });
  fireEvent.submit(document.querySelector('form'));
  await waitFor(() => expect(authRequest).toHaveBeenCalledWith('reset-password', { token: 'fixture-reset-token', newPassword: 'new-long-fixture-password' }, 'en'));
});

test('an unverified owner can request another verification email from sign-in', async () => {
  authRequest.mockRejectedValueOnce({ code: 'EMAIL_NOT_VERIFIED' }).mockResolvedValue({});
  render(<MemoryRouter initialEntries={['/login']}><AuthPage /></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'fixture@example.test' } });
  fireEvent.change(document.querySelector('input[name=password]'), { target: { value: 'long-fixture-password' } });
  fireEvent.submit(document.querySelector('form'));
  fireEvent.click(await screen.findByRole('button', { name: 'Resend verification email' }));
  await waitFor(() => expect(authRequest).toHaveBeenLastCalledWith('send-verification-email', { email: 'fixture@example.test', callbackURL: window.location.origin + '/account' }, 'en'));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
});

test('French pricing exposes finite allowances, costs and Enterprise contact', async () => {
  localStorage.setItem('cq-lang', 'fr');
  accountRequest.mockResolvedValue({ enabled: true, mode: 'sandbox', checkout: true });
  render(<LangProvider><PricingPage /></LangProvider>);
  expect(await screen.findByRole('heading', { name: 'Entreprise' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Nous joindre' })).toHaveAttribute('href', 'mailto:support@canquery.com?subject=CanQuery%20API');
  expect(screen.getByText('49 $ CA/mois')).toBeInTheDocument();
});

test.each([
  ['en', 'Coming soon', 'Create an account', 'Choose Business'],
  ['fr', 'Bientôt disponible', 'Créer un compte', 'Choisir Business'],
])('a Free launch keeps signup open and paid checkout unavailable in %s', async (lang, soon, signup, business) => {
  localStorage.setItem('cq-lang', lang);
  accountRequest.mockResolvedValue({ enabled: true, mode: 'live', checkout: false });
  render(<LangProvider><PricingPage /></LangProvider>);
  expect(await screen.findByRole('button', { name: soon })).toBeDisabled();
  expect(screen.getByRole('link', { name: signup })).toHaveAttribute('href', '/signup');
  expect(screen.queryByRole('link', { name: business })).toBeNull();
});
