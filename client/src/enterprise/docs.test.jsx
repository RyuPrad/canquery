// Hosted parts of /docs: the session-aware account action, account and key
// steps, keyed examples, credit workflows and the hosted reference wording.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import DocsPage from '../pages/DocsPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { accountRequest, hasAccountSession } from './api/account.js';
vi.mock('./api/account.js', () => ({ accountRequest: vi.fn(), hasAccountSession: vi.fn() }));

const { buildOpenApi } = createRequire(import.meta.url)('../../../server/services/openApi.js');
const { PLANS, CREDIT_COSTS, WORKFLOW_COSTS } = createRequire(import.meta.url)('../../../server/enterprise/services/commercialConfig.js');
const spec = { openapi: '3.1.0', servers: [{ url: '/api/v1' }], paths: {} };
const response = value => Promise.resolve({ ok: true, json: async () => value });

beforeEach(() => {
  hasAccountSession.mockReset().mockResolvedValue(false);
  accountRequest.mockResolvedValue({ plans: PLANS, credit_costs: CREDIT_COSTS, workflow_costs: WORKFLOW_COSTS });
  vi.stubGlobal('fetch', vi.fn(() => response(spec)));
});
afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

test.each([
  ['en', true, 'Manage API keys', '/account'], ['fr', true, 'Gérer les clés API', '/account'],
  ['en', false, 'Get a free API key', '/signup'], ['fr', false, 'Obtenir une clé API gratuite', '/signup'],
])('docs account action follows the %s session (%s)', async (lang, signedIn, label, href) => {
  localStorage.setItem('cq-lang', lang);
  hasAccountSession.mockResolvedValue(signedIn);
  render(<LangProvider><DocsPage /></LangProvider>);
  expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', href);
  expect(accountRequest.mock.calls.every(([path]) => path === '/plans')).toBe(true);
});

test('docs keep a neutral account action while session lookup is pending or fails', async () => {
  let reject;
  hasAccountSession.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<DocsPage />);
  expect(screen.getByRole('link', { name: 'Developer account' })).toHaveAttribute('href', '/account');
  await act(async () => reject(new Error('offline')));
  expect(screen.getByRole('link', { name: 'Developer account' })).toHaveAttribute('href', '/account');
  expect(screen.queryByRole('link', { name: 'Get a free API key' })).toBeNull();
});

test('quickstart starts with the account and key steps, and credit workflows follow the preparation example', async () => {
  render(<DocsPage />);
  expect([...document.querySelectorAll('.cq-doc-steps > li')].map(step => step.querySelector('h3').textContent))
    .toEqual(['Create and verify your account', 'Set a server-side environment variable', 'Search the catalogue']);
  const section = document.getElementById('preparation-example');
  expect(await within(section).findByText('103')).toBeInTheDocument();
  expect(within(section).getByText(/112 credits/)).toBeInTheDocument();
  expect(document.querySelector('#reliability a[href="/pricing"]')).toHaveTextContent('Plans & credits');
});

test('examples carry the API key header and environment variable', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<DocsPage />);
  const group = screen.getByRole('group', { name: 'Search housing datasets · Example language' });
  fireEvent.click(within(group).getByRole('button', { name: 'JavaScript · server' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy Search housing datasets' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('process.env.CANQUERY_API_KEY')));
  await act(async () => {});
});

test.each([
  { enabled: true, keyRequired: true },
  { enabled: false, keyRequired: false },
])('first-request advice stays accurate when enabled=$enabled and keyRequired=$keyRequired', async ({ enabled, keyRequired }) => {
  const actual = buildOpenApi({ env: { COMMERCIAL_API_ENABLED: String(enabled), API_KEY_REQUIRED_AT: '2026-10-01T00:00:00.000Z' }, now: Date.parse('2026-10-07T00:00:00.000Z') });
  fetch.mockImplementationOnce(() => response(actual));
  render(<DocsPage />);
  const operation = actual.paths['/datasets'].get;
  const endpoint = (await screen.findByText(operation.summary, { selector: '.cq-doc-operation-name span' })).closest('details');
  expect(screen.getByText(/Authentication requirements depend on this deployment/)).toBeInTheDocument();
  expect(screen.queryByText(/Anonymous compatibility is currently available/)).not.toBeInTheDocument();
  fireEvent.click(endpoint.querySelector('summary'));
  const publicMessage = 'Public endpoint; no API key required.';
  if (keyRequired) {
    await within(endpoint).findByText(/Use your server-side API key/);
    expect(within(endpoint).queryByText(publicMessage)).not.toBeInTheDocument();
    expect(endpoint.querySelector('pre').textContent).toContain('Authorization: Bearer');
  } else {
    await within(endpoint).findByText(publicMessage);
    expect(endpoint.querySelector('pre').textContent).not.toContain('Authorization');
  }
});
