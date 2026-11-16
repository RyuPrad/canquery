jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn(), getCatalogLastModified: jest.fn(), listPortalDirectory: jest.fn(),
    // What the sitemap index reads beside the pages file.
    countSitemapDatasets: jest.fn(), countSitemapResources: jest.fn(), listDatasetSitemapChunkLastmods: jest.fn(),
    listResourceSitemapChunkLastmods: jest.fn(), listPlaceSitemap: jest.fn(), listOrganizationSitemap: jest.fn(),
    listNoindexResourceSitemap: jest.fn(), listShownNoindexDatasets: jest.fn(), listPolicyNoindexDatasets: jest.fn(),
    listPolicyNoindexResources: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), readStoreRows: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../db/pool', () => ({ query: jest.fn(), connect: jest.fn(), on: jest.fn(), end: jest.fn() }));

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const catalogRead = require('../db/catalogReadQueries');
const portals = require('../services/portalPages');
const seoMeta = require('../services/seoMeta');
const seoSnapshot = require('../services/seoSnapshot');
const { portalInitialData, INLINE_MAX_BYTES } = require('../services/portalInitialData');
const { serveSpa, resolvePage, INITIAL_DATA_ID } = require('../controllers/spaController');
const { resetSitemapCache } = require('../controllers/sitemapController');
const app = require('../app');

// What the directory query returns: one row per enabled source, largest first.
const row = fields => ({ kind: 'arcgis-hub', name_fr: null, default_license_title_en: null, default_license_title_fr: null,
    default_license_url: null, table_count: 0, map_count: 0, last_synced_at: null, place_slug: null, place_kind: null,
    place_name_en: null, place_name_fr: null, province_slug: null, province_name_en: null, province_name_fr: null,
    distinct_datasets: 64485, ...fields });
const ONTARIO = { province_slug: 'ontario', province_name_en: 'Ontario', province_name_fr: 'Ontario' };
const ROWS = [
    row({ id: 'open-canada', kind: 'ckan', name_en: 'Government of Canada Open Data', name_fr: 'Données ouvertes du gouvernement du Canada',
        homepage_url: 'https://open.canada.ca/data/en/', default_license_title_en: 'Open Government Licence – Canada',
        default_license_title_fr: 'Licence du gouvernement ouvert – Canada', default_license_url: 'https://open.canada.ca/en/open-government-licence-canada',
        dataset_count: 48310, table_count: 2104, map_count: 310, last_synced_at: new Date('2026-11-15T21:30:04Z') }),
    row({ id: 'toronto-open-data', kind: 'ckan', name_en: 'City of Toronto Open Data', homepage_url: 'https://open.toronto.ca/',
        default_license_title_en: 'Open Government Licence – Toronto', default_license_url: 'https://open.toronto.ca/open-data-license/',
        dataset_count: 556, table_count: 324, map_count: 157, last_synced_at: '2026-11-15T06:30:06.949Z',
        place_slug: 'toronto-on', place_kind: 'municipality', place_name_en: 'Toronto', place_name_fr: 'Toronto', ...ONTARIO }),
    row({ id: 'northwest-territories-open-data', kind: 'ckan', name_en: 'Northwest Territories Open Data',
        homepage_url: 'https://opendata.gov.nt.ca/', dataset_count: 340, map_count: 6, last_synced_at: '2026-11-14T07:09:25Z',
        place_slug: 'northwest-territories', place_kind: 'territory', place_name_en: 'Northwest Territories',
        place_name_fr: 'Territoires du Nord-Ouest', province_slug: 'northwest-territories', province_name_en: 'Northwest Territories',
        province_name_fr: 'Territoires du Nord-Ouest' }),
    row({ id: 'ottawa-hub', name_en: 'City of Ottawa Open Data', homepage_url: 'https://open.ottawa.ca/', dataset_count: 408, map_count: 390,
        default_license_title_en: 'Open Government Licence – City of Ottawa', default_license_url: 'https://ottawa.ca/en/open-data-licence',
        last_synced_at: '2026-11-15T06:31:39Z', place_slug: 'ottawa-on', place_kind: 'region', place_name_en: 'Ottawa', place_name_fr: 'Ottawa', ...ONTARIO }),
    row({ id: 'red-deer-hub', kind: 'red-deer', name_en: 'City of Red Deer <Open> & "Data"', homepage_url: 'javascript:alert(1)',
        default_license_title_en: 'OGL <b>Red Deer</b>', default_license_url: 'https://user:secret@example.test/licence', dataset_count: 12,
        table_count: 3, last_synced_at: 'not a date', place_slug: 'red-deer-ab', place_kind: 'municipality', place_name_en: 'Red Deer',
        province_slug: 'alberta', province_name_en: 'Alberta', province_name_fr: 'Alberta' }),
    // Enabled, nothing mirrored: it is not a portal the directory can say anything about.
    row({ id: 'empty-hub', name_en: 'Empty portal', homepage_url: 'https://empty.example/', dataset_count: 0 })
];

