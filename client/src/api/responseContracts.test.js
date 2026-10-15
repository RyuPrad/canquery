import { afterEach, test, expect, vi } from 'vitest';
import { fetchResource, queryResource, fetchOrganizations, recordResourceActivity, prepareResource, searchDatasets } from './catalog.js';
import { ApiProtocolError } from './client.js';

afterEach(() => vi.unstubAllGlobals());
const respond = (data, meta = {}, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true, status, json: async () => ({ data, meta }),
})));

test('resource and row consumers reject malformed successful payloads before rendering', async () => {
  respond(null);
  await expect(fetchResource('r')).rejects.toBeInstanceOf(ApiProtocolError);
  respond({ id: 'r', query_mode: 'ingested', dataset: {}, ingestion: { fields: 'invalid' } });
  await expect(fetchResource('r')).rejects.toBeInstanceOf(ApiProtocolError);
  respond({ fields: [], records: null, total: 0 }, { query_mode: 'ingested' });
  await expect(queryResource('r')).rejects.toBeInstanceOf(ApiProtocolError);
  respond({ fields: [{ id: 'code', type: 'TEXT' }], records: [{ code: '0012' }], total: 1 }, { query_mode: 'ingested' });
  await expect(queryResource('r')).resolves.toMatchObject({ data: { total: 1 } });
});

test('scoped lists reject non-list data while current preparation and activity keep their contracts', async () => {
  respond({ arbitrary: true });
  await expect(fetchOrganizations()).rejects.toBeInstanceOf(ApiProtocolError);
  respond({ id: null, already_loaded: true, status: 'done' });
  await expect(prepareResource('r')).resolves.toMatchObject({ data: { already_loaded: true } });
  respond(null, {}, 204);
  await expect(recordResourceActivity('r')).resolves.toBeNull();
});

test('dataset searches accept optional counts and reject malformed ones', async () => {
  respond([{ id: 'd' }]);
  await expect(searchDatasets()).resolves.toMatchObject({ data: [{ id: 'd' }] });
  respond([], { total: null, facets: null });
  await expect(searchDatasets({ facets: true })).resolves.toMatchObject({ meta: { facets: null } });
  respond([], { total: 2, facets: { format: [{ value: 'CSV', count: 2 }], organization: [{ value: 'o', label: { en: null, fr: 'É' }, count: 1 }] } });
  await expect(searchDatasets({ facets: true })).resolves.toMatchObject({ meta: { total: 2 } });
  for (const meta of [{ total: -1 }, { total: 1.5 }, { facets: [] }, { facets: { format: [{ value: 'CSV' }] } }, { facets: { format: [{ value: 1, count: 1 }] } }]) {
    respond([], meta);
    await expect(searchDatasets({ facets: true })).rejects.toBeInstanceOf(ApiProtocolError);
  }
  respond({ not: 'a list' });
  await expect(searchDatasets()).rejects.toBeInstanceOf(ApiProtocolError);
});
