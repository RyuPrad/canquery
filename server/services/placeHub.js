// A place page is a landing page for "<place> open data": the dataset list
// plus the publishers, official portals, popular and recently prepared tables
// and nearby places. The dataset list is the page, so its read must succeed;
// every other read is optional, runs inside a short budget, and leaves its
// section empty when it fails or runs late, so a crawl of every place never
// queues behind a slow count.
const catalogReadCache = require('./catalogReadCache');
const { normalizeDatasetSearch } = require('./catalogService');
const { withinBudget } = require('../utils/timeBudget');
const { PAGE_SIZE } = require('./catalogPagination');

const SECTION_BUDGET_MS = 1500;
const SECTION_LIMIT = 12;
const TABLE_LIMIT = 6;

const optional = read => withinBudget(Promise.resolve().then(read).catch(() => null), SECTION_BUDGET_MS);
const cached = (key, read) => catalogReadCache.get(key, read);

function searchArgs(slug, overrides) {
    return { q: null, org: null, format: null, keyword: null, place: slug, source: null, mappable: null,
        limit: PAGE_SIZE + 1, offset: 0, ...overrides };
}

async function loadPlaceHub(place, { page = 1, offset = 0, deps }) {
    const slug = place.slug || place.id;
    const datasets = await deps.searchDatasets(searchArgs(slug, { offset }));
    const hub = { datasets, facets: null, organizations: [], sources: [], popular: [], recent: [], siblings: [] };
    if (page > 1) return hub;
    const has = name => typeof deps[name] === 'function';
    const reads = [
        ['facets', has('datasetFacets') ? () => deps.datasetFacets(normalizeDatasetSearch({ place: slug, lang: 'en' })) : null],
        ['organizations', has('listOrganizations')
            ? () => deps.listOrganizations({ q: null, source: null, place: slug, limit: SECTION_LIMIT, offset: 0 }) : null],
        ['sources', has('listSources') ? () => deps.listSources({ place: slug }) : null],
        ['popular', has('listPopularResources')
            ? () => cached('hub-popular:' + slug, () => deps.listPopularResources({ days: 7, limit: TABLE_LIMIT, place: slug })) : null],
        ['recent', has('listRecentlyIngested')
            ? () => cached('hub-recent:' + slug, () => deps.listRecentlyIngested(TABLE_LIMIT, slug)) : null],
        ['siblings', has('listPlaces') && place.parent_id
            ? () => deps.listPlaces({ q: null, kind: null, parent: place.parent_id, featured: true, limit: SECTION_LIMIT + 1, offset: 0 }) : null]
    ];
    // Two batches keep connections free for other requests.
    for (const batch of [reads.slice(0, 3), reads.slice(3)]) {
        const values = await Promise.all(batch.map(([, read]) => (read ? optional(read) : Promise.resolve(null))));
        batch.forEach(([name], index) => {
            const value = values[index];
            if (name === 'facets') hub.facets = value && value.facets ? value : null;
            else hub[name] = Array.isArray(value) ? value : [];
        });
    }
    hub.siblings = hub.siblings.filter(row => row && row.id !== place.id).slice(0, SECTION_LIMIT);
    return hub;
}

module.exports = { loadPlaceHub, SECTION_BUDGET_MS, SECTION_LIMIT, TABLE_LIMIT };
