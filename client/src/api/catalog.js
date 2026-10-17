import { getJSON, postJSON } from './client.js';
import { resourceResponse, queryResponse, previewResponse, listResponse, datasetListResponse, profileResponse, jobResponse, preparationResponse } from './responseContracts.js';
import { normalizeResource } from './resourceEnvelope.js';

const DATASET_PARAMS = ['q', 'org', 'format', 'keyword', 'place', 'source', 'level', 'mappable', 'queryable', 'sort', 'lang', 'facets', 'limit', 'cursor'];

// Lists become repeated keys (format=CSV&format=PDF), which the API matches
// as "any of". The fixed order keeps equivalent requests byte-identical.
export function datasetSearchPath(params = {}) {
  const search = new URLSearchParams();
  for (const key of DATASET_PARAMS) {
    const value = params[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== '' && item !== false) search.append(key, String(item));
    }
  }
  const query = search.toString();
  return '/web-api/v1/datasets' + (query ? '?' + query : '');
}

export function searchDatasets(params = {}, options = {}) {
  return getJSON(datasetSearchPath(params), undefined, { ...options, validate: datasetListResponse });
}

export function fetchDataset(idOrName) {
  return getJSON('/web-api/v1/datasets/' + encodeURIComponent(idOrName));
}

export async function fetchResource(id, options) {
  const result = await getJSON('/web-api/v1/resources/' + encodeURIComponent(id), undefined, { ...options, validate: resourceResponse });
  normalizeResource(result.data);
  return result;
}

export function queryResource(id, { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket, snapshot } = {}, options) {
  return getJSON('/web-api/v1/resources/' + encodeURIComponent(id) + '/query', { q, filters, sort, limit, offset, group_by, agg, agg_column, bucket, snapshot }, { ...options, validate: queryResponse });
}

export function fetchResourcePreview(id, options) {
  return getJSON('/web-api/v1/resources/' + encodeURIComponent(id) + '/preview', undefined, { ...options, validate: previewResponse });
}

export function fetchResourceProfile(id, options = {}) {
  return getJSON('/web-api/v1/resources/' + encodeURIComponent(id) + '/profile', { snapshot: options.snapshot }, { ...options, validate: profileResponse });
}

export function prepareResource(id) {
  return postJSON('/web-api/v1/resources/' + encodeURIComponent(id) + '/prepare', { validate: preparationResponse });
}

export function recordResourceActivity(id, options) {
  return postJSON('/web-api/v1/resources/' + encodeURIComponent(id) + '/activity', { ...options, allowNoContent: true });
}

export function enqueueIngest(id) {
  return postJSON('/web-api/v1/resources/' + encodeURIComponent(id) + '/ingest');
}

export function fetchJob(id, options) {
  return getJSON('/web-api/v1/jobs/' + encodeURIComponent(id), undefined, { ...options, validate: jobResponse });
}

export function fetchOrganizations({ q, place, source, limit, cursor } = {}, options) {
  return getJSON('/web-api/v1/organizations', { q, place, source, limit, cursor }, { ...options, validate: listResponse });
}

export function fetchOrganization(name) {
  return getJSON('/web-api/v1/organizations/' + encodeURIComponent(name));
}

export function fetchPlaces({ q, kind, parent, featured, limit, cursor } = {}) {
  return getJSON('/web-api/v1/places', { q, kind, parent, featured, limit, cursor });
}

export async function fetchFeaturedPlaces() {
  const data = [];
  const seenCursors = new Set();
  let cursor;
  let meta = {};

  do {
    const env = await fetchPlaces({ featured: true, limit: 100, cursor });
    data.push(...(env.data || []));
    meta = env.meta || meta;
    const nextCursor = env.pagination?.nextCursor || null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('Featured place pagination returned a repeated cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return { data, pagination: { nextCursor: null }, meta };
}

// Every place with open data (the directory's full set), for grouping by province.
export async function fetchAllPlaces() {
  const data = [];
  const seenCursors = new Set();
  let cursor;
  do {
    const env = await fetchPlaces({ limit: 100, cursor });
    data.push(...(env.data || []));
    const nextCursor = env.pagination?.nextCursor || null;
    if (nextCursor && seenCursors.has(nextCursor)) throw new Error('Place pagination returned a repeated cursor');
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return { data, pagination: { nextCursor: null } };
}

export function fetchPlace(idOrSlug) {
  return getJSON('/web-api/v1/places/' + encodeURIComponent(idOrSlug));
}

export function fetchSources({ place } = {}, options) {
  return getJSON('/web-api/v1/sources', { place }, { ...options, validate: listResponse });
}

export function fetchResourceMap(id, { bbox, zoom, limit, signal } = {}) {
  return getJSON(
    '/web-api/v1/resources/' + encodeURIComponent(id) + '/map',
    { bbox, zoom, limit },
    { signal }
  );
}

export async function fetchRecentlyUnlocked(limit, place) {
  try {
    return await getJSON('/web-api/v1/resources/recently-unlocked', { limit, place });
  } catch {
    return null;
  }
}

export async function fetchTopDownloads(lang = 'en') {
  try {
    return await getJSON('/web-api/v1/insights/top-downloads?lang=' + encodeURIComponent(lang));
  } catch {
    return null;
  }
}

export async function fetchFeatured(lang = 'en', options) {
  try {
    return await getJSON('/web-api/v1/insights/featured?lang=' + encodeURIComponent(lang), undefined, options);
  } catch {
    return null;
  }
}

export async function fetchPopular(place) {
  try {
    return await getJSON('/web-api/v1/resources/popular', { place });
  } catch {
    return null;
  }
}

export async function fetchStats() {
  try {
    return await getJSON('/web-api/v1/stats');
  } catch {
    return null;
  }
}

export function fetchBlog({ lang = 'en', place, dataset } = {}) {
  return getJSON('/web-api/v1/blog', { lang, place, dataset });
}

export function fetchBlogArticle(lang, slug) {
  return getJSON('/web-api/v1/blog/' + encodeURIComponent(lang) + '/' + encodeURIComponent(slug));
}
