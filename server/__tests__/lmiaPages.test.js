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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const queries = require('../db/lmiaQueries');
const catalogRead = require('../db/catalogReadQueries');
const lmia = require('../services/lmiaPages');
const { serveSpa } = require('../controllers/spaController');
const { resetSitemapCache } = require('../controllers/sitemapController');
const app = require('../app');

const SUMMARY = {
    latest: { resource_id: 'r-2026q2', period_key: 202606, period_kind: 'quarter', period_start: '2026-04-01', period_end: '2026-06-30',
        row_count: 7344, employers: 6501, positions: 21515, lmias: 9066, noc_version: 2021 },
    periods: [
        { resource_id: 'r-2014', period_key: 201412, period_kind: 'year', period_start: '2014-06-20', period_end: '2014-12-31',
            row_count: 3980, employers: 3970, positions: 60792, lmias: null, noc_version: null },
        { resource_id: 'r-2026q2', period_key: 202606, period_kind: 'quarter', period_start: '2026-04-01', period_end: '2026-06-30',
            row_count: 7344, employers: 6501, positions: 21515, lmias: 9066, noc_version: 2021 }
    ],
    employers_total: 150691,
    updated_at: new Date('2026-11-03T09:00:00Z'),
    provinces: [{ province: 'QC', employers: 2100, positions: 9200 }, { province: 'HO', employers: 3, positions: 4 }],
    streams: [{ stream: 'Low Wage', employers: 3000, positions: 9000 }],
    occupations: [{ code: '85101', title: 'Harvesting labourers', noc_version: 2021, employers: 693, positions: 7509 }],
    top_employers: [{ employer_key: 'les entreprises pitre', employer: 'Les Entreprises Pitre Inc.', province: 'QC', city: 'Mont-Laurier', positions: 276 }]
};
const ROWS = [
    { period_key: 202606, period_kind: 'quarter', period_start: '2026-04-01', period_end: '2026-06-30', resource_id: 'r-2026q2', line: 9,
        province: 'ON', stream: 'High Wage', employer: 'Danchar Ltd', address: 'Toronto, ON M5J 2X5', city: 'Toronto',
        occupation_code: '72310', occupation_title: 'Carpenters', noc_version: 2021, incorporation: 'Corporation', approved_lmias: 2, approved_positions: 5 },
    { period_key: 202606, period_kind: 'quarter', period_start: '2026-04-01', period_end: '2026-06-30', resource_id: 'r-2026q2', line: 10,
        province: 'ON', stream: 'High Wage', employer: 'Danchar Ltd', address: 'Toronto, ON M5J 2X5', city: 'Toronto',
        occupation_code: '72311', occupation_title: 'Cabinetmakers', noc_version: 2021, incorporation: 'Corporation', approved_lmias: 1, approved_positions: 7 },
    { period_key: 201512, period_kind: 'year', period_start: '2015-01-01', period_end: '2015-12-31', resource_id: 'r-2015', line: 4,
        province: 'AB', stream: null, employer: 'DANCHAR LTD.', address: 'Calgary, AB T2P 1J9', city: 'Calgary',
        occupation_code: null, occupation_title: null, noc_version: null, incorporation: null, approved_lmias: null, approved_positions: 3 }
];

beforeEach(() => {
    jest.clearAllMocks();
    lmia.cache.clear();
    queries.getLmiaSummary.mockResolvedValue(SUMMARY);
    queries.getLmiaEmployerRows.mockImplementation(async key => (key === 'danchar' ? ROWS : []));
    queries.searchLmiaEmployers.mockResolvedValue({ total: 1, rows: [{ employer_key: 'danchar', employer: 'Danchar Ltd', province: 'ON',
        city: 'Toronto', provinces: ['AB', 'ON'], first_period: 201512, last_period: 202606, periods: 2, positions: 15, last_positions: 12 }] });
});