beforeEach(() => {
    jest.clearAllMocks();
    portals.cache.clear();
    resetSitemapCache();
    catalogRead.listPortalDirectory.mockResolvedValue(ROWS);
});

describe('portalPages', () => {
    test('shapes each portal from its source, its counts and the place it belongs to', () => {
        const directory = portals.shape(ROWS);
        expect(directory.portals.map(portal => portal.id)).toEqual(['open-canada', 'toronto-open-data', 'northwest-territories-open-data',
            'ottawa-hub', 'red-deer-hub']);
        expect(directory.portals[1]).toEqual({
            id: 'toronto-open-data', platform: 'ckan', name: { en: 'City of Toronto Open Data', fr: 'City of Toronto Open Data' },
            homepage_url: 'https://open.toronto.ca/', level: 'municipal',
            place: { slug: 'toronto-on', name: { en: 'Toronto', fr: 'Toronto' } },
            province: { slug: 'ontario', name: { en: 'Ontario', fr: 'Ontario' } },
            datasets: 556, tables: 324, maps: 157,
            licence: { title: { en: 'Open Government Licence – Toronto', fr: 'Open Government Licence – Toronto' }, url: 'https://open.toronto.ca/open-data-license/' },
            last_synced_at: '2026-11-15T06:30:06.949Z'
        });
        // The federal portal belongs to no place; a territory's portal is provincial-level; a region is municipal-level.
        expect(directory.portals[0]).toMatchObject({ level: 'federal', place: null, province: null,
            name: { en: 'Government of Canada Open Data', fr: 'Données ouvertes du gouvernement du Canada' },
            licence: { title: { en: 'Open Government Licence – Canada', fr: 'Licence du gouvernement ouvert – Canada' } },
            last_synced_at: '2026-11-15T21:30:04.000Z' });
        expect(directory.portals[2]).toMatchObject({ level: 'provincial', licence: null,
            place: { slug: 'northwest-territories' }, province: { slug: 'northwest-territories' } });
        expect(directory.portals[3]).toMatchObject({ level: 'municipal', platform: 'arcgis-hub' });
        // An address that is not a plain web address is never passed on; a kind the list does not know is "other".
        expect(directory.portals[4]).toMatchObject({ platform: 'other', homepage_url: null, last_synced_at: null,
            licence: { title: { en: 'OGL <b>Red Deer</b>', fr: 'OGL <b>Red Deer</b>' }, url: null } });
    });

    test('totals count a shared dataset once, and the groups say how the portals divide', () => {
        const directory = portals.shape(ROWS);
        // 48,310 + 556 + 340 + 408 + 12 would be 49,626: the catalogue's own distinct total is used.
        expect(directory.totals).toEqual({ portals: 5, datasets: 64485, provinces: 3 });
        expect(directory.levels).toEqual([{ id: 'federal', portals: 1, datasets: 48310 }, { id: 'provincial', portals: 1, datasets: 340 },
            { id: 'municipal', portals: 3, datasets: 976 }]);
        expect(directory.platforms).toEqual([{ id: 'ckan', portals: 3, datasets: 49206 }, { id: 'arcgis-hub', portals: 1, datasets: 408 },
            { id: 'other', portals: 1, datasets: 12 }]);
        expect(directory.provinces.map(group => [group.id, group.name.en, group.portals, group.datasets])).toEqual([
            ['alberta', 'Alberta', 1, 12], ['northwest-territories', 'Northwest Territories', 1, 340], ['ontario', 'Ontario', 2, 964]]);
        // The newest successful read of any portal dates the page.
        expect(directory.updated_at).toBe('2026-11-15T21:30:04.000Z');
        expect(portals.shape(ROWS.map(source => ({ ...source, last_synced_at: null }))).updated_at).toBeNull();
    });

    test('there is no directory until a portal has a dataset', () => {
        expect(portals.shape([])).toBeNull();
        expect(portals.shape(null)).toBeNull();
        expect(portals.shape([ROWS[5]])).toBeNull();
        expect(portals.shape([{ ...ROWS[1], dataset_count: '0' }])).toBeNull();
    });

    test('the directory is read once for ten minutes, with each portal\'s own place from the source registry', async () => {
        const first = await portals.directory();
        const second = await portals.directory();
        expect(second).toBe(first);
        expect(catalogRead.listPortalDirectory).toHaveBeenCalledTimes(1);
        const [{ homes }] = catalogRead.listPortalDirectory.mock.calls[0];
        expect(homes).toEqual(portals.homePlaces());
        portals.cache.clear();
        await portals.directory();
        expect(catalogRead.listPortalDirectory).toHaveBeenCalledTimes(2);
    });

    test('the directory is kept ten minutes, and "nothing mirrored" one minute', async () => {
        const start = Date.parse('2026-11-15T12:00:00Z');
        const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
        const reads = () => catalogRead.listPortalDirectory.mock.calls.length;
        try {
            await portals.directory();
            clock.mockReturnValue(start + 10 * 60 * 1000 - 1);
            await portals.directory();
            expect(reads()).toBe(1);
            clock.mockReturnValue(start + 10 * 60 * 1000);
            await portals.directory();
            expect(reads()).toBe(2);
            // A catalogue that has not been read yet is asked again sooner.
            portals.cache.clear();
            catalogRead.listPortalDirectory.mockClear();
            catalogRead.listPortalDirectory.mockResolvedValue([]);
            clock.mockReturnValue(start);
            expect(await portals.directory()).toBeNull();
            clock.mockReturnValue(start + 60 * 1000 - 1);
            await portals.directory();
            expect(reads()).toBe(1);
            clock.mockReturnValue(start + 60 * 1000);
            await portals.directory();
            expect(reads()).toBe(2);
        } finally {
            clock.mockRestore();
        }
    });

    test('a portal\'s own place is the one its registry entry names, or names first', () => {
        const homes = new Map(portals.homePlaces());
        // One place.
        expect(homes.get('toronto-open-data')).toBe('sgc-cd-3520');
        expect(homes.get('red-deer-hub')).toBe('sgc-csd-4808011');
        // A city's portal that also carries its region's and its province's layers: the city.
        expect(homes.get('oshawa-hub')).toBe('ca-on-oshawa');
        // A region's portal that also carries its cities' records: the region, though most records are a city's.
        expect(homes.get('waterloo-region-hub')).toBe('sgc-cd-3530');
        expect(homes.get('durham-hub')).toBe('ca-on-durham');
        // The federal portal is in no registry entry, so it has no place; every entry that is there has one.
        expect(homes.has(portals.FEDERAL_SOURCE_ID)).toBe(false);
        expect(portals.FEDERAL_SOURCE_ID).toBe('open-canada');
        const { sources } = require('../config/catalogSources');
        expect([...homes.keys()].sort()).toEqual(sources.map(source => source.id).sort());
        // Every entry that names several different places, with the one it names first: a new one is a choice to make here.
        expect(Object.fromEntries(sources.filter(source => !source.placeId && new Set(source.placeRules.map(rule => rule.placeId)).size > 1)
            .map(source => [source.id, source.placeRules[0].placeId]))).toEqual({
            'oshawa-hub': 'ca-on-oshawa', 'pickering-hub': 'sgc-csd-3518001', 'durham-hub': 'ca-on-durham',
            'waterloo-region-hub': 'sgc-cd-3530', 'markham-hub': 'sgc-csd-3519036'
        });
        // Entries a registry could hold without a place are left out, not passed on as empty.
        expect(portals.homePlaces([{ id: 'a', placeId: 'p1' }, { id: 'b', placeRules: [{ placeId: 'p2' }, { placeId: 'p3' }] },
            { id: 'c' }, { id: 'd', placeRules: [] }, { id: 'e', placeId: '' }, { placeId: 'p4' }])).toEqual([['a', 'p1'], ['b', 'p2']]);
    });
});

