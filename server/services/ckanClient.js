const { fetchWithBackoff } = require('../utils/fetchWithBackoff');
const AppError = require('../utils/AppError');

const BASE = process.env.CKAN_BASE_URL || 'https://open.canada.ca/data/api/3/action';
const USER_AGENT = process.env.CKAN_USER_AGENT || 'canquery/1.0';

// `maxRetries` and `timeoutMs` default to fetchWithBackoff's budget and 30 s; a
// caller that must not linger on a busy host (the row sampler) lowers them.
async function ckanAction(action, params, { baseUrl = BASE, signal, maxRetries, timeoutMs = 30000 } = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === null || value === undefined) {
            continue;
        }
        let val = value;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            val = JSON.stringify(value);
        }
        searchParams.set(key, val);
    }
    const url = String(baseUrl).replace(/\/+$/, '') + '/' + action + '?' + searchParams;
    const response = await fetchWithBackoff(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json'
        },
        timeoutMs, signal, ...(maxRetries === undefined ? {} : { maxRetries })
    });
    if (!response.ok) {
        await response.body?.cancel();
        const error = new AppError('CKAN upstream returned ' + response.status + ' for ' + action, 502);
        error.upstreamStatus = response.status;
        throw error;
    }
    const body = await response.json();
    if (body.success === false) {
        throw new AppError('CKAN action ' + action + ' failed', 502);
    }
    return body.result;
}

async function packageSearch({ q, fq, rows, start, sort, baseUrl } = {}) {
    return ckanAction('package_search', { q, fq, rows, start, sort }, { baseUrl });
}

async function packageShow(id, { baseUrl } = {}) {
    return ckanAction('package_show', { id }, { baseUrl });
}

async function packageList({ limit, offset, baseUrl } = {}) {
    return ckanAction('package_list', { limit, offset }, { baseUrl });
}

async function organizationList({ limit, offset, allFields, baseUrl } = {}) {
    return ckanAction('organization_list', { limit, offset, all_fields: allFields }, { baseUrl });
}

async function datastoreSearch({ resourceId, q, filters, limit, offset, sort, baseUrl, signal, maxRetries, timeoutMs } = {}) {
    return ckanAction('datastore_search', { resource_id: resourceId, q, filters, limit, offset, sort },
        { baseUrl, signal, maxRetries, timeoutMs });
}

module.exports = { ckanAction, packageSearch, packageShow, packageList, organizationList, datastoreSearch };