describe('lmiaPages', () => {
    test('slugs and keys turn into each other and refuse anything else', () => {
        expect(lmia.slugOf('danchar construction')).toBe('danchar-construction');
        expect(lmia.keyOfSlug('danchar-construction')).toBe('danchar construction');
        for (const slug of ['Danchar', 'danchar--x', '-danchar', 'danchar_x', '', 'a'.repeat(201), null]) expect(lmia.keyOfSlug(slug)).toBeNull();
    });

    test('a search is read from q as an employer key, with a province, occupation and page', () => {
        expect(lmia.searchInput({ q: ' DANCHAR LTD. ', province: 'ON', occupation: '72310', page: '3' }))
            .toEqual({ q: 'DANCHAR LTD.', key: 'danchar', province: 'ON', occupation: '72310', page: 3 });
        expect(lmia.searchInput({ province: 'QC' })).toEqual({ q: '', key: '', province: 'QC', occupation: null, page: 1 });
        for (const empty of [{}, { q: '  ' }, { q: '---' }, { q: 'a' }, { q: 'É.' }, { q: 'a Inc' }]) {
            expect(() => lmia.searchInput(empty)).toThrow(expect.objectContaining({ statusCode: 400, publicCode: 'INVALID_QUERY' }));
        }
        // A single letter narrows nothing alone, but does with a province or an occupation.
        expect(lmia.searchInput({ q: 'ab' }).key).toBe('ab');
        expect(lmia.searchInput({ q: 'a', province: 'ON' }).key).toBe('a');
        expect(lmia.searchInput({ q: 'a', occupation: '72310' }).key).toBe('a');
        for (const query of [{ q: 'x'.repeat(101) }, { province: 'ZZ' }, { occupation: '723' }, { page: '0' }, { page: '201' },
            { page: '1.5' }, { q: ['a', 'b'] }]) {
            expect(() => lmia.searchInput(query)).toThrow(expect.objectContaining({ statusCode: 400, publicCode: 'INVALID_QUERY' }));
        }
    });

    test('an employer history groups lines by list, newest first', async () => {
        const employer = await lmia.employer('danchar');
        expect(employer).toMatchObject({ key: 'danchar', slug: 'danchar', name: 'Danchar Ltd', names: ['Danchar Ltd', 'DANCHAR LTD.'],
            provinces: ['AB', 'ON'], first_period: 201512, last_period: 202606, lists: 2, positions: 15, lmias: 3, truncated: false });
        // The 2015 list has no LMIA counts, so the total says which list it starts from.
        expect(employer.lmias_since).toEqual({ period_key: 202606, kind: 'quarter', start: '2026-04-01', end: '2026-06-30' });
        expect(employer.periods.map(period => [period.period_key, period.positions, period.lmias, period.streams])).toEqual([
            [202606, 12, 3, ['High Wage']], [201512, 3, null, []]]);
        expect(employer.periods[0].occupations.map(item => [item.code, item.positions])).toEqual([['72311', 7], ['72310', 5]]);
        expect(employer.periods[0].addresses).toEqual([{ address: 'Toronto, ON M5J 2X5', city: 'Toronto', province: 'ON' }]);
        expect(await lmia.employer('nobody')).toBeNull();
        expect(await lmia.employer('Not-A-Slug')).toBeNull();
        expect(queries.getLmiaEmployerRows).toHaveBeenCalledTimes(2);
    });

    test('a history longer than the limit drops its oldest, possibly partial, list and takes its totals from the view', async () => {
        const line = (period, index) => ({ ...ROWS[0], period_key: period, resource_id: 'r-' + period, line: index + 1,
            period_start: '2026-04-01', period_end: '2026-06-30', approved_lmias: 1, approved_positions: 1 });
        const rows = Array.from({ length: lmia.HISTORY_LIMIT + 1 }, (_, index) => line(index < 2000 ? 202606 : 202603, index));
        queries.getLmiaEmployerRows.mockResolvedValue(rows);
        queries.getLmiaEmployer.mockResolvedValue({ employer_key: 'danchar', provinces: ['AB', 'ON'], first_period: 201512, last_period: 202606,
            periods: 9, positions: 9001 });
        const employer = await lmia.employer('danchar');
        expect(queries.getLmiaEmployerRows).toHaveBeenCalledWith('danchar', { limit: lmia.HISTORY_LIMIT + 1 });
        expect(employer.periods.map(period => [period.period_key, period.positions])).toEqual([[202606, 2000]]);
        expect(employer).toMatchObject({ truncated: true, lists: 9, positions: 9001, first_period: 201512, provinces: ['AB', 'ON'], lmias: 2000 });
        expect(employer.lmias_since.period_key).toBe(202606);
        // Exactly the limit is whole.
        lmia.cache.clear();
        queries.getLmiaEmployerRows.mockResolvedValue(rows.slice(0, lmia.HISTORY_LIMIT));
        expect((await lmia.employer('danchar')).truncated).toBe(false);
        expect(queries.getLmiaEmployer).toHaveBeenCalledTimes(1);
    });

    test('the history is not ready until a load has refreshed the employers', async () => {
        queries.getLmiaSummary.mockResolvedValue({ ...SUMMARY, employers_total: 0 });
        expect(await lmia.summary()).toBeNull();
    });

    test('answers are cached', async () => {
        await lmia.summary();
        await lmia.summary();
        expect(queries.getLmiaSummary).toHaveBeenCalledTimes(1);
    });
});

