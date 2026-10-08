import { beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LangProvider } from '../i18n.jsx';
import PricingPage from './PricingPage.jsx';
import { accountRequest, hasAccountSession } from '../api/account.js';
import { createRequire } from 'node:module';
const { PLANS, CREDIT_COSTS, WORKFLOW_COSTS, BUSINESS_PRICE } = createRequire(import.meta.url)('../../../server/services/commercialConfig.js');
vi.mock('../api/account.js', () => ({ accountRequest: vi.fn(), hasAccountSession: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); hasAccountSession.mockResolvedValue(false); });
const plans = { enabled: true, mode: 'live', checkout: false, plans: PLANS, business_price: BUSINESS_PRICE, credit_costs: CREDIT_COSTS, workflow_costs: WORKFLOW_COSTS };
const mount = () => render(<LangProvider><PricingPage /></LangProvider>);

test.each([['en', 'Go to account'], ['fr', 'Accéder au compte']])('signed-in Free visitors open their account in %s', async (lang, label) => {
  localStorage.setItem('cq-lang', lang);
  accountRequest.mockResolvedValue({ ...plans, checkout: true });
  hasAccountSession.mockResolvedValue(true);
  mount();
  expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', '/account');
  expect(document.querySelector('a[href="/signup"]')).toBeNull();
  expect(accountRequest.mock.calls.every(([path]) => path === '/plans')).toBe(true);
});

test('unknown and unavailable sessions keep a neutral account link without affecting plan availability', async () => {
  let reject;
  hasAccountSession.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  accountRequest.mockResolvedValue(plans);
  mount();
  expect(await screen.findByRole('link', { name: 'Developer account' })).toHaveAttribute('href', '/account');
  await act(async () => reject(new Error('offline')));
  expect(await screen.findByRole('link', { name: 'Developer account' })).toHaveAttribute('href', '/account');
  expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
});

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
  expect(screen.getByText('CA$9/month')).toBeVisible();
  expect(screen.getByText('100,000 credits per paid billing cycle')).toBeVisible();
  expect(accountRequest.mock.calls.every(([path, options]) => path === '/plans' && !options.method)).toBe(true);
});

test.each([['en', 'CA$12.50/month'], ['fr', '12,50 $ CA/mois']])('uses the returned monthly CAD price in %s', async (lang, price) => {
  localStorage.setItem('cq-lang', lang);
  accountRequest.mockResolvedValue({ ...plans, checkout: true, business_price: { currency: 'cad', amount: 1250, interval: 'month' } });
  mount();
  expect(await screen.findByText(price)).toBeVisible();
  expect(document.body).not.toHaveTextContent('49');
});

test('missing or unexpected price metadata cannot advertise a purchase amount or enable checkout', async () => {
  accountRequest.mockResolvedValue({ ...plans, checkout: true, business_price: { currency: 'usd', amount: 900, interval: 'month' } });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Plan availability could not be loaded');
  expect(screen.queryByRole('link', { name: 'Choose Business' })).toBeNull();
  expect(screen.queryByText('CA$9/month')).toBeNull();
});

test('costs stay grouped with labels and the example is inert', async () => {
  accountRequest.mockResolvedValue(plans);
  mount();
  await screen.findByRole('link', { name: 'Create an account' });
  for (const [label, cost] of [['Metadata, a row query or one vector tile', '1'], ['A CSV export, up to 10,000 rows', '25'], ['Admission of a new preparation job', '100']]) {
    expect(screen.getByText(label).parentElement.querySelector('dd')).toHaveTextContent(cost);
  }
  expect(document.querySelector('pre code').textContent).toContain('filters={"Year/Année":2024,"Family/Famille":"Chironomidae"}');
  expect(screen.getByRole('link', { name: /Follow preparation, querying and reuse/ })).toHaveAttribute('href', '/docs#preparation-example');
  expect(accountRequest).toHaveBeenCalledTimes(1);
});

test('offer and workflow totals use the returned configuration without inventing enterprise guarantees', async () => {
  accountRequest.mockResolvedValue({ ...plans, plans: { ...PLANS, free: { ...PLANS.free, credits: 1234 } }, credit_costs: { ...CREDIT_COSTS, preparation: 101 }, workflow_costs: { ...WORKFLOW_COSTS, prepare: 104 } });
  mount();
  expect(await screen.findByText('1,234 credits per UTC calendar month')).toBeVisible();
  expect(screen.getByText('104')).toBeVisible();
  expect(screen.getByText('Admission of a new preparation job').parentElement.querySelector('dd')).toHaveTextContent('101');
  expect(screen.getByText(/Business primarily adds a larger allowance/)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Custom & Enterprise' })).toBeNull();
  expect(document.querySelectorAll('.cq-pricing-plan')).toHaveLength(2);
  expect(screen.getByText(/one existing supported resource and one working query/)).toBeVisible();
  expect(screen.getByText(/returned once to the original payer/)).toBeVisible();
});
