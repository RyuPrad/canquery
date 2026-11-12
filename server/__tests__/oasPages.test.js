jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({ searchDatasets: jest.fn(), getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(), listOrganizations: jest.fn(), getStats: jest.fn(), pingDb: jest.fn(), getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn(), getCatalogLastModified: jest.fn() }));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), readStoreRows: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../db/pool', () => ({ query: jest.fn(), connect: jest.fn(), on: jest.fn(), end: jest.fn() }));
jest.mock('../db/lmiaQueries', () => ({ getLmiaSummary: jest.fn(), searchLmiaEmployers: jest.fn(), getLmiaEmployerRows: jest.fn(),
    getLmiaEmployer: jest.fn() }));
jest.mock('../db/oasQueries', () => ({ getOasPeriod: jest.fn(), listOasPeriods: jest.fn() }));

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const queries = require('../db/oasQueries');
const catalogRead = require('../db/catalogReadQueries');
const oas = require('../services/oasPages');
const presentation = require('../services/oasPresentation');
const labels = require('../utils/oasLabels');
const { oasInitialData } = require('../services/oasInitialData');
const { setHubAvailable, hubAvailable } = require('../utils/hubAvailability');
const { hubSections } = require('../utils/datasetHubs');
const seoSnapshot = require('../services/seoSnapshot');
const { classifyRoute } = require('../services/seoMeta');
const { serveSpa, resolvePage, injectHubs } = require('../controllers/spaController');
const { resetSitemapCache } = require('../controllers/sitemapController');
const app = require('../app');

const NBSP = String.fromCharCode(160);
const LOADED = new Date('2026-11-11T04:49:54.000Z');
// A table's bands as the one-statement read returns them: [from, to, amount, allowance, with 65, with 75] in cents,
// `width` cents wide from 0, each amount a dollar lower than the band before.
function bands(table, { rows = 120, width = 2400, top = 113890, oas65 = 76250, oas75 = 83875 } = {}) {
    return Array.from({ length: rows }, (_, position) => {
        const amount = top - position * 100;
        return [position * width, (position + 1) * width - 1, amount, table === 4 ? amount + 500 : null,
            table === 5 ? null : amount + oas65, table === 5 ? null : amount + oas75];
    });
}
function quarter(key, options = {}) {
    return { period_key: key, benefit_year: Math.floor(key / 100), benefit_quarter: (key % 100) / 3, income_year: 2025, loaded_at: LOADED,
        tables: [1, 2, 3, 4, 5].map(table => ({ table, resource_id: 'res-' + table, loaded_at: LOADED,
            rows: bands(table, { ...(options.all || {}), ...(options[table] || {}) }) })) };
}
// What the database holds: the quarters that are whole, newest last.
function hold(...rows) {
    queries.getOasPeriod.mockImplementation(async ({ period }) => (period === null ? rows[rows.length - 1] || null
        : rows.find(row => row.period_key === period) || null));
    queries.listOasPeriods.mockResolvedValue(rows.map(row => ({ period_key: row.period_key, income_year: row.income_year })));
}

beforeEach(() => {
    jest.clearAllMocks();
    oas.cache.clear();
    setHubAvailable('oas', false);
    hold(quarter(202612));
});