describe('/web-api/v1/lmia', () => {
    test('the summary, with the dataset id, employer slugs and the licence', async () => {
        const res = await request(app).get('/web-api/v1/lmia/summary');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        expect(res.body.data).toMatchObject({ dataset_id: '90fed587-1364-4f33-a9ee-208181dc0b97', employers_total: 150691 });
        expect(res.body.data.top_employers[0].slug).toBe('les-entreprises-pitre');
        expect(res.body.meta.license).toBe('Open Government Licence - Canada');
    });

    test('503 before the first load, and while a first load has lists but no employers yet', async () => {
        for (const notReady of [null, { ...SUMMARY, employers_total: 0 }]) {
            lmia.cache.clear();
            queries.getLmiaSummary.mockResolvedValue(notReady);
            const res = await request(app).get('/web-api/v1/lmia/summary');
            expect(res.status).toBe(503);
            expect(res.body.code).toBe('LMIA_HISTORY_UNAVAILABLE');
            const search = await request(app).get('/web-api/v1/lmia/employers?q=danchar');
            expect(search.status).toBe(503);
        }
    });

    test('employer search pages through the view by key, province and occupation', async () => {
        const res = await request(app).get('/web-api/v1/lmia/employers?q=Danchar%20Ltd.&province=ON&occupation=72310&page=2');
        expect(res.status).toBe(200);
        expect(queries.searchLmiaEmployers).toHaveBeenCalledWith({ key: 'danchar', province: 'ON', occupation: '72310', limit: 50, offset: 50 });
        expect(res.body.data).toMatchObject({ total: 1, page: 2, page_size: 50, max_page: 200 });
        expect(res.body.data.rows[0].slug).toBe('danchar');
        const bad = await request(app).get('/web-api/v1/lmia/employers?province=XX');
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe('INVALID_QUERY');
    });

    test('one employer, or 404', async () => {
        const res = await request(app).get('/web-api/v1/lmia/employers/danchar');
        expect(res.status).toBe(200);
        expect(res.body.data.periods).toHaveLength(2);
        expect((await request(app).get('/web-api/v1/lmia/employers/Danchar')).body.data.key).toBe('danchar');
        const missing = await request(app).get('/web-api/v1/lmia/employers/nobody');
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe('LMIA_EMPLOYER_NOT_FOUND');
    });

    test('is not part of the developer API', async () => {
        expect((await request(app).get('/api/v1/lmia/summary')).status).toBe(404);
    });
});

