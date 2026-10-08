import { afterEach, test, expect, vi } from 'vitest';
import { fetchResource, queryResource, fetchOrganizations, recordResourceActivity, prepareResource } from './catalog.js';
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