describe('quarters, money and paths', () => {
    test('periods read as the publisher names them, long and short, in both languages', () => {
        const q4 = labels.periodOf(202612);
        expect(labels.periodLabel(q4, 'en')).toBe('October to December 2026');
        expect(labels.periodLabel(q4, 'fr')).toBe('octobre à décembre 2026');
        expect(labels.periodLabel(q4, 'en', { short: true })).toBe('Oct–Dec 2026');
        expect(labels.periodLabel(q4, 'fr', { short: true })).toBe('oct.–déc. 2026');
        expect(labels.periodLabel(labels.periodOf(202703), 'en')).toBe('January to March 2027');
        expect(labels.periodLabel(labels.periodOf(202709), 'fr', { short: true })).toBe('juill.–sept. 2027');
        expect(labels.periodLabel(null, 'en')).toBe('');
        expect(labels.dateLabel('2027-01-01', 'en')).toBe('January 1, 2027');
        expect(labels.dateLabel('2027-01-01', 'fr')).toBe('1er janvier 2027');
        expect(labels.dateLabel('2026-11-11T04:49:54.000Z', 'fr')).toBe('11 novembre 2026');
        expect(labels.dateLabel('soon', 'en')).toBe('');
    });
    test('a quarter has not started, is in effect or has ended on a given day', () => {
        const q1 = labels.periodOf(202703);
        expect(labels.periodState(q1, '2026-12-29')).toBe('upcoming');
        expect(labels.periodState(q1, '2027-01-01')).toBe('current');
        expect(labels.periodState(q1, '2027-03-31')).toBe('current');
        expect(labels.periodState(q1, '2027-04-01')).toBe('ended');
        expect(labels.todayInCanada(new Date('2027-01-01T03:00:00Z'))).toBe('2026-12-31');
        expect(labels.todayInCanada(new Date('2027-01-01T05:00:00Z'))).toBe('2027-01-01');
    });
    test('money is written the same way everywhere, from whole cents', () => {
        expect(labels.formatMoney(113890, 'en')).toBe('$1,138.90');
        expect(labels.formatMoney(113890, 'fr')).toBe('1' + NBSP + '138,90' + NBSP + '$');
        expect(labels.formatMoney(49, 'en')).toBe('$0.49');
        expect(labels.formatMoney(0, 'fr')).toBe('0,00' + NBSP + '$');
        expect(labels.formatMoney(5539199, 'en')).toBe('$55,391.99');
        expect(labels.formatMoney(123456789, 'fr')).toBe('1' + NBSP + '234' + NBSP + '567,89' + NBSP + '$');
        expect(labels.formatDollars(2311200, 'en')).toBe('$23,112');
        expect(labels.formatDollars(2311200, 'fr')).toBe('23' + NBSP + '112' + NBSP + '$');
        expect(labels.formatDollars(2311250, 'en')).toBe('$23,112.50');
        expect(labels.formatBand(0, 2399, 'en')).toBe('$0.00 to $23.99');
        expect(labels.formatBand(0, 2399, 'fr')).toBe('0,00' + NBSP + '$ à 23,99' + NBSP + '$');
        expect(labels.formatMoney(NaN, 'en')).toBe('');
    });
    test('a change between two quarters is a signed percentage to one decimal', () => {
        expect(labels.formatChange(113890, 112317, 'en')).toBe('+1.4%');
        expect(labels.formatChange(113890, 112317, 'fr')).toBe('+1,4' + NBSP + '%');
        expect(labels.formatChange(100000, 100000, 'en')).toBe('0.0%');
        expect(labels.formatChange(99000, 100000, 'en')).toBe('-1.0%');
        expect(labels.formatChange(100, 0, 'en')).toBe('');
        expect(labels.formatChange(100, null, 'en')).toBe('');
    });
    test('each page has an English and a French address', () => {
        expect([labels.oasPath('en'), labels.oasPath('fr'), labels.oasPath()]).toEqual(['/oas', '/fr/sv', '/oas']);
        expect(labels.oasTablePath('en', 3)).toBe('/oas/table-3');
        expect(labels.oasTablePath('fr', 3)).toBe('/fr/sv/tableau-3');
        expect(labels.tableTitle(1, 'en')).toBe('Table 1: GIS for a single person who receives an OAS pension');
        expect(labels.tableTitle(5, 'fr')).toBe('Tableau 5 : Allocation au survivant');
    });
    test('addresses name a language and a table from 1 to 5; anything else is not a page', () => {
        expect(classifyRoute('/oas')).toEqual({ type: 'oas', lang: 'en' });
        expect(classifyRoute('/OAS/')).toEqual({ type: 'oas', lang: 'en' });
        expect(classifyRoute('/fr/sv')).toEqual({ type: 'oas', lang: 'fr' });
        expect(classifyRoute('/oas/table-4')).toEqual({ type: 'oas-table', lang: 'en', table: 4 });
        expect(classifyRoute('/fr/SV/Tableau-2/')).toEqual({ type: 'oas-table', lang: 'fr', table: 2 });
        expect(classifyRoute('/fr/sv/tableau%2D5')).toEqual({ type: 'oas-table', lang: 'fr', table: 5 });
        for (const target of ['/oas/table-0', '/oas/table-6', '/oas/table-12', '/oas/tableau-1', '/fr/sv/table-1', '/oas/table-1/x',
            '/oas/%E0%A4%A', '/oasis', '/fr/svp', '/fr/sv/tableau-']) {
            expect([target, classifyRoute(target).type]).toEqual([target, 'other']);
        }
    });
});

