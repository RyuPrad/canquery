jest.mock('../db/pool', () => ({ query: jest.fn() }));
const express = require('express');
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalogRead = require('../db/catalogReadQueries');
const { resolvePage, serveSpa } = require('../controllers/spaController');
const { resourceSnapshot } = require('../services/seoSnapshot');
const { resourcePresentation } = require('../services/catalogPresentation');
const { resourceMeta } = require('../services/seoMeta');

const records = Array.from({ length: 101 }, (_, i) => ({
    id: 'record-' + i, name: 'record-' + i, slug: 'record-' + i,
    title_en: 'Catalogue record ' + i, name_en: 'Catalogue record ' + i,
    kind: 'municipality', dataset_count: 1
}));
// One file has a live table, so the dataset's first page is one a search engine may index.
const files = records.map((row, i) => ({ ...row, format: 'PDF', url: 'https://example.test/' + row.id + '.pdf', datastore_active: i === 0 }));
const listing = ({ limit, offset }) => Promise.resolve(records.slice(offset, offset + limit));
const dependencies = () => ({
    searchDatasets: jest.fn(listing), listOrganizations: jest.fn(listing), listPlaces: jest.fn(listing),
    getDatasetByIdOrName: jest.fn().mockResolvedValue({ id: 'd', name: 'example', title_en: 'Example data' }),
    listResourcesForDataset: jest.fn().mockResolvedValue(files),
    getOrganizationByName: jest.fn().mockResolvedValue({ name: 'example', title_en: 'Example publisher', dataset_count: 101 }),
    getPlaceByIdOrSlug: jest.fn().mockResolvedValue({ id: 'p', slug: 'example', name_en: 'Example place', dataset_count: 101 })
});

test.each([
    ['/datasets', 'datasets'], ['/organizations/example', 'datasets'], ['/places/example', 'datasets'],
    ['/organizations', 'organizations'], ['/places', 'places'], ['/datasets/example', 'resources']
])('initial HTML exposes the complete %s list through canonical page links', async (route, family) => {
    const deps = dependencies();
    const seen = [];
    for (let number = 1; number <= 3; number++) {
        const url = route + (number > 1 ? '?page=' + number : '');
        const page = await resolvePage(url, deps);
        expect(page.status).toBe(200);
        expect(page.meta.canonical).toBe('https://canquery.com' + url);
        // Page one is the landing page; later pages are followed, not indexed.
        expect(Boolean(page.meta.noindex)).toBe(number > 1);
        const collection = page.meta.jsonLd?.find(item => item['@type'] === 'CollectionPage');
        if (collection) {
            expect(collection.url).toBe(page.meta.canonical);
            expect(collection.mainEntity.itemListElement[0].position).toBe((number - 1) * 50 + 1);
        }
        const matches = [...page.body.matchAll(new RegExp('href="/' + family + '/(record-\\d+)"', 'g'))];
        expect(matches).toHaveLength(number === 3 ? 1 : 50);
        seen.push(...matches.map(match => match[1]));
        if (number < 3) expect(page.body).toContain('href="' + route + '?page=' + (number + 1) + '"');
        if (number > 1) expect(page.body).toContain('aria-current="page">Page ' + number);
    }
    expect(new Set(seen).size).toBe(101);
    expect((await resolvePage(route + '?page=4', deps)).status).toBe(404);
});

test.each(['0', '-1', '01', '1.5', 'abc', '9007199254740991', '2&page=3'])('rejects invalid page %s before querying', async value => {
    const deps = dependencies();
    const page = await resolvePage('/datasets?page=' + value, deps);
    expect(page.status).toBe(404);
    expect(page.meta.noindex).toBe(true);
    expect(deps.searchDatasets).not.toHaveBeenCalled();
});

test('normalizes page one and aliases together, preserving unrelated deep-link state', async () => {
    const deps = dependencies();
    const spies = Object.entries(deps).map(([key, value]) => jest.spyOn(catalogRead, key).mockImplementation(value));
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-discovery-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<html><head><!-- seo:start --><!-- seo:end --></head><body><div id="root"></div></body></html>');
    try {
        const app = express();
        app.get(/.*/, serveSpa(dist));
        const first = await request(app).get('/datasets/d?page=1&highlight=record-60');
        expect(first.status).toBe(301);
        expect(first.headers.location).toBe('/datasets/example?highlight=record-60');
        const next = await request(app).get('/datasets/example?page=2');
        expect(next.status).toBe(200);
        expect(next.text).toContain('rel="canonical" href="https://canquery.com/datasets/example?page=2"');
        expect(next.text).toContain('<meta name="robots" content="noindex, follow" />');
        const landing = await request(app).get('/datasets/example');
        expect(landing.status).toBe(200);
        expect(landing.text).not.toContain('name="robots"');
        const absent = await request(app).get('/datasets/example?page=4');
        expect(absent.status).toBe(404);
        expect(absent.text).toContain('name="robots" content="noindex');
    } finally {
        spies.forEach(spy => spy.mockRestore());
        fs.rmSync(dist, { recursive: true, force: true });
    }
});

