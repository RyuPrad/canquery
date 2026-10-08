const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/** @param {string} path @param {Record<string, unknown>} [params] */
export function apiUrl(path, params) {
  let url = API_BASE + path;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) {
      url += '?' + qs;
    }
  }
  return url;
}

export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {import('./contracts').ApiErrorBody | null} [body] */
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || null;
    this.retryAfter = Number(body?.retry_after) || null;
  }
}

export class NotFoundError extends ApiError {}

export class NotIngestedError extends ApiError {
  /** @param {string} message @param {number} status @param {import('./contracts').ApiErrorBody | null} [body] */
  constructor(message, status, body) {
    super(body?.hint || message, status, body);
  }
}

export class FileOnlyError extends ApiError {
  /** @param {string} message @param {number} status @param {import('./contracts').ApiErrorBody | null} [body] */
  constructor(message, status, body) {
    super(message, status, body);
    this.download_url = body?.download_url;
  }
}

// A datastore (proxied) resource was asked for a filter the upstream can't do
// (anything beyond equality). The client uses this to transparently upgrade the
// resource into local storage, where the full filter grammar works.
export class DatastoreFilterError extends ApiError {}

export class ApiProtocolError extends ApiError {
  /** @param {number} status */
  constructor(status) {
    super('The server returned an invalid response. Please try again.', status, null);
    this.name = 'ApiProtocolError';
    this.code = 'INVALID_API_RESPONSE';
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Transport errors retain their HTTP meaning even when a proxy sends HTML.
// Successful catalogue responses must satisfy the envelope contract instead
// of turning a decoding error into null and failing later in a component.
/** @param {Response} res @param {import('./contracts').ApiRequestOptions} [options] */
async function decodeResponse(res, { allowNoContent = false, validate } = {}) {
  if (res.ok && res.status === 204 && allowNoContent) return null;
  let body = null;
  try {
    body = await res.json();
  } catch (error) {
    if (isObject(error) && error.name === 'AbortError') throw error;
    if (res.ok) throw new ApiProtocolError(res.status);
  }
  if (res.ok) {
    if (
      !isObject(body) ||
      !Object.hasOwn(body, 'data') ||
      (body.meta !== undefined && !isObject(body.meta)) ||
      (body.pagination !== undefined && !isObject(body.pagination)) ||
      (validate && !validate({ ...body, data: body.data }))
    )
      throw new ApiProtocolError(res.status);
    return body;
  }
  if (!isObject(body)) body = null;
  const retryHeader = res.headers?.get('Retry-After');
  if (retryHeader && !body?.retry_after) {
    const seconds = /^\d+$/.test(retryHeader)
      ? Number(retryHeader)
      : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000);
    if (Number.isFinite(seconds) && seconds > 0) body = { ...body, retry_after: seconds };
  }
  const message =
    typeof body?.error === 'string' ? body.error : 'Request failed (' + res.status + ')';
  if (res.status === 404) {
    throw new NotFoundError(message, 404, body);
  }
  if (res.status === 409) {
    throw new NotIngestedError(message, 409, body);
  }
  if (res.status === 422) {
    throw new FileOnlyError(message, 422, body);
  }
  if (res.status === 400 && body?.hint === 'ingest_for_filters') {
    throw new DatastoreFilterError(message, 400, body);
  }
  throw new ApiError(message, res.status, body);
}

/** @param {string} path @param {Record<string, unknown>} [params] @param {import('./contracts').ApiRequestOptions} [options] */
export async function getJSON(path, params, options = {}) {
  const res = await fetch(apiUrl(path, params), { signal: options.signal });
  return decodeResponse(res, options);
}

/** @param {string} path @param {import('./contracts').ApiRequestOptions} [options] */
export async function postJSON(path, options = {}) {
  const res = await fetch(apiUrl(path), { method: 'POST', signal: options.signal });
  return decodeResponse(res, options);
}