describe('what the pages read', () => {
    test('the summary holds the quarter, its key figures and a short version of each table', async () => {
        const summary = await oas.summary();
        expect(summary.dataset_id).toBe('dfa4daf1-669e-4514-82cd-982f27707ed0');
        expect(summary.period).toEqual({ key: 202612, year: 2026, quarter: 4, start: '2026-10-01', end: '2026-12-31', income_year: 2025,
            loaded_at: '2026-11-11T04:49:54.000Z' });
        expect(summary.updated_at).toBe('2026-11-11T04:49:54.000Z');
        expect(summary.oas).toEqual({ age_65_cents: 76250, age_75_cents: 83875 });
        expect(summary.columns).toEqual(oas.COLUMNS);
        expect(summary.tables.map(table => table.table)).toEqual([1, 2, 3, 4, 5]);
        expect(summary.tables[0]).toMatchObject({ table: 1, resource_id: 'res-1', row_count: 120, max_amount_cents: 113890,
            max_allowance_cents: null, ends_at_cents: 288000 });
        expect(summary.tables[3]).toMatchObject({ max_amount_cents: 113890, max_allowance_cents: 114390 });
        expect(summary.previous).toBeNull();
        expect(summary.periods).toEqual([{ key: 202612, year: 2026, quarter: 4, start: '2026-10-01', end: '2026-12-31', income_year: 2025 }]);
    });
    test('a short table is the band of every round step of income, a dozen lines at most', () => {
        // 120 bands of $24 end at $2,880: steps of $1,000 give the bands holding $0, $1,000 and $2,000.
        expect(oas.condensed(bands(1)).map(row => row[0])).toEqual([0, 98400, 199200]);
        // The publisher's table 1: 1,140 bands to $23,112 in steps of $2,000.
        const wide = bands(1, { rows: 1140, width: 2027, top: 113890 });
        const short = oas.condensed(wide);
        expect(short).toHaveLength(12);
        expect(short.map(row => Math.floor(row[1] / 200000))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        for (const [index, row] of short.entries()) expect(row[0] <= index * 200000 && index * 200000 <= row[1]).toBe(true);
        // One very wide first band (table 3 starts with $0 to $4,095.99) is listed once.
        const first = [[0, 409599, 100, null, 200, 300], ...bands(1, { rows: 20 }).map(row => [row[0] + 409600, row[1] + 409600, 90, null, 190, 290])];
        expect(oas.condensed(first).filter(row => row[0] === 0)).toHaveLength(1);
    });
    test('the band of an income is found at every edge; none past the table', () => {
        const rows = bands(1);
        expect(oas.findBand(rows, 0)).toBe(rows[0]);
        expect(oas.findBand(rows, 2399)).toBe(rows[0]);
        expect(oas.findBand(rows, 2400)).toBe(rows[1]);
        expect(oas.findBand(rows, 287999)).toBe(rows[119]);
        expect(oas.findBand(rows, 288000)).toBeNull();
        expect(oas.findBand(rows, -1)).toBeNull();
        expect(oas.findBand([], 5)).toBeNull();
    });
    test('the full OAS pension is named only when every row of tables 1 to 4 adds the same amount', async () => {
        const uneven = quarter(202612);
        uneven.tables[1].rows[40][4] -= 1;
        hold(uneven);
        expect((await oas.summary()).oas).toBeNull();
        oas.cache.clear();
        hold(quarter(202612, { 3: { oas65: 76251 } }));
        expect((await oas.summary()).oas).toBeNull();
        expect(oas.pension(bands(5), 4)).toBeNull();
        expect(oas.pension(bands(2), 5)).toBe(83875);
    });
    test('the quarter before the one shown gives the figures to compare with', async () => {
        hold(quarter(202609, { all: { top: 112317, oas65: 75100, oas75: 82610 } }), quarter(202612));
        const summary = await oas.summary();
        expect(summary.period.key).toBe(202612);
        expect(summary.previous.period).toMatchObject({ key: 202609, quarter: 3 });
        expect(summary.previous.oas).toEqual({ age_65_cents: 75100, age_75_cents: 82610 });
        expect(summary.previous.tables.map(table => table.max_amount_cents)).toEqual([112317, 112317, 112317, 112317, 112317]);
        expect(summary.previous.tables[0].condensed).toBeUndefined();
        expect(summary.periods.map(period => period.key)).toEqual([202609, 202612]);
    });
    test('one table carries every band; an unknown table or quarter is nothing', async () => {
        hold(quarter(202609, { all: { top: 112317 } }), quarter(202612));
        const table = await oas.table(4);
        expect(table.period.key).toBe(202612);
        expect(table.table).toMatchObject({ table: 4, row_count: 120, max_allowance_cents: 114390 });
        expect(table.rows).toHaveLength(120);
        expect(table.rows[0]).toEqual([0, 2399, 113890, 114390, 190140, 197765]);
        expect(table.columns).toEqual(['income_from_cents', 'income_to_cents', 'amount_cents', 'allowance_cents', 'with_oas_65_cents', 'with_oas_75_cents']);
        expect((await oas.table(1, { period: 202609 })).rows[0][2]).toBe(112317);
        expect(await oas.table(6)).toBeNull();
        expect(await oas.table(0)).toBeNull();
        expect(await oas.table(1, { period: 202606 })).toBeNull();
        // An unknown quarter is refused from the list of quarters, without a read of its own.
        expect(queries.getOasPeriod).not.toHaveBeenCalledWith({ period: 202606 });
    });
    test('nothing is shown until a quarter is whole, and a quarter is read once in five minutes', async () => {
        hold();
        expect(await oas.summary()).toBeNull();
        expect(oas.available()).toBe(false);
        oas.cache.clear();
        const broken = quarter(202612);
        broken.tables.pop();
        hold(broken);
        expect(await oas.summary()).toBeNull();
        oas.cache.clear();
        const empty = quarter(202612);
        empty.tables[2].rows = [];
        hold(empty);
        expect(await oas.summary()).toBeNull();
        oas.cache.clear();
        hold(quarter(202612));
        jest.clearAllMocks();
        hold(quarter(202612));
        await oas.summary();
        await oas.summary();
        await oas.table(2);
        expect(queries.getOasPeriod).toHaveBeenCalledTimes(1);
        expect(oas.available()).toBe(true);
    });
    test('a read that fails says nothing about whether the hub has data', async () => {
        await oas.summary();
        expect(oas.available()).toBe(true);
        oas.cache.clear();
        queries.getOasPeriod.mockRejectedValue(new Error('connection refused'));
        await expect(oas.summary()).rejects.toThrow('connection refused');
        expect(oas.available()).toBe(true);
    });
});

describe('the /web-api/v1/oas routes', () => {
    test('the summary is cacheable and carries the licence', async () => {
        const res = await request(app).get('/web-api/v1/oas/summary');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        expect(res.body.meta).toMatchObject({ source: 'canquery', license: 'Open Government Licence - Canada',
            upstream: 'https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0' });
        expect(res.body.data.period.key).toBe(202612);
        expect(res.body.data.tables).toHaveLength(5);
    });
    test('a table of the quarter shown, or of another loaded quarter', async () => {
        hold(quarter(202609, { all: { top: 112317 } }), quarter(202612));
        const res = await request(app).get('/web-api/v1/oas/tables/2');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        expect(res.body.data.table.table).toBe(2);
        expect(res.body.data.rows).toHaveLength(120);
        const older = await request(app).get('/web-api/v1/oas/tables/2?period=202609');
        expect(older.body.data.period.key).toBe(202609);
        expect(older.body.data.rows[0][2]).toBe(112317);
    });
    test('unknown tables and quarters, and a period that is not one', async () => {
        for (const target of ['/web-api/v1/oas/tables/6', '/web-api/v1/oas/tables/0', '/web-api/v1/oas/tables/one', '/web-api/v1/oas/tables/11']) {
            const res = await request(app).get(target);
            expect([target, res.status, res.body.code]).toEqual([target, 404, 'OAS_TABLE_NOT_FOUND']);
        }
        const missing = await request(app).get('/web-api/v1/oas/tables/1?period=202606');
        expect([missing.status, missing.body.code]).toEqual([404, 'OAS_PERIOD_NOT_FOUND']);
        for (const period of ['2026', 'latest', '2026124', '202612&period=202609', '']) {
            const res = await request(app).get('/web-api/v1/oas/tables/1?period=' + period);
            expect([period, res.status, res.body.code]).toEqual([period, 400, 'INVALID_QUERY']);
        }
    });
    test('before a quarter is loaded the routes say so', async () => {
        hold();
        for (const target of ['/web-api/v1/oas/summary', '/web-api/v1/oas/tables/1']) {
            const res = await request(app).get(target);
            expect([target, res.status, res.body.code]).toEqual([target, 503, 'OAS_AMOUNTS_UNAVAILABLE']);
        }
    });
    test('is not part of the developer API', async () => {
        expect((await request(app).get('/api/v1/oas/summary')).status).toBe(404);
        expect((await request(app).get('/api/v1/oas/tables/1')).status).toBe(404);
    });
});

describe('the /oas pages', () => {
    let distDir;
    let spa;
    beforeAll(() => {
        distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-oas-'));
        fs.writeFileSync(path.join(distDir, 'index.html'),
            '<!doctype html><html lang="en"><head><!-- seo:start --><title>x</title><!-- seo:end -->\n  </head><body><div id="root"></div></body></html>');
        spa = express();
        spa.get(/.*/, serveSpa(distDir));
    });
    afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));
    const initial = html => JSON.parse(/<script type="application\/json" id="cq-initial">(.*?)<\/script>/s.exec(html)[1]);

    test('the hub names its quarter and is indexable, with the key figures and a short version of every table', async () => {
        const res = await request(spa).get('/oas');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>OAS and Guaranteed Income Supplement amounts: Oct–Dec 2026 - CanQuery</title>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/oas"');
        expect(res.text).not.toContain('noindex');
        expect(res.text).toContain('<html lang="en">');
        expect(res.text).toContain('<link rel="alternate" hreflang="en-CA" href="https://canquery.com/oas" />');
        expect(res.text).toContain('<link rel="alternate" hreflang="fr-CA" href="https://canquery.com/fr/sv" />');
        expect(res.text).toContain('<link rel="alternate" hreflang="x-default" href="https://canquery.com/oas" />');
        expect(res.text.match(/<h1>/g)).toHaveLength(1);
        expect(res.text).toContain('<h1>Guaranteed Income Supplement, Allowance and OAS pension amounts, October to December 2026</h1>');
        expect(res.text).toContain('they are based on income for 2025.');
        expect(res.text).toContain('CanQuery is not a government website.');
        expect(res.text).toContain('<dt>Full OAS pension, age 65 to 74</dt><dd>$762.50 a month</dd>');
        expect(res.text).toContain('<dt>Loaded by CanQuery</dt><dd>November 11, 2026</dd>');
        expect(res.text).toContain('<a href="/oas/table-1">Table 1: GIS for a single person who receives an OAS pension</a>');
        expect(res.text).toContain('<td>GIS $1,138.90 a month; Allowance $1,143.90 a month</td><td>$2,880</td>');
        // The table of names and figures may wrap; the tables of bands keep each figure on one line.
        expect(res.text).toContain('<h2>Maximum monthly amounts, October to December 2026</h2><div class="overflow-x-auto"><table><thead>');
        expect(res.text).toContain('<h2>Table 5: Allowance for the Survivor</h2><p>');
        expect(res.text.match(/<table data-cq-amounts="true">/g)).toHaveLength(5);
        expect(res.text).toContain('<section id="table-5"><h2>Table 5: Allowance for the Survivor</h2>');
        expect(res.text).toContain('<a href="/oas/table-3">All 120 income bands of Table 3</a>');
        expect(res.text).toContain('<a href="/fr/sv" hreflang="fr" lang="fr">Lire en français</a>');
        expect(res.text).toContain('<a href="/resources/res-2">Table 2 as a CSV table</a>');
        expect(res.text).toContain('href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html"');
        expect(res.text).not.toContain('Change from');
        const types = [...res.text.matchAll(/"@type":"(BreadcrumbList|WebPage)"/g)].map(match => match[1]);
        expect(types).toEqual(['BreadcrumbList', 'WebPage']);
        expect(res.text).toContain('"dateModified":"2026-11-11T04:49:54.000Z"');
        expect(res.text).toContain('"inLanguage":"en-CA"');
    });

    test('the French hub is a page of its own, in French from its head to its headings', async () => {
        const res = await request(spa).get('/fr/sv');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<html lang="fr">');
        expect(res.text).toContain('<title>Pension de vieillesse et SRG : montants oct.–déc. 2026 - CanQuery</title>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/fr/sv"');
        expect(res.text).toContain('<link rel="alternate" hreflang="fr-CA" href="https://canquery.com/fr/sv" />');
        expect(res.text).toContain('<meta property="og:locale" content="fr_CA" />');
        expect(res.text).toContain('<h1>Montants du Supplément de revenu garanti, de l’Allocation et de la pension de la Sécurité de la vieillesse, octobre à décembre 2026</h1>');
        expect(res.text).toContain('<nav aria-label="Fil d’Ariane">');
        expect(res.text).toContain('<h2>Sources officielles et licences</h2>');
        // Amounts keep their no-break spaces wherever the page prints them.
        expect(res.text).toContain('<dt>Pleine pension de la SV, 65 à 74 ans</dt><dd>762,50' + NBSP + '$ par mois</dd>');
        expect(res.text).not.toMatch(/\d \$/);
        expect(res.text).toContain('<td>1' + NBSP + '138,90' + NBSP + '$ par mois</td><td>2' + NBSP + '880' + NBSP + '$</td>');
        expect(res.text).toContain('<a href="/fr/sv/tableau-4">Tableau 4 : SRG et Allocation pour un couple</a>');
        expect(res.text).toContain('<a href="/oas" hreflang="en" lang="en">Read in English</a>');
        expect(res.text).toContain('CanQuery n’est pas un site du gouvernement.');
        expect(res.text).toContain('"inLanguage":"fr-CA"');
        expect(res.text).not.toContain('Official sources and licences');
    });

    test('a table page holds every band of its table, in sections under their income ranges', async () => {
        hold(quarter(202612, { 1: { rows: 1140, width: 2027 } }));
        const res = await request(spa).get('/oas/table-1');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>GIS Table 1, single person: amounts by income, Oct–Dec 2026 - CanQuery</title>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/oas/table-1"');
        expect(res.text).toContain('<link rel="alternate" hreflang="fr-CA" href="https://canquery.com/fr/sv/tableau-1" />');
        expect(res.text).not.toContain('noindex');
        expect(res.text).toContain('<h1>Table 1: GIS for a single person who receives an OAS pension, October to December 2026</h1>');
        expect(res.text).toContain('(yearly income of the beneficiary (excluding OAS pension and GIS), for 2025)');
        expect(res.text).toContain('<dt>Income bands</dt><dd>1,140</dd>');
        expect(res.text).toContain('<dt>Maximum monthly GIS</dt><dd>$1,138.90 a month</dd>');
        const body = res.text.slice(res.text.indexOf('<div id="root">'), res.text.indexOf('<script type="application/json" id="cq-initial">'));
        // The table ends at $23,107.80: twelve sections of $2,000, each opened by the band that holds its round income.
        expect(body.match(/<section id="income-\d+">/g)).toEqual(Array.from({ length: 12 }, (_, index) => `<section id="income-${index * 2000}">`));
        expect(body.match(/<tr><th scope="row">\$/g)).toHaveLength(1140);
        expect(body).toContain('<nav aria-label="Income ranges" data-cq-jump="true">');
        expect(body).toContain('<li><a href="#income-0">$0.00 to $1,986.45</a></li>');
        expect(body).toContain('<section id="income-0"><h2>Yearly income $0.00 to $1,986.45</h2>');
        expect(body).toContain('<section id="income-2000"><h2>Yearly income $1,986.46 to $3,993.18</h2>');
        expect(body).toContain('<th scope="col">Yearly income</th><th scope="col">Monthly GIS</th><th scope="col">OAS pension and GIS, age 65 to 74</th>' +
            '<th scope="col">OAS pension and GIS, age 75 and over</th>');
        expect(body).toContain('<tr><th scope="row">$0.00 to $20.26</th><td>$1,138.90</td><td>$1,901.40</td><td>$1,977.65</td></tr>');
        expect(body).toContain('<a href="/oas/table-5">Table 5: Allowance for the Survivor</a>');
        expect(body).toContain('<a href="/oas">OAS and GIS amounts by income</a>');
        expect(body).toContain('<a href="/fr/sv/tableau-1" hreflang="fr" lang="fr">Lire en français</a>');
        expect(body).not.toContain('href="/oas/table-1"');
    });

    test('each table shows only its own columns, in both languages', async () => {
        const couple = (await request(spa).get('/fr/sv/tableau-4')).text;
        expect(couple).toContain('<title>SRG Tableau 4, couple avec l’Allocation : oct.–déc. 2026 - CanQuery</title>');
        expect(couple).toContain('<th scope="col">Revenu annuel</th><th scope="col">SRG mensuel</th><th scope="col">Allocation mensuelle</th>' +
            '<th scope="col">Pension de la SV et SRG, 65 à 74 ans</th><th scope="col">Pension de la SV et SRG, 75 ans et plus</th>');
        expect(couple).toContain('<dt>Allocation mensuelle maximale</dt>');
        expect(couple).toContain('<h2>Revenu annuel de 0,00' + NBSP + '$ à 983,99' + NBSP + '$</h2>');
        expect(couple).toContain('<dt>Indiqué pour les revenus annuels inférieurs à</dt><dd>2' + NBSP + '880' + NBSP + '$</dd>');
        const survivor = (await request(spa).get('/oas/table-5')).text;
        expect(survivor).toContain('<th scope="col">Yearly income</th><th scope="col">Monthly Allowance for the Survivor</th></tr>');
        expect(survivor).toContain('<dt>Maximum monthly Allowance for the Survivor</dt>');
        expect(survivor).not.toContain('Full OAS pension');
        expect(survivor).toContain('(yearly income of the beneficiary (excluding Allowance for the Survivor), for 2025)');
    });

    test('titles fit a search result and descriptions too, for every page, quarter and language', async () => {
        for (const key of [202703, 202706, 202709, 202712]) {
            oas.cache.clear();
            hold(quarter(key));
            for (const lang of ['en', 'fr']) {
                const targets = [labels.oasPath(lang), ...[1, 2, 3, 4, 5].map(table => labels.oasTablePath(lang, table))];
                for (const target of targets) {
                    const { meta } = await resolvePage(target);
                    const title = meta.title.replace(/ - CanQuery$/, '');
                    expect([target, key, title.length <= 60, title]).toEqual([target, key, true, title]);
                    expect([target, key, meta.description.length <= 160, meta.description.endsWith('…')]).toEqual([target, key, true, false]);
                    expect(meta.title).toContain(String(Math.floor(key / 100)));
                    expect(meta.lang).toBe(lang);
                }
            }
        }
    });

    test('before a quarter is loaded every page says so and is not indexed', async () => {
        hold();
        for (const target of ['/oas', '/fr/sv', '/oas/table-2', '/fr/sv/tableau-5']) {
            const res = await request(spa).get(target);
            expect([target, res.status]).toEqual([target, 200]);
            expect(res.text).toContain('<meta name="robots" content="noindex, follow"');
            expect(res.text).toContain(target.startsWith('/fr') ? 'sont en cours de chargement' : 'are being loaded');
            expect(res.text).toContain('<link rel="canonical" href="https://canquery.com' + target + '"');
            expect(res.text).not.toContain('cq-initial');
            expect(res.text).not.toContain('cq-hubs');
        }
        expect((await request(spa).get('/oas/table-2')).text).toContain('<h1>Table 2: GIS for the spouse or common-law partner of someone who receives an OAS pension</h1>');
    });

    test('capitals and a trailing slash redirect to the address; an unknown table is not found', async () => {
        for (const [target, location] of [['/oas/', '/oas'], ['/OAS', '/oas'], ['/fr/sv/', '/fr/sv'], ['/oas/Table-3', '/oas/table-3'],
            ['/oas/table-3/', '/oas/table-3'], ['/FR/SV/Tableau-2', '/fr/sv/tableau-2'], ['/oas/table%2D4', '/oas/table-4']]) {
            const moved = await request(spa).get(target);
            expect([target, moved.status, moved.headers.location]).toEqual([target, 301, location]);
        }
        expect((await request(spa).get('/oas?utm_source=x')).status).toBe(200);
        expect((await request(spa).get('/oas/?utm_source=x')).headers.location).toBe('/oas?utm_source=x');
        for (const target of ['/oas/table-6', '/oas/tableau-1', '/fr/sv/table-1', '/oas/table-1/extra']) {
            const missing = await request(spa).get(target);
            expect([target, missing.status]).toEqual([target, 404]);
            expect(missing.text).toContain('noindex');
        }
    });

    test('a direct visit carries the answers the page would fetch, exactly as the routes give them', async () => {
        const hub = await request(spa).get('/oas');
        const hubBlock = initial(hub.text);
        expect(hubBlock).toMatchObject({ version: 1, kind: 'oas', path: '/oas', lang: 'en', table: null, rows: null });
        expect(hubBlock.summary).toEqual((await request(app).get('/web-api/v1/oas/summary')).body);
        const page = await request(spa).get('/fr/sv/tableau-3?x=1');
        const block = initial(page.text);
        expect(block).toMatchObject({ kind: 'oas', path: '/fr/sv/tableau-3?x=1', lang: 'fr', table: 3 });
        expect(block.rows).toEqual((await request(app).get('/web-api/v1/oas/tables/3')).body);
        expect(block.summary.data.period.key).toBe(block.rows.data.period.key);
        // An address that ends in a bare "?" is the address without it to the browser: the block says the same.
        expect(initial((await request(spa).get('/oas?')).text).path).toBe('/oas');
        expect(initial((await request(spa).get('/oas/table-2?')).text).path).toBe('/oas/table-2');
        // A fetch from the application itself (the head for a route change) gets none.
        expect((await request(spa).get('/oas').set('Sec-Fetch-Dest', 'empty')).text).not.toContain('cq-initial');
        expect(oasInitialData({ lang: 'en', table: null, summary: null, data: null }, { path: '/oas' })).toBeNull();
        expect(oasInitialData({ lang: 'en', table: 2, summary: hubBlock.summary.data, data: null }, { path: '/oas/table-2' })).toBeNull();
    });

    test('a quarter that has not started, or has ended, is said so; the quarter in effect has no note', async () => {
        const summary = await oas.summary();
        const at = now => presentation.oasSnapshot(summary, 'en', { now: new Date(now) });
        expect(at('2026-11-11T12:00:00Z')).not.toContain('apply from');
        expect(at('2026-11-11T12:00:00Z')).not.toContain('Newer amounts');
        expect(at('2026-09-29T15:00:00Z')).toContain('<p>These amounts apply from October 1, 2026.</p>');
        expect(at('2027-01-02T15:00:00Z')).toContain('<p>These are the amounts for October to December 2026. Newer amounts may have been published since;');
        const table = await oas.table(2);
        expect(presentation.oasTableSnapshot(table, 'fr', { now: new Date('2026-09-29T15:00:00Z') }))
            .toContain('<p>Ces montants s’appliquent à compter du 1er octobre 2026.</p>');
        expect(presentation.oasTableSnapshot(table, 'fr', { now: new Date('2027-02-01T15:00:00Z') }))
            .toContain('<p>Ce sont les montants pour octobre à décembre 2026.');
    });

    test('once two quarters are loaded the hub shows what changed', async () => {
        hold(quarter(202609, { all: { top: 112317, oas65: 75100, oas75: 82610 } }), quarter(202612));
        const res = await request(spa).get('/oas');
        expect(res.text).toContain('<h2>Change from July to September 2026</h2>');
        expect(res.text).toContain('<th scope="col">Amount</th><th scope="col">July to September 2026</th><th scope="col">October to December 2026</th><th scope="col">Change</th>');
        expect(res.text).toContain('<tr><th scope="row">Table 1, maximum GIS</th><td>$1,123.17</td><td>$1,138.90</td><td>+1.4%</td></tr>');
        expect(res.text).toContain('<tr><th scope="row">Table 4, maximum Allowance</th><td>$1,128.17</td><td>$1,143.90</td><td>+1.4%</td></tr>');
        expect(res.text).toContain('<tr><th scope="row">Full OAS pension, age 75 and over</th><td>$826.10</td><td>$838.75</td><td>+1.5%</td></tr>');
        const fr = await request(spa).get('/fr/sv');
        expect(fr.text).toContain('<h2>Variation depuis juillet à septembre 2026</h2>');
        expect(fr.text).toContain('<td>+1,4' + NBSP + '%</td>');
    });
});