describe('the /lmia pages', () => {
    let distDir;
    let spa;
    beforeAll(() => {
        distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-lmia-'));
        fs.writeFileSync(path.join(distDir, 'index.html'),
            '<!doctype html><html><head><!-- seo:start --><title>x</title><!-- seo:end --></head><body><div id="root"></div></body></html>');
        spa = express();
        spa.get(/.*/, serveSpa(distDir));
    });
    afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));

    test('the hub is indexable, with the latest list, every list and the employers to look up', async () => {
        const res = await request(spa).get('/lmia');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>Positive LMIA employers list 2026: search every quarter - CanQuery</title>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/lmia"');
        expect(res.text).not.toContain('noindex');
        expect(res.text.match(/<h1>/g)).toHaveLength(1);
        expect(res.text).toContain('<h1>Positive LMIA employers list</h1>');
        expect(res.text).toContain('href="/lmia/employers/les-entreprises-pitre"');
        expect(res.text).toContain('href="/resources/r-2014"');
        expect(res.text).toContain('June 20 to December 31, 2014 list');
        expect(res.text).toContain('Head office outside Canada');
        expect(res.text).toContain('It is not a job offer or a work permit');
    });

    test('before the first load the hub says so and is not indexed', async () => {
        queries.getLmiaSummary.mockResolvedValue(null);
        const res = await request(spa).get('/lmia');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<meta name="robots" content="noindex, follow"');
        expect(res.text).toContain('is being loaded');
    });

    test('an employer page is served but never indexed; an unknown one is a 404', async () => {
        const res = await request(spa).get('/lmia/employers/danchar');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<meta name="robots" content="noindex, follow"');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/lmia/employers/danchar"');
        expect(res.text).toContain('<h1>Danchar Ltd</h1>');
        expect(res.text).toContain('Also listed as');
        for (const target of ['/lmia/employers/nobody', '/lmia/employers/Nobody', '/lmia/employers/%E0%A4%A']) {
            const missing = await request(spa).get(target);
            expect(missing.status).toBe(404);
            expect(missing.text).toContain('noindex');
        }
    });

    test('a trailing slash, an encoded slug or capitals redirect to the canonical address', async () => {
        const res = await request(spa).get('/lmia/');
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/lmia');
        for (const target of ['/lmia/employers/danchar/', '/lmia/employers/Danchar', '/lmia/employers/%64anchar']) {
            const moved = await request(spa).get(target);
            expect([target, moved.status, moved.headers.location]).toEqual([target, 301, '/lmia/employers/danchar']);
        }
    });

    test('a first load with lists but no employers keeps the hub out of the index', async () => {
        queries.getLmiaSummary.mockResolvedValue({ ...SUMMARY, employers_total: 0 });
        const res = await request(spa).get('/lmia');
        expect(res.text).toContain('<meta name="robots" content="noindex, follow"');
        expect(res.text).not.toContain('Search 0 employers');
    });

    test('employer names and addresses are shown as published and always escaped', async () => {
        const hostile = '1. Choice <img src=x onerror=alert(1)> Café <Ouest> & Fils </script>';
        queries.getLmiaEmployerRows.mockResolvedValue([{ ...ROWS[0], employer: hostile, address: '*Unit* 4 <b>Main</b> St' },
            { ...ROWS[2], employer: '# Danchar' }]);
        const res = await request(spa).get('/lmia/employers/danchar');
        expect(res.status).toBe(200);
        const escaped = '1. Choice &lt;img src=x onerror=alert(1)&gt; Café &lt;Ouest&gt; &amp; Fils &lt;/script&gt;';
        expect(res.text).toContain('<h1>' + escaped + '</h1>');
        expect(res.text).toContain('Also listed as</dt><dd># Danchar</dd>');
        expect(res.text).toContain('<span aria-current="page">' + escaped + '</span>');
        expect(res.text).not.toMatch(/<img|<Ouest>|<\/script> /);
        const head = res.text.slice(0, res.text.indexOf('</head>'));
        expect(head).toContain('<title>1. Choice &lt;img src=x onerror=alert(1)&gt; Café &lt;Ouest&gt;');
        expect(head.match(/<\/script>/g)).toHaveLength(head.match(/<script/g).length);
        expect(res.text).toContain('Different employers can share a name');
    });

    test('the LMIA dataset and its files link to the employer search', async () => {
        const { datasetSnapshot, resourceSnapshot } = require('../services/seoSnapshot');
        const dataset = { id: '90fed587-1364-4f33-a9ee-208181dc0b97', name: 'lmia', title_en: 'TFWP: Positive LMIA Employers List' };
        expect(datasetSnapshot(dataset, [])).toContain('<a href="/lmia">Positive LMIA employers: every list since 2014</a>');
        expect(datasetSnapshot({ ...dataset, id: 'another-dataset' }, [])).not.toContain('href="/lmia"');
        const resource = { id: 'r-2026q2', dataset_id: dataset.id, name_en: '2026Q2 employers', format: 'XLSX', url: 'https://example.test/x.xlsx' };
        expect(resourceSnapshot(resource, dataset)).toContain('<a href="/lmia">');
    });

    test('the pages sitemap lists the hub once its employers are loaded, dated by their refresh', async () => {
        resetSitemapCache();
        catalogRead.getCatalogLastModified.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<url>\s*<loc>https:\/\/canquery\.com\/lmia<\/loc>\s*<lastmod>2026-11-03T09:00:00\.000Z<\/lastmod>/);
        for (const notReady of [null, { ...SUMMARY, employers_total: 0 }]) {
            resetSitemapCache();
            lmia.cache.clear();
            queries.getLmiaSummary.mockResolvedValue(notReady);
            const empty = await request(app).get('/sitemap-pages.xml');
            expect(empty.status).toBe(200);
            expect(empty.text).toContain('<loc>https://canquery.com/datasets</loc>');
            expect(empty.text).not.toContain('/lmia');
        }
    });
});
