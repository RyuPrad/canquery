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
const files = records.map(row => ({ ...row, format: 'PDF', url: 'https://example.test/' + row.id + '.pdf' }));
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
        const absent = await request(app).get('/datasets/example?page=4');
        expect(absent.status).toBe(404);
        expect(absent.text).toContain('name="robots" content="noindex');
    } finally {
        spies.forEach(spy => spy.mockRestore());
        fs.rmSync(dist, { recursive: true, force: true });
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
    const meta = resourceMeta({ ...row, dataset_title_en: 'A lengthy publisher dataset title '.repeat(10) });
    expect(meta.title.length).toBeLessThanOrEqual(80);
    expect(meta.title).toContain('2020-04-01 to 2020-06-30 (English, CSV)');
    expect(resourceMeta(row).canonical).not.toBe(resourceMeta({ ...row, id: 'r-fr' }).canonical);
});