describe('links to the hub', () => {
    const dataset = { id: 'dfa4daf1-669e-4514-82cd-982f27707ed0', name: 'oas-amounts', title_en: 'Old Age Security (OAS) - Table of Benefit Amounts' };
    const resource = { id: 'res-1', dataset_id: dataset.id, name_en: 'Table 1 - GIS for single person', format: 'CSV', url: 'https://example.test/t1.csv' };
    const lmia = { id: '90fed587-1364-4f33-a9ee-208181dc0b97', name: 'lmia', title_en: 'TFWP: Positive LMIA Employers List' };

    test('every page the server renders links the hub in both languages, only while it has data', async () => {
        const count = html => (/<nav aria-label="CanQuery sections"[^>]*><ul>(.*?)<\/ul><\/nav>/s.exec(html)[1].match(/<li>/g) || []).length;
        expect(count(seoSnapshot.sectionNav())).toBe(8);
        expect(seoSnapshot.sectionNav()).not.toContain('/oas');
        await oas.summary();
        const nav = seoSnapshot.sectionNav();
        expect(count(nav)).toBe(10);
        expect(nav).toContain('<li><a href="/insights">Insights</a></li><li><a href="/oas">OAS and GIS amounts</a></li>' +
            '<li><a href="/fr/sv">Montants de la SV et du SRG</a></li><li><a href="/blog">Data guides</a></li>');
        expect(seoSnapshot.errorSnapshot('Page not found', 'Nothing here.')).toContain('<a href="/oas">OAS and GIS amounts</a>');
        // The hub is gone again (its tables were emptied): the links go with it.
        oas.cache.clear();
        hold();
        await oas.summary();
        expect(count(seoSnapshot.sectionNav())).toBe(8);
    });

    test('the dataset and its files lead to the hub while it has data; the LMIA callout is as it was', async () => {
        expect(hubSections(dataset.id)).toEqual([]);
        expect(seoSnapshot.datasetSnapshot(dataset, [])).not.toContain('Find an amount by income');
        await oas.summary();
        const page = seoSnapshot.datasetSnapshot(dataset, []);
        expect(page).toContain('<section><h2>Find an amount by income</h2><ul><li><a href="/oas">OAS and GIS amounts by income</a></li>' +
            '<li><a href="/fr/sv">Montants de la SV et du SRG selon le revenu</a> <span>(français)</span></li></ul></section>');
        expect(seoSnapshot.resourceSnapshot(resource)).toContain('<a href="/oas">OAS and GIS amounts by income</a>');
        expect(seoSnapshot.datasetSnapshot({ ...dataset, id: 'another-dataset' }, [])).not.toContain('Find an amount by income');
        expect(hubSections('constructor')).toEqual([]);
        expect(hubSections(lmia.id)).toEqual([{ title: 'Search every list by employer',
            links: [{ path: '/lmia', label: 'Positive LMIA employers: every list since 2014' }] }]);
        expect(seoSnapshot.datasetSnapshot(lmia, [])).toContain('<section><h2>Search every list by employer</h2><ul><li>' +
            '<a href="/lmia">Positive LMIA employers: every list since 2014</a></li></ul></section>');
    });

    test('the page tells the application which hubs have data', async () => {
        const html = '<html><head><title>x</title>\n  </head><body></body></html>';
        expect(injectHubs(html)).toBe(html);
        await oas.summary();
        expect(injectHubs(html)).toContain('<meta name="cq-hubs" content="oas" />\n  </head>');
        expect(injectHubs('<p>no head</p>')).toBe('<p>no head</p>');
        expect(hubAvailable('oas')).toBe(true);
    });

    test('the pages sitemap lists the twelve pages once a quarter is loaded, dated by that load', async () => {
        resetSitemapCache();
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        const listed = [...res.text.matchAll(/<loc>https:\/\/canquery\.com(\/(?:oas|fr\/sv)[^<]*)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)];
        expect(listed.map(match => match[1])).toEqual(['/oas', '/oas/table-1', '/oas/table-2', '/oas/table-3', '/oas/table-4', '/oas/table-5',
            '/fr/sv', '/fr/sv/tableau-1', '/fr/sv/tableau-2', '/fr/sv/tableau-3', '/fr/sv/tableau-4', '/fr/sv/tableau-5']);
        expect(new Set(listed.map(match => match[2]))).toEqual(new Set(['2026-11-11T04:49:54.000Z']));
        resetSitemapCache();
        oas.cache.clear();
        hold();
        const empty = await request(app).get('/sitemap-pages.xml');
        expect(empty.status).toBe(200);
        expect(empty.text).toContain('<loc>https://canquery.com/datasets</loc>');
        expect(empty.text).not.toMatch(/\/oas|\/fr\/sv/);
        // A read that fails leaves the file without them instead of failing it.
        resetSitemapCache();
        oas.cache.clear();
        queries.getOasPeriod.mockRejectedValue(new Error('relation "oas_periods" does not exist'));
        const failed = await request(app).get('/sitemap-pages.xml');
        expect(failed.status).toBe(200);
        expect(failed.text).not.toMatch(/\/oas|\/fr\/sv/);
    });
});