describe('GET /web-api/v1/portals', () => {
    test('answers the directory in the usual envelope, for the website only', async () => {
        const res = await request(app).get('/web-api/v1/portals');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        expect(res.headers['x-robots-tag']).toBe('noindex');
        expect(res.body.meta).toEqual({ source: 'canquery', license: null, upstream: null });
        expect(res.body.pagination).toEqual({ nextCursor: null });
        expect(res.body.data.totals).toEqual({ portals: 5, datasets: 64485, provinces: 3 });
        expect(res.body.data.portals).toHaveLength(5);
        expect(res.body.data.portals[0]).toMatchObject({ id: 'open-canada', datasets: 48310, tables: 2104, maps: 310, level: 'federal' });
        // Not part of the developer API or its contract.
        expect((await request(app).get('/api/v1/portals')).status).toBe(404);
        const contract = await request(app).get('/api/v1/openapi.json');
        expect(Object.keys(contract.body.paths).filter(route => route.includes('portal'))).toEqual([]);
    });

    test('answers 503 until a portal is mirrored, and when the catalogue cannot be read', async () => {
        catalogRead.listPortalDirectory.mockResolvedValue([]);
        const empty = await request(app).get('/web-api/v1/portals');
        expect(empty.status).toBe(503);
        expect(empty.body.code).toBe('PORTALS_UNAVAILABLE');
        portals.cache.clear();
        catalogRead.listPortalDirectory.mockRejectedValue(new Error('connection refused'));
        const down = await request(app).get('/web-api/v1/portals');
        // The public message is the generic one, as for any unexpected failure.
        expect(down.status).toBe(500);
        expect(down.body.error).toBe('Internal server error');
    });
});

