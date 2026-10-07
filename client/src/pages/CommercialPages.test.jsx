import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LangProvider } from '../i18n.jsx';
import AccountPage from './AccountPage.jsx';
import AuthPage from './AuthPage.jsx';
import { accountRequest, authRequest } from '../api/account.js';

vi.mock('../api/account.js', () => ({ accountRequest: vi.fn(), authRequest: vi.fn() }));
const account = { plan: 'free', mode: 'live', user: { email: 'fixture@example.test' }, remaining: 1000, limit: 1000, used: 0, reserved: 0,
  resets_at: '2026-11-01T00:00:00Z', key_limit: 1, rate_limit: 30, concurrency: 1, keys: [], usage: [] };
const key = { id: 'owned-key', name: 'Monthly report', prefix: 'cq_prefix', enabled: true, created_at: '2026-10-06T23:00:00Z' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/');
  // jsdom has no dialog top layer; browser checks cover native modality.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
});
afterEach(() => { vi.restoreAllMocks(); delete HTMLDialogElement.prototype.showModal; });
const renderAuth = path => render(<MemoryRouter initialEntries={[path]}><AuthPage /></MemoryRouter>);
const fillCredentials = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'fixture@example.test' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'long-fixture-password' } });
};

test('new keys are shown once without persisting the secret; clipboard failure supports manual copying', async () => {
  const secret = 'cq_fixture_secret';
  accountRequest.mockImplementation(path => Promise.resolve(path === '/keys' ? { secret } : account));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
  const first = render(<AccountPage />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Key name' }), { target: { value: 'Integration' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
  const field = await screen.findByDisplayValue(secret);
  expect(field).toHaveAttribute('readonly');
  expect(accountRequest).toHaveBeenCalledWith('/keys', { method: 'POST', body: JSON.stringify({ name: 'Integration' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));
  expect(await screen.findByText('Select the key above and copy it manually.')).toBeInTheDocument();
  expect(field).toHaveFocus(); expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(secret.length);
  expect(JSON.stringify(localStorage)).not.toContain(secret); expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  fireEvent.click(screen.getByRole('button', { name: 'Hide key' })); expect(screen.queryByDisplayValue(secret)).toBeNull();
  first.unmount(); render(<AccountPage />); await screen.findByText('fixture@example.test'); expect(screen.queryByDisplayValue(secret)).toBeNull();
});

test('used credits, reservations and remaining balance stay distinct with an explicit UTC reset', async () => {
  accountRequest.mockResolvedValue({ ...account, used: 120, reserved: 25, remaining: 855 }); render(<AccountPage />);
  const progress = await screen.findByRole('progressbar', { name: 'Used' });
  expect(progress).toHaveAttribute('value', '120'); expect(progress).toHaveAttribute('max', '1000');
  expect(screen.getByText('855')).toBeInTheDocument(); expect(screen.getByText('25')).toBeInTheDocument();
  expect(screen.getByText('120 of 1,000 credits used')).toBeInTheDocument();
  expect(document.querySelector('time[datetime="2026-11-01T00:00:00Z"]')).toHaveTextContent('UTC');
  expect(screen.getByText(/Reserved credits cover requests still in progress/)).toBeInTheDocument();
});

test('preparation returns show gross and net usage and retain the original expired allowance period', async () => {
  accountRequest.mockResolvedValue({ ...account, used: 2, gross_used: 2, returned_credits: 0, remaining: 998,
    usage: [{ day: '2026-09-30', operation: 'preparation', requests: 1, credits: 100, returned_credits: 100, net_credits: 0 }],
    preparation_refunds: [{ job_id: 42, credits: 100, charged_at: '2026-09-30T23:58:00Z', refunded_at: '2026-10-01T00:03:00Z', period_id: 'prior', period_starts_at: '2026-09-01T00:00:00Z', period_ends_at: '2026-10-01T00:00:00Z' }] });
  render(<AccountPage />);
  expect(await screen.findByText('Preparation job 42')).toBeVisible();
  expect(screen.getByText('100 credits returned')).toBeVisible();
  expect(screen.getByText(/Current allowance period: 2 credits charged, 0 preparation credits returned/)).toBeVisible();
  const row = screen.getByRole('cell', { name: '2026-09-30' }).closest('tr');
  expect([...row.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['2026-09-30', 'New preparation', '1', '100', '100', '0']);
  expect(document.querySelector('time[datetime="2026-09-01T00:00:00Z"]')).toBeInTheDocument();
  expect(screen.getByText(/Returns from an expired period do not increase this period/)).toBeVisible();
});

test('revocation names the key, waits for confirmation and restores focus on cancel', async () => {
  accountRequest.mockResolvedValue({ ...account, keys: [key] }); render(<AccountPage />);
  const trigger = await screen.findByRole('button', { name: 'Revoke Monthly report' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Revoke this API key?' });
  expect(within(dialog).getByText('Monthly report')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(accountRequest).not.toHaveBeenCalledWith('/keys/owned-key', expect.anything());
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus()); expect(accountRequest).not.toHaveBeenCalledWith('/keys/owned-key', expect.anything());
});

test('confirmed revocation targets only the selected key and focuses the creation field', async () => {
  accountRequest.mockImplementation(path => Promise.resolve(path ? null : { ...account, keys: [key] })); render(<AccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke Monthly report' })); fireEvent.click(screen.getByRole('button', { name: 'Revoke key' }));
  await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/keys/owned-key', { method: 'DELETE' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Key name' })).toHaveFocus());
});

test('revocation failure stays in the dialog and cancellation does not issue another deletion', async () => {
  accountRequest.mockImplementation(path => path ? Promise.reject(new Error('offline')) : Promise.resolve({ ...account, keys: [key] })); render(<AccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke Monthly report' })); fireEvent.click(screen.getByRole('button', { name: 'Revoke key' }));
  const dialog = screen.getByRole('dialog'); expect(await within(dialog).findByRole('alert')).toHaveTextContent('This action could not be completed');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(accountRequest.mock.calls.filter(([path]) => path === '/keys/owned-key')).toHaveLength(1);
});

test('downgraded keys explain the limit and cannot bypass it by submitting the form', async () => {
  accountRequest.mockResolvedValue({ ...account, keys: [{ ...key, enabled: false }] }); render(<AccountPage />);
  expect(await screen.findByRole('button', { name: 'Create key' })).toBeDisabled();
  expect(screen.getByText('Disabled by current plan')).toBeInTheDocument(); expect(screen.getByText(/Your key slots are full/)).toBeInTheDocument();
  expect(screen.getByText('cq_prefix…')).toBeInTheDocument(); expect(document.querySelector('time[datetime="2026-10-06T23:00:00Z"]')).toHaveTextContent('UTC');
  fireEvent.submit(document.querySelector('form')); expect(accountRequest).not.toHaveBeenCalledWith('/keys', expect.anything());
});

test('empty accounts offer quickstart and usage links without an unavailable paid upgrade', async () => {
  accountRequest.mockResolvedValue({ ...account, checkout_available: false }); render(<AccountPage />);
  expect(await screen.findByText('No API keys yet')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Run the quickstart' })[0]).toHaveAttribute('href', '/docs#quickstart');
  expect(screen.getByRole('link', { name: 'Check your usage' })).toHaveAttribute('href', '#usage');
  expect(screen.queryByRole('button', { name: 'Business · CA$49/month' })).toBeNull();
});

test('account loading failure can be retried', async () => {
  accountRequest.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(account); render(<AccountPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your account could not be loaded.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(await screen.findByText('fixture@example.test')).toBeInTheDocument();
});

test('expired sessions show a full-document sign-in link and omit account data', async () => {
  accountRequest.mockRejectedValue({ status: 401 }); render(<AccountPage />);
  expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login'); expect(screen.queryByText('fixture@example.test')).toBeNull();
});

test('signup sends accepted terms and replaces the successful form with next steps', async () => {
  authRequest.mockResolvedValue({}); renderAuth('/signup');
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Fixture owner' } });
  fillCredentials(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.submit(document.querySelector('form'));
  await waitFor(() => expect(authRequest).toHaveBeenCalledWith('sign-up/email', expect.objectContaining({ termsVersion: '2026-10-06', callbackURL: window.location.origin + '/account' }), 'en'));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email'); expect(document.querySelector('form')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Check your inbox' })).toHaveFocus();
});

test('password visibility is accessible and preserves the entered password', () => {
  renderAuth('/login'); const password = screen.getByLabelText('Password', { exact: true });
  fireEvent.change(password, { target: { value: 'long-fixture-password' } }); expect(password).toHaveAttribute('type', 'password');
  expect(password).toHaveAccessibleDescription('Enter your CanQuery account password.');
  fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(password).toHaveAttribute('type', 'text'); expect(password).toHaveValue('long-fixture-password');
  expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Hide' })); expect(password).toHaveAttribute('type', 'password'); expect(authRequest).not.toHaveBeenCalled();
});

test('password reset removes the URL token and sends it only with the reset request', async () => {
  window.history.replaceState(null, '', '/reset-password?token=fixture-reset-token'); authRequest.mockResolvedValue({}); renderAuth('/reset-password');
  expect(window.location.search).toBe('');
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'new-long-fixture-password' } }); fireEvent.submit(document.querySelector('form'));
  await waitFor(() => expect(authRequest).toHaveBeenCalledWith('reset-password', { token: 'fixture-reset-token', newPassword: 'new-long-fixture-password' }, 'en'));
  expect(await screen.findByRole('heading', { name: 'Password updated' })).toHaveFocus(); expect(document.querySelector('form')).toBeNull();
  expect(JSON.stringify(localStorage)).not.toContain('fixture-reset-token'); expect(JSON.stringify(sessionStorage)).not.toContain('fixture-reset-token');
});

test.each(['/reset-password', '/reset-password?error=INVALID_TOKEN'])('missing/invalid reset links offer recovery: %s', path => {
  window.history.replaceState(null, '', path); renderAuth('/reset-password');
  expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  expect(document.querySelector('form')).toBeNull(); expect(window.location.search).toBe(''); expect(authRequest).not.toHaveBeenCalled();
});

test('expired reset tokens from the server replace the form with recovery', async () => {
  window.history.replaceState(null, '', '/reset-password?token=expired-fixture-token'); authRequest.mockRejectedValue({ code: 'INVALID_TOKEN' }); renderAuth('/reset-password');
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'new-long-fixture-password' } }); fireEvent.submit(document.querySelector('form'));
  expect(await screen.findByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password'); expect(document.querySelector('form')).toBeNull();
});

