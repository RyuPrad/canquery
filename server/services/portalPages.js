// What the /portals page reads: the directory of every open-data portal
// CanQuery mirrors, with the datasets it holds from each, how many of them
// have a table or a map here, the portal's licence, place and last refresh.
// Shared by the website's JSON route (routes/portals.js) and the HTML the
// server renders for the page; the answer is cached for ten minutes in this
// process, about as often as the counts can change (sources sync once a day,
// the federal catalogue every half hour).
const { createCache } = require('../utils/cache');
const queries = require('../db/catalogReadQueries');
const { sources } = require('../config/catalogSources');

// The federal portal's records are placed by their own jurisdiction, so the
// portal itself belongs to no province or city, and the registry lists none.
const FEDERAL_SOURCE_ID = 'open-canada';

// Each portal's own place: the one its registry entry names, or names first
// when the portal also carries a wider area's or a neighbour's records (a
// city's portal with its region's layers, a region's with its cities').
function homePlaces(registry = sources) {
    return registry
        .map(source => [source.id, source.placeId || (Array.isArray(source.placeRules) && source.placeRules[0] ? source.placeRules[0].placeId : null)])
        .filter(([id, place]) => typeof id === 'string' && typeof place === 'string' && place !== '');
}
// The catalogue software behind a portal, by the kind of its source. A kind
// that is not listed (a city's own catalogue) is shown as "other".
const PLATFORMS = Object.freeze({ ckan: 'CKAN', 'arcgis-hub': 'ArcGIS Hub', socrata: 'Socrata', opendatasoft: 'Opendatasoft' });
const LEVELS = Object.freeze(['federal', 'provincial', 'municipal']);
const cache = createCache({ name: 'portals', ttlMs: 10 * 60 * 1000, negativeTtlMs: 60 * 1000, maxEntries: 4 });

const names = (en, fr) => ({ en: en || fr || null, fr: fr || en || null });
const iso = value => {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
// A link the page may print: http(s) only, no credentials.
function httpUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

function levelOf(row) {
    if (row.id === FEDERAL_SOURCE_ID) return 'federal';
    if (row.place_kind === 'province' || row.place_kind === 'territory') return 'provincial';
    if (row.place_kind === 'region' || row.place_kind === 'municipality') return 'municipal';
    return null;
}

function portalOf(row) {
    const licenceTitle = row.default_license_title_en || row.default_license_title_fr;
    return {
        id: row.id,
        platform: Object.hasOwn(PLATFORMS, row.kind) ? row.kind : 'other',
        name: names(row.name_en, row.name_fr),
        homepage_url: httpUrl(row.homepage_url),
        level: levelOf(row),
        place: row.place_slug ? { slug: row.place_slug, name: names(row.place_name_en, row.place_name_fr) } : null,
        province: row.province_slug ? { slug: row.province_slug, name: names(row.province_name_en, row.province_name_fr) } : null,
        datasets: Number(row.dataset_count) || 0,
        tables: Number(row.table_count) || 0,
        maps: Number(row.map_count) || 0,
        // A portal whose records each carry their own licence has no default one.
        licence: licenceTitle ? { title: names(row.default_license_title_en, row.default_license_title_fr),
            url: httpUrl(row.default_license_url) } : null,
        last_synced_at: iso(row.last_synced_at)
    };
}

// Portals and datasets per group, largest first; `key` names the group.
function tally(portals, key, order = null) {
    const groups = new Map();
    for (const portal of portals) {
        const value = key(portal);
        if (value == null) continue;
        const group = groups.get(value.id) || { ...value, portals: 0, datasets: 0 };
        group.portals += 1;
        group.datasets += portal.datasets;
        groups.set(value.id, group);
    }
    const rows = [...groups.values()];
    return order
        ? rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        : rows.sort((a, b) => b.portals - a.portals || b.datasets - a.datasets || String(a.id).localeCompare(String(b.id)));
}

// null while no portal has a dataset here (a catalogue that has not synced):
// the page then says so and stays out of the index.
function shape(rows) {
    const portals = (rows || []).filter(row => Number(row.dataset_count) > 0).map(portalOf);
    if (!portals.length) return null;
    const synced = portals.map(portal => portal.last_synced_at).filter(Boolean).sort();
    return {
        portals,
        totals: {
            portals: portals.length,
            // A dataset two portals list counts once in the catalogue.
            datasets: Number(rows[0].catalogue_datasets) || 0,
            provinces: new Set(portals.map(portal => portal.province && portal.province.slug).filter(Boolean)).size
        },
        platforms: tally(portals, portal => ({ id: portal.platform })),
        levels: tally(portals, portal => (portal.level ? { id: portal.level } : null), LEVELS),
        provinces: tally(portals, portal => (portal.province ? { id: portal.province.slug, name: portal.province.name } : null))
            .sort((a, b) => a.name.en.localeCompare(b.name.en)),
        updated_at: synced.length ? synced[synced.length - 1] : null
    };
}

async function directory(deps = queries) {
    return cache.get('directory', async () => shape(await deps.listPortalDirectory({ homes: homePlaces() })));
}

const PORTALS_META = Object.freeze({ license: null, upstream: null });

module.exports = { directory, shape, homePlaces, cache, FEDERAL_SOURCE_ID, PLATFORMS, LEVELS, PORTALS_META };
