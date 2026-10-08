import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import DocsPage from './DocsPage.jsx';
import { LangProvider } from '../i18n.jsx';
import { accountRequest, hasAccountSession } from '../api/account.js';
vi.mock('../api/account.js', () => ({ accountRequest: vi.fn(), hasAccountSession: vi.fn() }));

const { buildOpenApi } = createRequire(import.meta.url)('../../../server/services/openApi.js');
const { PLANS, CREDIT_COSTS, WORKFLOW_COSTS } = createRequire(import.meta.url)('../../../server/services/commercialConfig.js');

const spec = {
  openapi: '3.1.0', servers: [{ url: '/api/v1' }], security: [{ bearerAuth: [] }],
  tags: [{ name: 'Discovery', 'x-display-name-fr': 'Découverte' }, { name: 'Preparation', 'x-display-name-fr': 'Préparation' }],
  paths: {
    '/datasets': { get: { operationId: 'listDatasets', tags: ['Discovery'], summary: 'Search the catalogue', 'x-summary-fr': 'Rechercher dans le catalogue', description: 'Search indexed dataset metadata.', 'x-description-fr': 'Rechercher les métadonnées indexées.', 'x-credit-cost': 1,
      parameters: [{ name: 'limit', in: 'query', description: 'Page size', 'x-description-fr': 'Taille de page', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }],
      responses: { 200: { $ref: '#/components/responses/Datasets' } } } },
    '/resources/{id}/prepare': { post: { operationId: 'prepareResource', tags: ['Preparation'], summary: 'Prepare an eligible file', 'x-summary-fr': 'Préparer un fichier admissible', 'x-credit-cost': '100 new job / 0 existing',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 202: { description: 'Job accepted', 'x-description-fr': 'Tâche acceptée', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } } } } },
  },
  components: {
    responses: {
      Datasets: {
        description: 'Catalogue results', 'x-description-fr': 'Résultats du catalogue',
        headers: { 'X-Request-Id': { $ref: '#/components/headers/RequestId' } },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' }, example: { data: [], pagination: { nextCursor: null }, meta: { source: 'canquery' } } } },
      },
    },
    headers: { RequestId: { description: 'Correlation identifier.', 'x-description-fr': 'Identifiant de corrélation.', schema: { type: 'string' } } },
    schemas: {
      Envelope: {
        type: 'object', required: ['data'],
        properties: {
          data: { type: 'array', items: { type: 'object' }, description: 'Dataset summaries.' },
          pagination: { type: 'object', properties: { nextCursor: { type: ['string', 'null'] } } },
        },
      },
    },
  },
};
const response = value => Promise.resolve({ ok: true, json: async () => value });

