// What the /lmia pages read: the summary of every loaded quarter of the positive
// LMIA employers list, employer search and one employer's history (migration 050,
// loaded by scripts/build-lmia-history.js). Shared by the website's JSON routes
// (routes/lmia.js) and the HTML the server renders for those pages; answers are
// cached for five minutes in this process.
const { createCache } = require('../utils/cache');
const queries = require('../db/lmiaQueries');
const { employerKey } = require('../utils/employerKey');
const { LMIA_DATASET_ID, PROVINCE_CODES } = require('./lmiaHistory');
const AppError = require('../utils/AppError');

const PAGE_SIZE = 50;
const MAX_PAGE = 200;
const HISTORY_LIMIT = 3000;
const cache = createCache({ name: 'lmia', ttlMs: 5 * 60 * 1000, negativeTtlMs: 60 * 1000, maxEntries: 500 });

// An employer key ("danchar construction") in a path: words joined by hyphens.
const slugOf = key => key.replace(/ /g, '-');
function keyOfSlug(slug) {
    const key = typeof slug === 'string' ? slug.replace(/-/g, ' ') : '';
    return /^[a-z0-9]+( [a-z0-9]+)*$/.test(key) && key.length <= 200 ? key : null;
}

function invalid(message) {
    const error = new AppError(message, 400);
    error.publicCode = 'INVALID_QUERY';
    return error;
}

// The search a request asks for: q is matched by its employer key, so "DANCHAR
// LTD." finds danchar; province is a code; occupation a NOC 2011 or 2021 code.
function searchInput(query = {}) {
    const one = name => {
        const value = query[name];
        if (value === undefined || value === '') return null;
        if (typeof value !== 'string') throw invalid(`Give ${name} once`);
        return value.trim();
    };
    const q = one('q') || '';
    if (q.length > 100) throw invalid('Search with up to 100 characters');
    const province = one('province');
    if (province !== null && !PROVINCE_CODES.includes(province)) throw invalid('Choose a province code');
    const occupation = one('occupation');
    if (occupation !== null && !/^\d{4,5}$/.test(occupation)) throw invalid('Give an occupation as a 4- or 5-digit NOC code');
    // Without a name, province or occupation the search would list every employer.
    if (!employerKey(q) && province === null && occupation === null) throw invalid('Search by name, province or occupation');
    const pageText = one('page');
    const page = pageText === null ? 1 : Number(pageText);
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) throw invalid(`Choose a page from 1 to ${MAX_PAGE}`);
    return { q, key: employerKey(q), province, occupation, page };
}

async function summary(deps = queries) {
    return cache.get('summary', async () => {
        const found = await deps.getLmiaSummary();
        if (!found) return null;
        return { dataset_id: LMIA_DATASET_ID, ...found,
            top_employers: found.top_employers.map(row => ({ ...row, slug: slugOf(row.employer_key) })) };
    });
}

async function search(input, deps = queries) {
    const { key, province, occupation, page } = input;
    return cache.get(JSON.stringify(['search', key, province, occupation, page]), async () => {
        const found = await deps.searchLmiaEmployers({ key, province, occupation, limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE });
        return { total: found.total, page, page_size: PAGE_SIZE, max_page: MAX_PAGE,
            rows: found.rows.map(row => ({ ...row, slug: slugOf(row.employer_key) })) };
    });
}

// One employer's lines grouped by period, newest first: positions, LMIAs, streams,
// occupations with their positions, and addresses.
function employerDetail(key, rows) {
    if (!rows.length) return null;
    const periods = [];
    const names = [];
    const provinces = new Set();
    for (const row of rows) {
        let period = periods[periods.length - 1];
        if (!period || period.period_key !== row.period_key) {
            period = { period_key: row.period_key, kind: row.period_kind, start: row.period_start, end: row.period_end,
                resource_id: row.resource_id, positions: 0, lmias: null, provinces: [], streams: [], occupations: [], addresses: [] };
            periods.push(period);
        }
        period.positions += row.approved_positions;
        if (row.approved_lmias !== null) period.lmias = (period.lmias || 0) + row.approved_lmias;
        if (row.province && !period.provinces.includes(row.province)) period.provinces.push(row.province);
        if (row.stream && !period.streams.includes(row.stream)) period.streams.push(row.stream);
        if (row.province) provinces.add(row.province);
        if (!names.includes(row.employer)) names.push(row.employer);
        if (row.occupation_code) {
            const found = period.occupations.find(item => item.code === row.occupation_code);
            if (found) found.positions += row.approved_positions;
            else period.occupations.push({ code: row.occupation_code, title: row.occupation_title, noc_version: row.noc_version,
                positions: row.approved_positions });
        }
        if (row.address && !period.addresses.some(item => item.address === row.address)) {
            period.addresses.push({ address: row.address, city: row.city, province: row.province });
        }
    }
    for (const period of periods) period.occupations.sort((a, b) => b.positions - a.positions || a.code.localeCompare(b.code));
    const lmias = periods.filter(period => period.lmias !== null);
    return {
        key, slug: slugOf(key), name: names[0], names, provinces: [...provinces].sort(),
        first_period: periods[periods.length - 1].period_key, last_period: periods[0].period_key,
        positions: periods.reduce((sum, period) => sum + period.positions, 0),
        lmias: lmias.length ? lmias.reduce((sum, period) => sum + period.lmias, 0) : null,
        truncated: rows.length >= HISTORY_LIMIT, periods
    };
}

async function employer(slug, deps = queries) {
    const key = keyOfSlug(slug);
    if (!key) return null;
    return cache.get('employer:' + key, async () =>
        employerDetail(key, await deps.getLmiaEmployerRows(key, { limit: HISTORY_LIMIT })));
}

module.exports = { PAGE_SIZE, MAX_PAGE, slugOf, keyOfSlug, searchInput, summary, search, employer, employerDetail, cache };
