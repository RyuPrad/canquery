import { getJSON, postJSON } from './client.js';

export function searchDatasets({ q, org, format, keyword, limit, cursor } = {}) {
  return getJSON('/api/v1/datasets', { q, org, format, keyword, limit, cursor });
}

export function fetchDataset(idOrName) {
  return getJSON('/api/v1/datasets/' + encodeURIComponent(idOrName));
}

export function fetchResource(id) {
  return getJSON('/api/v1/resources/' + encodeURIComponent(id));
}

export function queryResource(id, { q, filters, sort, limit, offset } = {}) {
  return getJSON('/api/v1/resources/' + encodeURIComponent(id) + '/query', { q, filters, sort, limit, offset });
}

export function enqueueIngest(id) {
  return postJSON('/api/v1/resources/' + encodeURIComponent(id) + '/ingest');
}

export function fetchJob(id) {
  return getJSON('/api/v1/jobs/' + encodeURIComponent(id));
}

export function fetchOrganizations({ limit, cursor } = {}) {
  return getJSON('/api/v1/organizations', { limit, cursor });
}

export async function fetchRecentlyUnlocked() {
  try {
    return await getJSON('/api/v1/resources/recently-unlocked');
  } catch {
    return null;
  }
}

export async function fetchStats() {
  try {
    return await getJSON('/api/v1/stats');
  } catch {
    return null;
  }
}
