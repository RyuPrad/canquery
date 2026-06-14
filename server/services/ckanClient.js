const { fetchWithBackoff } = require('../utils/fetchWithBackoff');
const AppError = require('../utils/AppError');

const BASE = process.env.CKAN_BASE_URL || 'https://open.canada.ca/data/api/3/action';
const USER_AGENT = process.env.CKAN_USER_AGENT || 'canquery/1.0';

async function ckanAction(action, params) {
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
    const url = BASE + '/' + action + '?' + searchParams;
    const response = await fetchWithBackoff(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json'
        },
        timeoutMs: 30000
    });
    if (!response.ok) {
        throw new AppError('CKAN upstream returned ' + response.status + ' for ' + action, 502);
    }
    const body = await response.json();
    if (body.success === false) {
        throw new AppError('CKAN action ' + action + ' failed', 502);
    }
    return body.result;
}

async function packageSearch({ q, fq, rows, start, sort } = {}) {
    return ckanAction('package_search', { q, fq, rows, start, sort });
}

async function packageShow(id) {
    return ckanAction('package_show', { id });
}

async function packageList({ limit, offset } = {}) {
    return ckanAction('package_list', { limit, offset });
}

async function organizationList({ limit, offset, allFields } = {}) {
    return ckanAction('organization_list', { limit, offset, all_fields: allFields });
}

async function datastoreSearch({ resourceId, q, filters, limit, offset, sort } = {}) {
    return ckanAction('datastore_search', { resource_id: resourceId, q, filters, limit, offset, sort });
}

module.exports = { packageSearch, packageShow, packageList, organizationList, datastoreSearch };
