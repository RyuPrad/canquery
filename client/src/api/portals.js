import { getJSON } from './client.js';

// The /portals page's read: website only (/web-api/v1), cached for five minutes.
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const names = (value) => record(value) && typeof value.en === 'string' && typeof value.fr === 'string';
const count = (value) => Number.isInteger(value) && value >= 0;
const place = (value) => value === null || (record(value) && typeof value.slug === 'string' && names(value.name));

const portal = (value) =>
  record(value) && typeof value.id === 'string' && typeof value.platform === 'string' && names(value.name) &&
  (value.homepage_url === null || typeof value.homepage_url === 'string') &&
  (value.level === null || typeof value.level === 'string') && place(value.place) && place(value.province) &&
  count(value.datasets) && count(value.tables) && count(value.maps) &&
  (value.licence === null || (record(value.licence) && names(value.licence.title) &&
    (value.licence.url === null || typeof value.licence.url === 'string'))) &&
  (value.last_synced_at === null || typeof value.last_synced_at === 'string');

const group = (value) => record(value) && typeof value.id === 'string' && count(value.portals) && count(value.datasets);

/** Whether a response is the directory the page draws: at least one portal, and every group it shows. */
export const portalDirectoryResponse = ({ data }) =>
  record(data) && Array.isArray(data.portals) && data.portals.length > 0 && data.portals.every(portal) &&
  record(data.totals) && count(data.totals.portals) && count(data.totals.datasets) && count(data.totals.provinces) &&
  ['platforms', 'levels'].every((key) => Array.isArray(data[key]) && data[key].every(group)) &&
  Array.isArray(data.provinces) && data.provinces.every((row) => group(row) && names(row.name)) &&
  (data.updated_at === null || typeof data.updated_at === 'string');

/** @param {{ signal?: AbortSignal }} [options] */
export function fetchPortalDirectory(options = {}) {
  return getJSON('/web-api/v1/portals', undefined, { ...options, validate: portalDirectoryResponse });
}