beforeEach(() => {
  hasAccountSession.mockReset().mockResolvedValue(false);
  accountRequest.mockResolvedValue({ plans: PLANS, credit_costs: CREDIT_COSTS, workflow_costs: WORKFLOW_COSTS });
  vi.stubGlobal('fetch', vi.fn(() => response(spec)));
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

test('preparation demonstration preserves source context, bounded recipes and credit distinctions', async () => {
  render(<DocsPage />);
  const section = document.getElementById('preparation-example');
  expect(within(section).getByRole('link', { name: /Original public CSV/ })).toHaveAttribute('href', 'https://cabin-rcba.ec.gc.ca/Cabin/opendata/cabin_benthic_data_mda09_1987-present.csv');
  expect(within(section).getByText(/not exposed through the federal CKAN DataStore/)).toBeInTheDocument();
  expect(within(section).getByText(/not a live production result/)).toBeInTheDocument();
  expect(within(section).getByText(/A timeout does not cancel the shared job/)).toBeInTheDocument();
  const languages = within(section).getByRole('group', { name: 'Complete bounded preparation recipe · Example language' });
  expect(within(languages).queryByRole('button', { name: 'curl' })).toBeNull();
  expect(within(languages).getByRole('button', { name: 'Python' })).toHaveAttribute('aria-pressed', 'true');
  expect(await within(section).findByText('103')).toBeInTheDocument();
  expect(within(section).getByText(/112 credits/)).toBeInTheDocument();
  expect(fetch.mock.calls.every(([url, options]) => !url.endsWith('/query') && !url.endsWith('/prepare') && !options?.method)).toBe(true);
});
afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

test.each([
  ['en', '/blog/toronto-building-permits', '/blog/uxbridge-ward-boundaries-map'],
  ['fr', '/fr/blog/permis-construction-toronto', '/fr/blog/carte-limites-quartiers-uxbridge'],
])('links to the matching %s guide editions without querying resources', async (lang, permits, map) => {
  localStorage.setItem('cq-lang', lang);
  render(<LangProvider><DocsPage /></LangProvider>);
  expect(document.querySelector('#workflow a[href="' + permits + '"]')).toBeInTheDocument();
  expect(document.querySelector('#reference a[href="' + map + '"]')).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/openapi.json');
});

test('loads only OpenAPI until an explicitly requested anonymous metadata preview', async () => {
  render(<DocsPage />);
  expect(await screen.findByText('Search the catalogue', { selector: '.cq-doc-operation-name span' })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/openapi.json');
  fetch.mockImplementationOnce(() => response({ data: { id: 'permit-resource', query_mode: 'datastore' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview metadata anonymously' }));
  expect(await screen.findByText(/"query_mode": "datastore"/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toMatch(/^\/web-api\/v1\/resources\/ckan-toronto/);
  expect(fetch.mock.calls[1][1]).not.toHaveProperty('headers');
  expect(fetch.mock.calls.every(([url, options]) => !url.endsWith('/query') && !url.endsWith('/prepare') && !options?.method)).toBe(true);
});

test('guides remain useful when the reference fails and Retry recovers it', async () => {
  fetch.mockRejectedValueOnce(new Error('offline'));
  render(<DocsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The endpoint reference could not be loaded');
  expect(screen.getByRole('heading', { name: 'Build a repeatable report extract' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Build a reliable integration' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Search the catalogue', { selector: '.cq-doc-operation-name span' })).toBeInTheDocument();
});

test('reference resolves schemas and headers, searches parameters and preserves permanent anchors', async () => {
  window.history.replaceState(null, '', '/docs#listDatasets');
  render(<DocsPage />);
  const title = await screen.findByText('Search the catalogue', { selector: '.cq-doc-operation-name span' });
  const endpoint = title.closest('details');
  expect(endpoint.id).toBe('listDatasets');
  expect(endpoint).toHaveAttribute('open');
  expect(within(endpoint).getByText('Maximum:')).toBeInTheDocument();
  expect(within(endpoint).getByText('Page size')).toBeInTheDocument();
  const status = within(endpoint).getByText('Catalogue results').closest('details');
  fireEvent.click(status.querySelector('summary'));
  fireEvent.click(within(status).getByText('Response headers'));
  fireEvent.click(within(status).getAllByText('Response schema')[0]);
  expect(within(status).getByText('X-Request-Id')).toBeInTheDocument();
  expect(within(status).getByText('Correlation identifier.')).toBeInTheDocument();
  expect(within(status).getAllByRole('columnheader', { name: 'Field' })[0]).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find an endpoint' }), { target: { value: 'limit' } });
  expect(screen.getByText('1 endpoint')).toBeInTheDocument();
  expect(screen.queryByText('Prepare an eligible file')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find an endpoint' }), { target: { value: 'no-such-endpoint' } });
  expect(screen.getByText(/No endpoints match/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('2 endpoints')).toBeInTheDocument();
});

test('code language selection updates the copied example and reports clipboard failures', async () => {
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<DocsPage />);
  await screen.findByText('Search the catalogue', { selector: '.cq-doc-operation-name span' });
  const group = screen.getByRole('group', { name: 'Search housing datasets · Example language' });
  fireEvent.click(within(group).getByRole('button', { name: 'Python' }));
  expect(within(group).getByRole('button', { name: 'Python' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Copy Search housing datasets' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('from urllib.request import Request, urlopen')));
  fireEvent.click(within(group).getByRole('button', { name: 'JavaScript · server' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy Search housing datasets' }));
  expect(await screen.findByText('Clipboard unavailable. Select the code below and copy it manually.')).toBeVisible();
  expect(writeText.mock.calls[1][0]).toContain('process.env.CANQUERY_API_KEY');
});

test('French guides and reference descriptions follow the chosen language', async () => {
  localStorage.setItem('cq-lang', 'fr');
  render(<LangProvider><DocsPage /></LangProvider>);
  expect(screen.getByRole('heading', { name: /Documentation de l/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Envoyez votre première requête' })).toBeInTheDocument();
  expect(await screen.findByText('Rechercher dans le catalogue', { selector: '.cq-doc-operation-name span' })).toBeInTheDocument();
  expect(screen.getByText('Découverte')).toBeInTheDocument();
  expect(screen.queryByText('Search the catalogue', { selector: '.cq-doc-operation-name span' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Rechercher dans le catalogue', { selector: '.cq-doc-operation-name span' }));
  expect(await screen.findByText('Taille de page')).toBeInTheDocument();
});

test('mobile contents exposes a controlled region and closes on navigation', async () => {
  render(<DocsPage />);
  const trigger = screen.getByRole('button', { name: 'On this page' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const region = document.getElementById(trigger.getAttribute('aria-controls'));
  fireEvent.click(within(region).getByRole('link', { name: 'A reporting workflow' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(region).toHaveAttribute('hidden');
  await act(async () => {});
});

test('public operations preserve zero credits and an operation-level root server', async () => {
  fetch.mockImplementationOnce(() => response({ ...spec, paths: { '/healthz': { get: {
    operationId: 'health', tags: ['Operations'], summary: 'Health probe', servers: [{ url: '/' }], security: [], 'x-credit-cost': 0, responses: { 200: { description: 'Healthy' } },
  } } } }));
  render(<DocsPage />);
  const endpoint = (await screen.findByText('Health probe')).closest('details');
  fireEvent.click(endpoint.querySelector('summary'));
  expect(await within(endpoint).findByText('Public endpoint; no API key required.')).toBeInTheDocument();
  expect(within(endpoint).getByText('Credits:', { exact: false })).toHaveTextContent('Credits: 0');
  const example = endpoint.querySelector('pre').textContent;
  expect(example).toContain(`${window.location.origin}/healthz`);
  expect(example).not.toContain('/api/v1/healthz');
  expect(example).not.toContain('Authorization');
});

test('response examples can switch between rows and aggregates without fetching data', async () => {
  const variant = structuredClone(spec);
  const content = variant.components.responses.Datasets.content['application/json'];
  delete content.example;
  content.examples = { rows: { value: { data: { records: [{ STREET_NAME: 'KING' }] } } }, aggregate: { value: { data: { records: [{ key: 'KING', value: 12 }] } } } };
  fetch.mockImplementationOnce(() => response(variant));
  render(<DocsPage />);
  const endpoint = (await screen.findByText('Search the catalogue', { selector: '.cq-doc-operation-name span' })).closest('details');
  fireEvent.click(endpoint.querySelector('summary'));
  const status = await within(endpoint).findByText('Catalogue results');
  fireEvent.click(status.closest('summary'));
  const exampleGroup = within(endpoint).getByRole('group', { name: 'Example response · illustrative' });
  fireEvent.click(within(exampleGroup).getByRole('button', { name: 'aggregate' }));
  expect(within(exampleGroup).getByRole('button', { name: 'aggregate' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(endpoint).getByText(/"value": 12/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
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

function expandSchemaField(container, name) {
  const table = container.querySelector(':scope > .cq-doc-table-scroll > table');
  const row = [...table.tBodies[0].rows].find(item => item.cells[0].querySelector('code').textContent === name);
  expect(row, `field ${name}`).toBeDefined();
  const nested = row.querySelector(':scope > td:nth-child(3) > details');
  expect(nested, `expandable field ${name}`).not.toBeNull();
  fireEvent.click(nested.querySelector(':scope > summary'));
  return nested;
}

async function openActualResponseSchema(path) {
  const actual = buildOpenApi({ env: { COMMERCIAL_API_ENABLED: 'true' } });
  fetch.mockImplementationOnce(() => response(actual));
  render(<DocsPage />);
  const operation = actual.paths[path].get;
  const endpoint = (await screen.findByText(operation.summary, { selector: '.cq-doc-operation-name span' })).closest('details');
  fireEvent.click(endpoint.querySelector('summary'));
  await within(endpoint).findByText(/Use your server-side API key/);
  const status = endpoint.querySelector('.cq-doc-response');
  fireEvent.click(status.querySelector(':scope > summary'));
  const rootSchema = status.querySelector('.cq-doc-content-schema > .cq-doc-recipe');
  fireEvent.click(rootSchema.querySelector(':scope > summary'));
  return rootSchema;
}

test('real Resource schema exposes nullable ingestion, maps, licence fields and nullable array items', async () => {
  const schema = await openActualResponseSchema('/resources/{id}');
  const resource = expandSchemaField(schema, 'data');
  const ingestion = expandSchemaField(resource, 'ingestion');
  expect(within(ingestion).getByText('ingested_at', { selector: 'code' })).toBeVisible();
  expect(within(ingestion).getByText('last_accessed_at', { selector: 'code' })).toBeVisible();
  const columns = expandSchemaField(ingestion, 'columns');
  expect(within(columns).getByText('id', { selector: 'code' })).toBeVisible();
  expect(within(columns).getByText('type', { selector: 'code' })).toBeVisible();
  const map = expandSchemaField(resource, 'map');
  expect(within(map).getByText('geometry_type', { selector: 'code' })).toBeVisible();
  expect(within(map).getByText('tiles', { selector: 'code' })).toBeVisible();
  const provenance = expandSchemaField(resource, 'provenance');
  const license = expandSchemaField(provenance, 'primary_license');
  expect(within(license).getByText('attribution', { selector: 'code' })).toBeVisible();
  expect(within(license).getByText('url', { selector: 'code' })).toBeVisible();
});

test('recursive Place schema remains bounded while exposing child fields', async () => {
  const schema = await openActualResponseSchema('/places/{idOrSlug}');
  const place = expandSchemaField(schema, 'data');
  const child = expandSchemaField(place, 'children');
  const grandchild = expandSchemaField(child, 'children');
  const row = [...grandchild.querySelector('table').tBodies[0].rows].find(item => item.cells[0].querySelector('code').textContent === 'children');
  expect(row).toHaveTextContent('object[]');
  expect(row.querySelector('details')).toBeNull();
});