// The index policy answers Google; with INDEX_POLICY_ENGINES=google its noindex tags name Google's crawler
// alone, so other engines read the pages as they did before the policy.
test.each([[undefined, 'robots'], ['all', 'robots'], ['google', 'googlebot']])(
    'with INDEX_POLICY_ENGINES %p a page the policy turned noindex is served with a %s tag', async (engines, name) => {
        const before = process.env.INDEX_POLICY_ENGINES;
        if (engines === undefined) delete process.env.INDEX_POLICY_ENGINES; else process.env.INDEX_POLICY_ENGINES = engines;
        const csv = { id: 'r1', dataset_id: 'd', dataset_name: 'example', dataset_title_en: 'Example data', name_en: 'Rows',
            format: 'CSV', url: 'https://example.test/rows.csv', size_bytes: 1000 };
        const pdf = { ...csv, id: 'r2', name_en: 'Report', format: 'PDF', url: 'https://example.test/report.pdf' };
        const live = { ...csv, id: 'r3', name_en: 'Live rows', datastore_active: true };
        const byId = { r1: csv, r2: pdf, r3: live };
        const deps = {
            ...dependencies(),
            // Files a reader can download or CanQuery could prepare: no table now, so the dataset page is noindex.
            listResourcesForDataset: jest.fn().mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ ...csv, id: 'file-' + i }))),
            getResourceById: jest.fn(id => Promise.resolve(byId[id] || null))
        };
        const spies = Object.entries(deps).map(([key, value]) => jest.spyOn(catalogRead, key).mockImplementation(value));
        // No stored row sample for the file pages.
        const pool = require('../db/pool');
        pool.query.mockResolvedValue({ rows: [] });
        const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-engines-'));
        fs.writeFileSync(path.join(dist, 'index.html'), '<html><head><!-- seo:start --><!-- seo:end --></head><body><div id="root"></div></body></html>');
        const tags = text => [...text.matchAll(/<meta name="(robots|googlebot)" content="([^"]*)" \/>/g)].map(match => match[1] + ': ' + match[2]);
        try {
            const app = express();
            app.get(/.*/, serveSpa(dist));
            const dataset = await request(app).get('/datasets/example');
            expect(dataset.status).toBe(200);
            expect(tags(dataset.text)).toEqual([name + ': noindex, follow']);
            const notLoaded = await request(app).get('/resources/r1');
            expect(notLoaded.status).toBe(200);
            expect(tags(notLoaded.text)).toEqual([name + ': noindex, follow']);
            // Later pages of the file list, a download-only file and a missing page tell every engine.
            expect(tags((await request(app).get('/datasets/example?page=2')).text)).toEqual(['robots: noindex, follow']);
            expect(tags((await request(app).get('/resources/r2')).text)).toEqual(['robots: noindex, follow']);
            const missing = await request(app).get('/resources/nope');
            expect(missing.status).toBe(404);
            expect(tags(missing.text)).toEqual(['robots: noindex, follow']);
            // A file with a table is indexable by everyone.
            expect(tags((await request(app).get('/resources/r3')).text)).toEqual([]);
        } finally {
            spies.forEach(spy => spy.mockRestore());
            pool.query.mockReset();
            fs.rmSync(dist, { recursive: true, force: true });
            if (before === undefined) delete process.env.INDEX_POLICY_ENGINES; else process.env.INDEX_POLICY_ENGINES = before;
        }
    });

test('download-only initial HTML contains a usable original link and cleaned publisher context', () => {
    const row = { id: 'r', dataset_id: 'd', dataset_name: 'example', name_en: 'Report', format: 'PDF',
        url: 'https://example.test/report.pdf?a=1&b=2', dataset_notes_en: '<p>Quarterly <b>waiting times</b>.</p><script>bad()</script>' };
    const html = resourceSnapshot(row);
    expect(html).toContain('href="https://example.test/report.pdf?a=1&amp;b=2"');
    expect(html).toMatch(/Quarterly waiting times\s*\./);
    expect(html).not.toContain('<script>');
    expect(resourceSnapshot({ ...row, url: 'javascript:alert(1)' })).not.toContain('href="javascript:');
    expect(resourceSnapshot({ ...row, url: 'https://user:secret@example.test/file' })).not.toContain('user:secret');
});

test('date-only files retain subject, period, language and format without merging editions', () => {
    const row = { id: 'r-en', name_en: '2020-04-01 to 2020-06-30', dataset_title_en: 'Wait Time Tool',
        dataset_title_fr: 'Outil de délais', language: 'en', format: 'CSV' };
    const en = resourcePresentation(row);
    const fr = resourcePresentation({ ...row, id: 'r-fr', language: 'fr' });
    expect(en.title.en).toBe('Wait Time Tool — 2020-04-01 to 2020-06-30 (English, CSV)');
    expect(fr.title.fr).toContain('Outil de délais — 2020-04-01 to 2020-06-30 (français, CSV)');
    const long = { ...row, dataset_title_en: 'A lengthy publisher dataset title '.repeat(10) };
    const meta = resourceMeta(long);
    expect(meta.title.length).toBeLessThanOrEqual(80);
    // A cut <title> gives up the default "English" first; the French edition keeps its word, so the two still differ.
    expect(meta.title).toContain('2020-04-01 to 2020-06-30 (CSV table)');
    expect(resourceMeta({ ...long, id: 'r-fr', language: 'fr' }).title).toContain('2020-04-01 to 2020-06-30 (French, CSV table)');
    expect(meta.title).not.toContain('…');
    expect(resourceMeta(row).canonical).not.toBe(resourceMeta({ ...row, id: 'r-fr' }).canonical);
});
