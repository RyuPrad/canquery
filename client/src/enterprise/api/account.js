export async function accountRequest(path = '', options = {}) {
  const response = await fetch('/api/account' + path, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Request failed'), { status: response.status, code: body.code });
  return body.data;
}
export async function authRequest(path, body, lang) {
  const response = await fetch('/api/auth/' + path, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': lang }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error('Authentication failed'), { code: data.code, status: response.status });
  return data;
}

// Public pages need only session presence, never account bootstrap or key data.
export async function hasAccountSession({ signal } = {}) {
  const response = await fetch('/api/auth/get-session', {
    credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Session lookup failed');
  const data = await response.json();
  if (data === null) return false;
  if (typeof data?.session?.id !== 'string' || !data.session.id ||
      typeof data?.user?.id !== 'string' || !data.user.id) {
    throw new Error('Invalid session response');
  }
  return true;
}
