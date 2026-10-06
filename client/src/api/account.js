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
