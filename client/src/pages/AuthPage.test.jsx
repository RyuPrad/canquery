import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import AuthPage from './AuthPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { accountRequest, authRequest, hasAccountSession } from '../api/account.js';

vi.mock('../api/account.js', () => ({ accountRequest: vi.fn(), authRequest: vi.fn(), hasAccountSession: vi.fn() }));
const replace = vi.fn();
const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  hasAccountSession.mockReset().mockResolvedValue(false);
  authRequest.mockResolvedValue({});
  accountRequest.mockResolvedValue({ enabled: true, terms_version: '2026-10-07' });
  const actualWindow = window;
  vi.stubGlobal('window', new Proxy(actualWindow, {
    get(target, key) {
      if (key === 'location') return { origin: actualWindow.location.origin, search: '', replace, assign };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = (path = '/login') => render(<MemoryRouter initialEntries={[path]}><LangProvider><AuthPage /></LangProvider></MemoryRouter>);

test.each(['/login', '/signup'])('signed-in %s visits replace the document with the account page without submitting forms', async path => {
  hasAccountSession.mockResolvedValue(true);
  mount(path);
  await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith('/account'));
  expect(screen.queryByRole('textbox', { name: 'Email address' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Opening your account');
  expect(accountRequest).not.toHaveBeenCalled();
  expect(authRequest).not.toHaveBeenCalled();
});

test.each(['/login', '/signup'])('anonymous %s retains its form after the lookup', async path => {
  mount(path);
  expect(screen.queryByRole('textbox', { name: 'Email address' })).toBeNull();
  expect(await screen.findByRole('textbox', { name: 'Email address' })).toBeVisible();
  expect(replace).not.toHaveBeenCalled();
  if (path === '/signup') expect(await screen.findByRole('checkbox')).toBeEnabled();
});

test('a failed session lookup offers retry without implying sign-out', async () => {
  hasAccountSession.mockRejectedValueOnce(new Error('offline'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session could not be checked');
  expect(screen.queryByRole('textbox', { name: 'Email address' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('textbox', { name: 'Email address' })).toBeVisible();
});

test('login drafts survive a visibility recheck and still submit normally', async () => {
  mount();
  const email = await screen.findByRole('textbox', { name: 'Email address' });
  fireEvent.change(email, { target: { value: 'fixture@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password-only' } });
  await act(async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(email).not.toBeVisible();
  await act(async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(email).toBeVisible();
  expect(email).toHaveValue('fixture@example.test');
  fireEvent.submit(email.closest('form'));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/account'));
  expect(authRequest).toHaveBeenCalledWith('sign-in/email', { email: 'fixture@example.test', password: 'fixture-password-only' }, 'en');
});

test.each(['/forgot-password', '/reset-password'])('%s keeps its recovery flow without an authentication redirect', async path => {
  hasAccountSession.mockResolvedValue(true);
  mount(path);
  expect(hasAccountSession).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  if (path === '/forgot-password') expect(screen.getByRole('textbox', { name: 'Email address' })).toBeVisible();
  else expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
});