describe('the /portals page', () => {
    let distDir;
    let spa;
    beforeAll(() => {
        distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-portals-'));
        fs.writeFileSync(path.join(distDir, 'index.html'),
            '<!doctype html><html><head><!-- seo:start --><title>x</title><!-- seo:end --></head><body><div id="root"></div></body></html>');
        spa = express();
        spa.get(/.*/, serveSpa(distDir));
    });
    afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));
    const block = text => {
        const match = new RegExp('<script type="application/json" id="' + INITIAL_DATA_ID + '">([\\s\\S]*?)</script>').exec(text);
        return match ? JSON.parse(match[1]) : null;
    };

    test('is indexable and says what CanQuery mirrors from every portal', async () => {
        const res = await request(spa).get('/portals');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>Canadian open data portals: 5 catalogues compared - CanQuery</title>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/portals"');
        expect(res.text).not.toContain('noindex');
        expect(res.text.match(/<h1>/g)).toHaveLength(1);
        expect(res.text).toContain('<h1>Canadian open data portals</h1>');
        expect(res.text).toContain('CanQuery mirrors 5 Canadian open data portals: 1 federal, 1 provincial or territorial and 3 municipal ' +
            'or regional, 64,485 datasets in all.');
        const description = /<meta name="description" content="([^"]*)"/.exec(res.text)[1];
        expect(description).toBe('Compare 5 Canadian open data portals: the datasets, live tables, maps, licence and last refresh of ' +
            'each government catalogue CanQuery mirrors.');
        expect(description.length).toBeLessThanOrEqual(160);
        // It promises no level of government: no province's own portal is mirrored today, and a snippet must not say one is.
        for (const meta of [seoMeta.portalsMeta(await portals.directory()), seoMeta.portalsMeta(portals.shape([ROWS[0]])), seoMeta.portalsMeta(null)]) {
            expect(meta.description).not.toMatch(/federal|provincial|territorial|municipal/i);
        }
        // One row per portal: its official site, its place on CanQuery, what is mirrored, its licence and the day it was read.
        expect(res.text).toContain('<tr><th scope="row"><a href="https://open.toronto.ca/">City of Toronto Open Data</a></th>' +
            '<td><a href="/places/toronto-on">Toronto</a>, Ontario</td><td>CKAN</td><td>556</td><td>324</td>' +
            '<td>157</td><td><a href="https://open.toronto.ca/open-data-license/">Open Government Licence – Toronto</a></td><td>2026-11-15</td></tr>');
        expect(res.text).toContain('<th scope="row"><a href="https://open.canada.ca/data/en/">Government of Canada Open Data</a></th>' +
            '<td>Canada</td><td>CKAN</td><td>48,310</td><td>2,104</td><td>310</td>');
        // A territory is its own province: its name is not repeated. No default licence: each dataset carries its own.
        expect(res.text).toContain('<td><a href="/places/northwest-territories">Northwest Territories</a></td>' +
            '<td>CKAN</td><td>340</td><td>0</td><td>6</td><td>Set on each dataset</td><td>2026-11-14</td>');
        // The level of government has its own table: the main one does not repeat it on every row.
        expect(res.text).toContain('<th scope="col">Place</th><th scope="col">Platform</th>');
        expect(res.text).toContain('<td>ArcGIS Hub</td><td>408</td>');
        expect(res.text).not.toContain('Empty portal');
        expect(res.text.match(/<tr><th scope="row">/g).length).toBe(5 + 3 + 3 + 3);
        // The groups, and what the numbers mean.
        expect(res.text).toContain('<h2>Portals by level of government</h2>');
        expect(res.text).toContain('<tr><th scope="row">Municipal and regional</th><td>3</td><td>976</td></tr>');
        expect(res.text).toContain('<h2>Portals by platform</h2>');
        expect(res.text).toContain('<tr><th scope="row">CKAN</th><td>3</td><td>49,206</td></tr>');
        expect(res.text).toContain('<tr><th scope="row">Other</th><td>1</td><td>12</td></tr>');
        expect(res.text).toContain('<h2>Portals by province or territory</h2>');
        expect(res.text).toContain('<tr><th scope="row">Ontario</th><td>2</td><td>964</td></tr>');
        expect(res.text).toContain('<h2>What the numbers mean</h2>');
        for (const paragraph of seoSnapshot.PORTALS_METHOD) expect(res.text).toContain(seoMeta.escapeHtml(paragraph));
        expect(res.text).toContain('<a href="/about#data-sources">How CanQuery reads its sources</a>');
        expect(res.text).toContain('<dt>Last read</dt><dd>2026-11-15</dd>');
    });

    test('prints names and licences as recorded, escaped, and links only plain web addresses', async () => {
        const res = await request(spa).get('/portals');
        const body = res.text.slice(res.text.indexOf('<div id="root">'), res.text.indexOf('<script type="application/json"'));
        expect(body).toContain('<th scope="row">City of Red Deer &lt;Open&gt; &amp; &quot;Data&quot;</th>');
        expect(body).toContain('<td>OGL &lt;b&gt;Red Deer&lt;/b&gt;</td><td></td></tr>');
        expect(body).not.toContain('javascript:');
        expect(body).not.toContain('user:secret');
        expect(body).not.toMatch(/<b>|<Open>/);
        // The embedded data and the structured data carry the same refusals.
        expect(res.text).not.toContain('javascript:');
        expect(res.text).not.toContain('user:secret');
        const head = res.text.slice(0, res.text.indexOf('</head>'));
        expect(head.match(/<\/script>/g)).toHaveLength(head.match(/<script/g).length);
    });

    test('names every portal as a data catalogue in its structured data', async () => {
        const meta = seoMeta.portalsMeta(await portals.directory());
        // A collection page whose main entity is the list, as the place and organization hubs are.
        expect(meta.jsonLd.map(item => item['@type'])).toEqual(['BreadcrumbList', 'CollectionPage']);
        expect(meta.jsonLd[1]).toMatchObject({ '@context': 'https://schema.org', name: 'Canadian open data portals',
            url: 'https://canquery.com/portals', description: meta.description });
        const list = meta.jsonLd[1].mainEntity;
        expect(list).toMatchObject({ '@type': 'ItemList', numberOfItems: 5 });
        expect(list.itemListElement).toHaveLength(5);
        expect(list.itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2,
            item: { '@type': 'DataCatalog', name: 'City of Toronto Open Data', url: 'https://open.toronto.ca/' } });
        // No address is better than one that is not a web address.
        expect(list.itemListElement[4].item).toEqual({ '@type': 'DataCatalog', name: 'City of Red Deer <Open> & "Data"' });
        expect(meta.jsonLd[0].itemListElement.map(item => item.name)).toEqual(['CanQuery', 'Open data portals']);
    });

    test('the lead splits the portals by level only when the split adds up', async () => {
        // Every portal has a level: the three numbers are the total.
        const whole = await portals.directory();
        expect(whole.levels.reduce((sum, row) => sum + row.portals, 0)).toBe(whole.totals.portals);
        // A portal whose place is unknown (not in the places table, or switched off) belongs to no level.
        const directory = portals.shape(ROWS.map(source => (source.id === 'ottawa-hub'
            ? { ...source, place_slug: null, place_kind: null, province_slug: null } : source)));
        expect(directory.totals.portals).toBe(5);
        expect(directory.levels.reduce((sum, row) => sum + row.portals, 0)).toBe(4);
        const body = seoSnapshot.portalsSnapshot(directory);
        expect(body).toContain('CanQuery mirrors 5 Canadian open data portals, 64,485 datasets in all.');
        expect(body).not.toMatch(/\d+ federal, \d+ provincial or territorial/);
    });

    test('a day is the day in Canada: a read in the evening is not dated tomorrow', async () => {
        // 02:10 UTC on November 16 is 21:10 on November 15 in Eastern time.
        catalogRead.listPortalDirectory.mockResolvedValue(ROWS.map(source => (source.id === 'open-canada'
            ? { ...source, last_synced_at: new Date('2026-11-16T02:10:00Z') } : source)));
        const res = await request(spa).get('/portals');
        expect(res.text).toContain('<dt>Last read</dt><dd>2026-11-15</dd>');
        // (The embedded data keeps the exact time; the page's own words never say the 16th.)
        expect(res.text).not.toMatch(/<d[dt]>2026-11-16<|<td>2026-11-16</);
        const { dayOf, PORTALS_TIME_ZONE } = require('../utils/portalDay');
        expect(dayOf('2026-11-16T04:59:59Z')).toBe('2026-11-15');
        expect(dayOf('2026-11-16T05:00:00Z')).toBe('2026-11-16');
        // Daylight time: midnight is four hours behind UTC in July.
        expect(dayOf(new Date('2026-07-01T03:59:59Z'))).toBe('2026-06-30');
        expect(dayOf('2026-07-01T04:00:00Z')).toBe('2026-07-01');
        expect([dayOf(null), dayOf(''), dayOf('not a date'), dayOf(undefined)]).toEqual(['', '', '', '']);
        // The application formats with the same zone, so its page and the server's say the same day.
        const client = fs.readFileSync(path.join(__dirname, '../../client/src/utils/portals.js'), 'utf8');
        expect(client).toContain("export const PORTALS_TIME_ZONE = '" + PORTALS_TIME_ZONE + "';");
    });

    test('a title that names thousands of portals still fits', () => {
        const many = { ...portals.shape(ROWS), totals: { portals: 12345, datasets: 1, provinces: 13 } };
        const meta = seoMeta.portalsMeta(many);
        expect(meta.title).toBe('Canadian open data portals: 12,345 catalogues compared - CanQuery');
        expect(meta.title.length).toBeLessThanOrEqual(80);
        expect(meta.description.length).toBeLessThanOrEqual(160);
    });

    test('one portal is not a comparison: the title, the description and the lead say so', async () => {
        catalogRead.listPortalDirectory.mockResolvedValue([ROWS[0]]);
        const res = await request(spa).get('/portals');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>Canadian open data portals - CanQuery</title>');
        expect(res.text).toContain('content="The Canadian open data portal that CanQuery mirrors, with its datasets, live tables, maps, ' +
            'licence and last refresh."');
        expect(res.text).toContain('CanQuery mirrors one Canadian open data portal, 64,485 datasets in all.');
        expect(res.text).not.toContain('noindex');
        expect(res.text).not.toContain('1 catalogues');
        expect(res.text).not.toContain('1 Canadian open data portals');
    });

    test('says the same words as the application: the headings, the labels and what the numbers mean', async () => {
        const client = fs.readFileSync(path.join(__dirname, '../../client/src/i18n.jsx'), 'utf8');
        // The English string of a key: the first of its two definitions.
        const english = key => JSON.parse('"' + new RegExp('^    "' + key.replace(/\./g, '\\.') + '": "(.*)",$', 'm').exec(client)[1] + '"');
        const html = (await request(spa).get('/portals')).text;
        for (const key of ['title', 'method_title', 'method_datasets', 'method_tables', 'method_licence', 'method_link', 'by_level',
            'table_title', 'by_platform', 'by_province', 'col_portal', 'col_place', 'col_platform', 'col_datasets', 'col_tables', 'col_maps',
            'col_licence', 'col_read', 'level_federal', 'level_provincial', 'level_municipal', 'platform_other', 'licence_each',
            'stat_provinces', 'stat_read', 'explore_places', 'explore_organizations', 'canada']) {
            expect([key, html.includes('>' + english('portals.' + key) + '<')]).toEqual([key, true]);
        }
        // The lead is the application's sentence with the counts filled in.
        const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_match, name) => values[name]);
        expect(html).toContain('>' + fill(english('portals.intro'), { portals: 5, federal: 1, provincial: 1, municipal: 3, datasets: '64,485' }) + '<');
        catalogRead.listPortalDirectory.mockResolvedValue([ROWS[0]]);
        portals.cache.clear();
        expect((await request(spa).get('/portals')).text).toContain('>' + fill(english('portals.intro_one'), { datasets: '64,485' }) + '<');
        // A portal with no level: both sides leave the split out, in the same sentence.
        const unlevelled = portals.shape(ROWS.map(source => (source.id === 'ottawa-hub' ? { ...source, place_slug: null, place_kind: null } : source)));
        expect(seoSnapshot.portalsSnapshot(unlevelled)).toContain('>' + fill(english('portals.intro_plain'), { portals: 5, datasets: '64,485' }) + '<');
        catalogRead.listPortalDirectory.mockResolvedValue([]);
        portals.cache.clear();
        expect((await request(spa).get('/portals')).text).toContain('>' + english('portals.unavailable') + '<');
        // The platforms have one name everywhere.
        const names = /PLATFORM_NAMES = (\{[^}]*\})/.exec(fs.readFileSync(path.join(__dirname, '../../client/src/utils/portals.js'), 'utf8'))[1];
        for (const [kind, name] of Object.entries(portals.PLATFORMS)) {
            expect(names).toContain(name);
            expect(seoSnapshot.PORTAL_PLATFORMS[kind]).toBe(name);
        }
        expect(Object.keys(seoSnapshot.PORTAL_LEVELS)).toEqual(portals.LEVELS);
    });

    test('the page\'s own code is preloaded with it', () => {
        const { routeAssets } = require('../services/routeAssets');
        expect(routeAssets('/portals?province=ontario', { 'src/pages/PortalsPage.jsx': { file: 'assets/portals-a.js' } }))
            .toEqual([{ file: 'assets/portals-a.js', rel: 'modulepreload' }]);
    });

    test('a direct visit carries the directory the page would fetch; an in-app head fetch and HEAD do not', async () => {
        const res = await request(spa).get('/portals');
        const payload = block(res.text);
        expect(payload).toMatchObject({ version: 1, kind: 'portals', path: '/portals' });
        // Exactly the JSON route's body.
        const api = await request(app).get('/web-api/v1/portals');
        expect(payload.directory).toEqual(api.body);
        expect(block((await request(spa).get('/portals?utm_source=x')).text).path).toBe('/portals?utm_source=x');
        expect(block((await request(spa).get('/portals').set('Sec-Fetch-Dest', 'document')).text)).not.toBeNull();
        expect(block((await request(spa).get('/portals').set('Sec-Fetch-Dest', 'empty')).text)).toBeNull();
        expect((await request(spa).head('/portals')).status).toBe(200);
        // The directory was read once for all of these.
        expect(catalogRead.listPortalDirectory).toHaveBeenCalledTimes(1);
    });

    test('a directory too large to embed is left to the page to fetch', () => {
        const directory = portals.shape(ROWS);
        expect(portalInitialData(directory, { path: '/portals' })).toMatchObject({ kind: 'portals' });
        expect(portalInitialData(null, { path: '/portals' })).toBeNull();
        const huge = { ...directory, portals: Array.from({ length: 2000 }, () => directory.portals[1]) };
        expect(Buffer.byteLength(JSON.stringify(huge))).toBeGreaterThan(INLINE_MAX_BYTES);
        expect(portalInitialData(huge, { path: '/portals' })).toBeNull();
    });

    test('a trailing slash redirects to the page, and nothing lives below it', async () => {
        const slash = await request(spa).get('/portals/?a=1');
        expect(slash.status).toBe(301);
        expect(slash.headers.location).toBe('/portals?a=1');
        expect(seoMeta.classifyRoute('/portals')).toEqual({ type: 'portals' });
        expect(seoMeta.classifyRoute('/portals/')).toEqual({ type: 'portals' });
        expect(seoMeta.classifyRoute('/portals/toronto')).toEqual({ type: 'other' });
        const below = await request(spa).get('/portals/toronto');
        expect(below.status).toBe(404);
        expect(below.text).toContain('name="robots" content="noindex');
        // ?page= belongs to the paginated lists: here it is ignored, not a second page.
        const paged = await request(spa).get('/portals?page=2');
        expect(paged.status).toBe(200);
        expect(paged.text).toContain('<link rel="canonical" href="https://canquery.com/portals"');
    });

    test('until a portal is mirrored the page says so and stays out of the index', async () => {
        catalogRead.listPortalDirectory.mockResolvedValue([ROWS[5]]);
        const res = await request(spa).get('/portals');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<meta name="robots" content="noindex, follow" />');
        expect(res.text).toContain('<title>Canadian open data portals - CanQuery</title>');
        expect(res.text).toContain('No open data portal is mirrored here yet.');
        expect(res.text).not.toContain('<table>');
        expect(block(res.text)).toBeNull();
        expect(seoMeta.portalsMeta(null).jsonLd.map(item => item['@type'])).toEqual(['BreadcrumbList']);
    });

    test('a catalogue that cannot be read answers 503, never an empty directory', async () => {
        catalogRead.listPortalDirectory.mockRejectedValue(new Error('down'));
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const res = await request(spa).get('/portals');
            expect(res.status).toBe(503);
            expect(res.headers['retry-after']).toBe('60');
            expect(res.text).toContain('name="robots" content="noindex');
        } finally {
            error.mockRestore();
        }
    });

    test('resolvePage takes an injected directory, as the other hubs do', async () => {
        const directory = portals.shape(ROWS.slice(0, 2));
        const page = await resolvePage('/portals', { portals: { directory: async () => directory } });
        expect(page).toMatchObject({ status: 200, canonicalPath: '/portals', portals: { directory } });
        expect(page.meta.title).toBe('Canadian open data portals: 2 catalogues compared - CanQuery');
        expect(catalogRead.listPortalDirectory).not.toHaveBeenCalled();
    });
});

