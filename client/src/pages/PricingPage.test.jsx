import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LangProvider } from '../i18n.jsx';
import PricingPage from './PricingPage.jsx';
import { accountRequest } from '../api/account.js';
vi.mock('../api/account.js', () => ({ accountRequest: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
const plans = { enabled: true, mode: 'live', checkout: false };
const mount = () => render(<LangProvider><PricingPage /></LangProvider>);

test.each([
  ['en', 'Free', 'Business', 'Create an account', 'Coming soon', 'Choose Business'],
  ['fr', 'Gratuit', 'Business', 'Créer un compte', 'Bientôt disponible', 'Choisir Business'],
])('Free launch remains actionable without implying paid checkout in %s', async (lang, free, business, signup, soon, upgrade) => {
  localStorage.setItem('cq-lang', lang);
  accountRequest.mockResolvedValue(plans);
  mount();
  const freeCard = screen.getByRole('heading', { name: free, exact: true }).closest('article');
  expect(await within(freeCard).findByRole('link', { name: signup })).toHaveAttribute('href', '/signup');
  const paidCard = screen.getByRole('heading', { name: business, exact: true }).closest('article');
  expect(within(paidCard).getByText(soon)).toBeVisible();
  const inquiry = within(paidCard).getByRole('link');
  expect(inquiry.href).toContain('mailto:support@canquery.com?subject=');
  expect(new URL(inquiry.href).searchParams.get('body')).toMatch(lang === 'en' ? /dataset or source/ : /données ou la source/);
  expect(screen.queryByRole('link', { name: upgrade })).toBeNull();
  expect(accountRequest).toHaveBeenCalledTimes(1);
});

test('loading and failure never relabel signup as contact, and retry restores signup', async () => {
  let reject;
  accountRequest.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(plans);
  mount();
  expect(screen.getAllByRole('button', { name: 'Checking availability…' })).toHaveLength(2);
  expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
  reject(new Error('offline'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Plan availability could not be loaded');
  expect(screen.getAllByRole('button', { name: 'Availability unavailable' }).every(button => button.disabled)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
});

test('enabled checkout links to account with clear monthly renewal and no checkout POST', async () => {
  accountRequest.mockResolvedValue({ ...plans, checkout: true });
  mount();
  expect(await screen.findByRole('link', { name: 'Choose Business' })).toHaveAttribute('href', '/account');
  expect(screen.getByText(/Renews monthly\. Cancel before renewal/)).toBeVisible();
  expect(accountRequest.mock.calls.every(([path, options]) => path === '/plans' && !options.method)).toBe(true);
});

test('costs stay grouped with labels and the example is inert', async () => {
  accountRequest.mockResolvedValue(plans);
  mount();
  await screen.findByRole('link', { name: 'Create an account' });
  for (const [label, cost] of [['Metadata, a row query or one vector tile', '1'], ['A CSV export, up to 10,000 rows', '25'], ['Admission of a new preparation job', '100']]) {
    expect(screen.getByText(label).parentElement.querySelector('dd')).toHaveTextContent(cost);
  }
  expect(document.querySelector('pre code').textContent).toContain('filters={"STREET_NAME":"KING"}');
  expect(screen.getByRole('link', { name: /Get the request, response and export steps/ })).toHaveAttribute('href', '/docs#workflow');
  expect(accountRequest).toHaveBeenCalledTimes(1);
});
