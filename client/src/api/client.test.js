import { apiUrl, getJSON, postJSON, ApiError, ApiProtocolError, NotFoundError, NotIngestedError, FileOnlyError, DatastoreFilterError } from './client.js';

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })));
}

describe('api client', () => {
  test.each([getJSON, postJSON])('%s rejects malformed successful responses at the boundary', async request => {
    for (const body of [null, [], {}, { error: 'not really a success' }, { data: [], meta: [] }]) {
      stubFetch(200, body);
      await expect(request('/ok')).rejects.toBeInstanceOf(ApiProtocolError);
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('html'); } })));
    await expect(request('/ok')).rejects.toMatchObject({ name: 'ApiProtocolError', code: 'INVALID_API_RESPONSE', status: 200 });
    stubFetch(200, { data: null });
    await expect(request('/repo')).resolves.toEqual({ data: null });
  });

  test('no-content is accepted only by an explicitly declared endpoint', async () => {
    stubFetch(204, null);
    await expect(postJSON('/activity', { allowNoContent: true })).resolves.toBeNull();
    await expect(postJSON('/prepare')).rejects.toBeInstanceOf(ApiProtocolError);
  });

  test('POST retains HTTP errors and dated Retry-After when a proxy sends HTML', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429,
      headers: { get: () => 'Thu, 01 Jan 2026 00:00:30 GMT' },
      json: async () => { throw new SyntaxError('html'); },
    })));
    await expect(postJSON('/prepare')).rejects.toMatchObject({ status: 429, retryAfter: 30 });
    vi.restoreAllMocks();
  });

  test('aborting response consumption retains cancellation semantics', async () => {
    const error = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw error; } })));
    await expect(getJSON('/resource')).rejects.toBe(error);
  });
  test('GET errors retain Retry-After even when the JSON response omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429,
      headers: { get: name => name === 'Retry-After' ? '30' : null },
      json: async () => ({ error: 'Too many requests' }),
    })));
    const error = await getJSON('/api/v1/jobs/7').catch(error => error);
    expect(error.retryAfter).toBe(30);
  });
  test('apiUrl skips empty params and serializes objects', () => {
    expect(apiUrl('/api/v1/datasets', { q: 'water', org: undefined, format: '', limit: 5 })).toBe('/api/v1/datasets?q=water&limit=5');
    expect(apiUrl('/x', { filters: { a: 1 } })).toBe('/x?filters=' + encodeURIComponent(JSON.stringify({ a: 1 })));
  });

  test('getJSON resolves the envelope on success', async () => {
    stubFetch(200, { data: [1], pagination: { nextCursor: null }, meta: {} });
    await expect(getJSON('/ok')).resolves.toEqual({ data: [1], pagination: { nextCursor: null }, meta: {} });
  });

  test('getJSON throws typed errors', async () => {
    stubFetch(404, { error: 'Dataset not found' });
    await expect(getJSON('/x')).rejects.toBeInstanceOf(NotFoundError);

    stubFetch(409, { error: 'not ingested', hint: 'POST /api/v1/resources/r/ingest' });
    await expect(getJSON('/x')).rejects.toBeInstanceOf(NotIngestedError);

    stubFetch(422, { error: 'file only', download_url: 'https://e.org/f.pdf' });
    const err = await getJSON('/x').catch(e => e);
    expect(err).toBeInstanceOf(FileOnlyError);
    expect(err.download_url).toBe('https://e.org/f.pdf');
  });

  test('a datastore filter rejection (400 + ingest_for_filters hint) is typed for the auto-upgrade', async () => {
    stubFetch(400, { error: 'Only equality filters are supported for datastore resources', hint: 'ingest_for_filters' });
    await expect(getJSON('/x')).rejects.toBeInstanceOf(DatastoreFilterError);
  });

  test('a plain 400 stays a generic ApiError, not a datastore upgrade signal', async () => {
    stubFetch(400, { error: 'invalid sort' });
    const err = await getJSON('/x').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(DatastoreFilterError);
  });
});