describe('wording shared with the application', () => {
    const client = fs.readFileSync(path.join(__dirname, '../../client/src/i18n.jsx'), 'utf8');
    const links = fs.readFileSync(path.join(__dirname, '../../client/src/utils/oas.js'), 'utf8');
    // Every string of an object, however deep.
    const strings = value => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

    test('table names, income definitions, column headings and the caveat are the same words in the application', () => {
        for (const lang of ['en', 'fr']) {
            const { twinLang, ...words } = labels.copy(lang);
            expect(['en', 'fr']).toContain(twinLang);
            for (const value of strings(words)) {
                expect([lang, value, client.includes("'" + value + "'")]).toEqual([lang, value, true]);
            }
        }
    });
    test('the official links are the same in the application', () => {
        for (const lang of ['en', 'fr']) {
            for (const link of labels.officialLinks(lang)) {
                expect([link.label, links.includes(link.label)]).toEqual([link.label, true]);
                const address = link.path.replace('dfa4daf1-669e-4514-82cd-982f27707ed0', '');
                expect([address, links.includes(address)]).toEqual([address, true]);
            }
        }
    });
    test('the application makes the same sections and prints the same characters', async () => {
        // The application's own module, as the browser runs it.
        const app = await import('../../client/src/utils/oas.js');
        const tables = [bands(1, { rows: 963 }), bands(1, { rows: 1140, width: 2027 }), bands(2, { rows: 686, width: 4800 }), bands(5, { rows: 1220 }),
            bands(4, { rows: 7 }), [[0, 409599, 113890, null, 190140, 197765], ...bands(3, { rows: 300, width: 4800 }).map(([from, to, ...rest]) => [from + 409600, to + 409600, ...rest])]];
        for (const rows of tables) {
            const mine = presentation.bandSections(rows).map(group => [group.id, group.from, group.to, group.rows.length]);
            expect(app.bandSections(rows).map(group => [group.id, group.from, group.to, group.rows.length])).toEqual(mine);
            expect(mine.length).toBeLessThanOrEqual(12);
        }
        expect(presentation.bandSections(bands(1, { rows: 963 })).map(group => group.id)).toEqual(
            Array.from({ length: 12 }, (_, index) => 'income-' + index * 2000));
        for (const lang of ['en', 'fr']) {
            for (const cents of [0, 1, 49, 99, 100, 999, 1000, 76250, 99999, 100000, 113890, 2311199, 2311200, 123456789, 99999999999]) {
                expect(app.formatMoney(cents, lang)).toBe(labels.formatMoney(cents, lang));
                expect(app.formatDollars(cents, lang)).toBe(labels.formatDollars(cents, lang));
                expect(app.formatBand(cents, cents + 2399, lang)).toBe(labels.formatBand(cents, cents + 2399, lang));
                expect(app.formatChange(cents + 1500, cents || 1, lang)).toBe(labels.formatChange(cents + 1500, cents || 1, lang));
            }
            for (const key of [202603, 202606, 202609, 202612, 202703]) {
                const period = labels.periodOf(key);
                expect(app.periodLabel(period, lang)).toBe(labels.periodLabel(period, lang));
                expect(app.periodLabel(period, lang, { short: true })).toBe(labels.periodLabel(period, lang, { short: true }));
                expect(app.dateLabel(period.start, lang)).toBe(labels.dateLabel(period.start, lang));
                for (const day of ['2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01']) expect(app.periodState(period, day)).toBe(labels.periodState(period, day));
            }
        }
    });
    test('headings of the server’s pages never read as Markdown', () => {
        for (const lang of ['en', 'fr']) {
            for (const value of strings(labels.copy(lang))) expect(value).not.toMatch(/^\d+\.|[*_`<>]/);
        }
    });
});
