import { getJSON } from './client.js';

// The /lmia pages' reads: website only (/web-api/v1), cached for five minutes.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const summaryResponse = ({ data }) => record(data) && record(data.latest) && Array.isArray(data.periods);
const searchResponse = ({ data }) => record(data) && Array.isArray(data.rows) && Number.isInteger(data.total);
const employerResponse = ({ data }) => record(data) && typeof data.slug === 'string' && Array.isArray(data.periods);

/** @param {{ signal?: AbortSignal }} [options] */
export function fetchLmiaSummary(options = {}) {
  return getJSON('/web-api/v1/lmia/summary', undefined, { ...options, validate: summaryResponse });
}

/**
 * @param {{ q?: string, province?: string, occupation?: string, page?: number }} params
 * @param {{ signal?: AbortSignal }} [options]
 */
export function searchLmiaEmployers({ q, province, occupation, page } = {}, options = {}) {
  return getJSON('/web-api/v1/lmia/employers', {
    q: q || undefined,
    province: province || undefined,
    occupation: occupation || undefined,
    page: page && page > 1 ? page : undefined
  }, { ...options, validate: searchResponse });
}

/** @param {string} slug @param {{ signal?: AbortSignal }} [options] */
export function fetchLmiaEmployer(slug, options = {}) {
  return getJSON('/web-api/v1/lmia/employers/' + encodeURIComponent(slug), undefined, { ...options, validate: employerResponse });
}