test('temporary reset failure retains the form without claiming the link is invalid', async () => {
  window.history.replaceState(null, '', '/reset-password?token=valid-fixture-token'); authRequest.mockRejectedValue({ status: 503 }); renderAuth('/reset-password');
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'new-long-fixture-password' } }); fireEvent.submit(document.querySelector('form'));
  expect(await screen.findByRole('alert')).toHaveFocus(); expect(document.querySelector('form')).not.toBeNull(); expect(screen.queryByRole('link', { name: 'Request a new link' })).toBeNull();
});

test('an unverified owner can resend verification and receives a confirmation screen', async () => {
  authRequest.mockRejectedValueOnce({ code: 'EMAIL_NOT_VERIFIED' }).mockResolvedValue({}); renderAuth('/login'); fillCredentials(); fireEvent.submit(document.querySelector('form'));
  fireEvent.click(await screen.findByRole('button', { name: 'Resend verification email' }));
  await waitFor(() => expect(authRequest).toHaveBeenLastCalledWith('send-verification-email', { email: 'fixture@example.test', callbackURL: window.location.origin + '/account' }, 'en'));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email'); expect(document.querySelector('form')).toBeNull();
});

test('forgot-password keeps the generic account-existence response', async () => {
  authRequest.mockResolvedValue({}); renderAuth('/forgot-password');
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'unknown@example.test' } }); fireEvent.submit(document.querySelector('form'));
  expect(await screen.findByRole('status')).toHaveTextContent('If this address has an account'); expect(document.querySelector('form')).toBeNull();
});

test('French account and password recovery remain localized', async () => {
  localStorage.setItem('cq-lang', 'fr'); accountRequest.mockResolvedValue({ ...account, keys: [key] });
  const view = render(<LangProvider><AccountPage /></LangProvider>);
  expect(await screen.findByRole('progressbar', { name: 'Utilisés' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Révoquer Monthly report' })); expect(screen.getByRole('dialog', { name: 'Révoquer cette clé API ?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' })); view.unmount();
  render(<LangProvider><MemoryRouter initialEntries={['/reset-password']}><AuthPage /></MemoryRouter></LangProvider>);
  expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/forgot-password');
});