describe('the portal directory in the sitemap and the section links', () => {
    test('the pages sitemap lists it once a portal is mirrored, dated by the day of the last successful read', async () => {
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        // The day the page prints, not the time of each half-hourly read: the entry changes when the page does.
        expect(res.text).toMatch(/<url>\s*<loc>https:\/\/canquery\.com\/portals<\/loc>\s*<lastmod>2026-11-15<\/lastmod>/);
        // After the places hub, before the dataset hubs.
        expect(res.text.indexOf('/places</loc>')).toBeLessThan(res.text.indexOf('/portals</loc>'));
        expect(res.text.indexOf('/portals</loc>')).toBeLessThan(res.text.indexOf('/docs</loc>'));
    });

    test('the pages sitemap leaves it out while nothing is mirrored: the page is then noindex', async () => {
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        catalogRead.listPortalDirectory.mockResolvedValue([ROWS[5]]);
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<loc>https://canquery.com/places</loc>');
        expect(res.text).not.toContain('/portals');
    });

    test('one failed read does not drop the page from the sitemap: it is listed without a date', async () => {
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        catalogRead.listPortalDirectory.mockRejectedValue(new Error('down'));
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<loc>https:\/\/canquery\.com\/portals<\/loc>\s*<changefreq>daily<\/changefreq>/);
    });

    test('the index dates the pages file by its newest entry, the directory\'s day included', async () => {
        for (const read of ['countSitemapDatasets', 'countSitemapResources']) catalogRead[read].mockResolvedValue(0);
        for (const read of ['listDatasetSitemapChunkLastmods', 'listResourceSitemapChunkLastmods', 'listPlaceSitemap', 'listOrganizationSitemap',
            'listNoindexResourceSitemap', 'listShownNoindexDatasets', 'listPolicyNoindexDatasets', 'listPolicyNoindexResources']) {
            catalogRead[read].mockResolvedValue([]);
        }
        // Years ahead of any guide's date, so the guides never decide the answer.
        catalogRead.listPortalDirectory.mockResolvedValue(ROWS.map(source => (source.id === 'open-canada'
            ? { ...source, last_synced_at: new Date('2031-03-04T15:00:00Z') } : source)));
        const pagesDate = async () => {
            resetSitemapCache();
            const res = await request(app).get('/sitemap.xml');
            expect(res.status).toBe(200);
            return /<loc>https:\/\/canquery\.com\/sitemap-pages\.xml<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/.exec(res.text)[1];
        };
        // The catalogue's last change is older than the last read of a portal: the file's newest entry is the directory's.
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        expect(await pagesDate()).toBe('2031-03-04');
        // A catalogue change later than that day is the newest entry again.
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2031-03-04T22:00:00Z'));
        expect(await pagesDate()).toBe('2031-03-04T22:00:00.000Z');
    });

    test('a portal read at no known time is listed without a date', async () => {
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        catalogRead.listPortalDirectory.mockResolvedValue(ROWS.map(source => ({ ...source, last_synced_at: null })));
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.text).toMatch(/<loc>https:\/\/canquery\.com\/portals<\/loc>\s*<changefreq>daily<\/changefreq>/);
    });

    test('every page the server renders links the directory', () => {
        expect(seoSnapshot.sectionNav()).toContain('<li><a href="/portals">Portals</a></li>');
        expect(seoSnapshot.errorSnapshot('Page not found', 'Nothing here.')).toContain('<a href="/portals">Portals</a>');
        expect(seoSnapshot.staticSnapshot('about')).toContain('<a href="/portals">Portals</a>');
    });
});
