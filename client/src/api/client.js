const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

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
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || null;
  }
}

export class NotFoundError extends ApiError {}

export class NotIngestedError extends ApiError {
  constructor(message, status, body) {
    super(body?.hint || message, status, body);
  }
}

export class FileOnlyError extends ApiError {
  constructor(message, status, body) {
    super(message, status, body);
    this.download_url = body?.download_url;
  }
}

// A datastore (proxied) resource was asked for a filter the upstream can't do
// (anything beyond equality). The client uses this to transparently upgrade the
// resource into local storage, where the full filter grammar works.
export class DatastoreFilterError extends ApiError {}

export async function getJSON(path, params) {
  const res = await fetch(apiUrl(path, params));
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const message = body && body.error ? body.error : 'Request failed (' + res.status + ')';
  if (res.ok) {
    return body;
  }
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

export async function postJSON(path) {
  const res = await fetch(apiUrl(path), { method: 'POST' });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const message = body && body.error ? body.error : 'Request failed (' + res.status + ')';
  if (res.ok) {
    return body;
  }
  if (res.status === 404) {
    throw new NotFoundError(message, 404, body);
  }
  if (res.status === 409) {
    throw new NotIngestedError(message, 409, body);
  }
  if (res.status === 422) {
    throw new FileOnlyError(message, 422, body);
  }
  throw new ApiError(message, res.status, body);
}
