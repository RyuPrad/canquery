jest.mock('../db/snapshotRead', () => ({ withSnapshot: async (_id, callback) => callback(), snapshotDb: () => require('../db/pool') }));
jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(),
    getDatasetByIdOrName: jest.fn(),
    listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(),
    listOrganizations: jest.fn(),
    listPlaces: jest.fn(),
    getOrganizationByName: jest.fn(),
    getStats: jest.fn(),
    countSitemapDatasets: jest.fn(),
    listDatasetSitemap: jest.fn(),
    countSitemapResources: jest.fn(),
    listResourceSitemap: jest.fn(),
    listPlaceSitemap: jest.fn(),
    listOrganizationSitemap: jest.fn(),
    getCatalogLastModified: jest.fn(),
    listTopDownloadLinks: jest.fn(),
    getPlaceByIdOrSlug: jest.fn(),
    pingDb: jest.fn(),
    getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn(),
    getJobHealth: jest.fn(),
}));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalogRead = require('../db/catalogReadQueries');
const store = require('../db/storeQueries');
const queryLog = require('../db/queryLogQueries');
const app = require('../app');
const { serveSpa, resolvePage, resolveMeta, injectAnalytics } = require('../controllers/spaController');
const { resetSitemapCache } = require('../controllers/sitemapController');
const catalogReadCache = require('../services/catalogReadCache');
const { listArticles } = require('../services/blogContent');

beforeEach(() => {
    jest.resetAllMocks();
    resetSitemapCache();
    catalogReadCache.clear();
    catalogRead.searchDatasets.mockResolvedValue([]);
    catalogRead.listOrganizations.mockResolvedValue([]);
    catalogRead.listPlaces.mockResolvedValue([]);
});

const newestGuideUpdate = () => ['en', 'fr'].flatMap(lang => listArticles({ lang })).map(article => article.updated).sort().at(-1);

describe('template path', () => {
    it('redirects the raw SPA template to the homepage', async () => {
        for (const path of ['/index.html', '/index.htm']) {
            const res = await request(app).get(path);
            expect(res.status).toBe(301);
            expect(res.headers.location).toBe('/');
            expect(res.headers['cache-control']).toBe('public, max-age=3600');
        }
    });
});

describe('robots.txt', () => {
    it('allows all reads, disallows only preparation writes and points at the sitemap index', async () => {
        const res = await request(app).get('/robots.txt');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toContain('User-agent: *');
        expect(res.text).toContain('Allow: /\n');
        expect(res.text).toContain('Sitemap: https://canquery.com/sitemap.xml');
        expect(res.text.split('\n').filter(line => line.startsWith('Disallow:'))).toEqual([
            'Disallow: /web-api/v1/resources/*/prepare',
            'Disallow: /web-api/v1/resources/*/ingest',
            'Disallow: /web-api/v1/resources/*/activity',
            'Disallow: /api/v1/resources/*/prepare',
            'Disallow: /api/v1/resources/*/ingest',
            'Disallow: /api/v1/resources/*/activity'
        ]);
        expect(res.headers['x-robots-tag']).toBeUndefined();
    });
});

describe('sitemap index', () => {
    it('lists one chunk per 25k datasets and data-bearing resources, dated by the newest change each file can hold', async () => {
        catalogRead.countSitemapDatasets.mockResolvedValue(30000);
        catalogRead.countSitemapResources.mockResolvedValue(26000);
        catalogRead.getCatalogLastModified.mockResolvedValue('2026-10-01T00:00:00Z');
        const res = await request(app).get('/sitemap.xml');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/xml/);
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-pages.xml</loc>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-places.xml</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-organizations.xml</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-blog.xml</loc><lastmod>' + newestGuideUpdate() + '</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-datasets-1.xml</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-datasets-2.xml</loc>');
        expect(res.text).not.toContain('sitemap-datasets-3.xml');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-resources-1.xml</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-resources-2.xml</loc>');
        expect(res.text).not.toContain('sitemap-resources-3.xml');
        // The hub file is as new as the newest of the catalogue and the guides.
        const pagesDate = [new Date('2026-10-01T00:00:00Z'), new Date(newestGuideUpdate())].sort((a, b) => b - a)[0];
        const expected = pagesDate.toISOString() === '2026-10-01T00:00:00.000Z' ? '2026-10-01T00:00:00.000Z' : newestGuideUpdate();
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-pages.xml</loc><lastmod>' + expected + '</lastmod>');
    });

    it('always emits a dataset chunk but omits empty resource chunks, and omits lastmod when unknown', async () => {
        catalogRead.countSitemapDatasets.mockResolvedValue(0);
        catalogRead.countSitemapResources.mockResolvedValue(0);
        catalogRead.getCatalogLastModified.mockResolvedValue(null);
        const res = await request(app).get('/sitemap.xml');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-datasets-1.xml</loc></sitemap>');
        expect(res.text).not.toContain('sitemap-resources-1.xml');
    });

    it('reads the counts and the change date once per hour instead of on every request', async () => {
        catalogRead.countSitemapDatasets.mockResolvedValue(10);
        catalogRead.countSitemapResources.mockResolvedValue(10);
        catalogRead.getCatalogLastModified.mockResolvedValue('2026-10-01T00:00:00Z');
        await request(app).get('/sitemap.xml');
        await request(app).get('/sitemap.xml');
        await request(app).get('/sitemap-pages.xml');
        expect(catalogRead.countSitemapResources).toHaveBeenCalledTimes(1);
        expect(catalogRead.countSitemapDatasets).toHaveBeenCalledTimes(1);
        expect(catalogRead.getCatalogLastModified).toHaveBeenCalledTimes(1);
    });

    it('tells crawlers to retry when the catalogue cannot be read, without leaking the error', async () => {
        catalogRead.countSitemapDatasets.mockResolvedValue(10);
        catalogRead.countSitemapResources.mockRejectedValue(new Error('private database detail'));
        catalogRead.listPlaceSitemap.mockRejectedValue(new Error('private database detail'));
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            for (const path of ['/sitemap.xml', '/sitemap-places.xml']) {
                const res = await request(app).get(path);
                expect(res.status).toBe(503);
                expect(res.headers['retry-after']).toBe('60');
                expect(res.headers['cache-control']).toBe('no-store');
                expect(res.headers['content-type']).toMatch(/text\/plain/);
                expect(res.text).not.toContain('private database detail');
            }
        } finally {
            log.mockRestore();
        }
    });
});

describe('pages sitemap', () => {
    it('includes the home and section hubs, dating the catalogue hubs only', async () => {
        catalogRead.getCatalogLastModified.mockResolvedValue('2026-10-01T00:00:00Z');
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<loc>https://canquery.com/</loc>\n    <lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/datasets</loc>\n    <lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/places</loc>\n    <lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/insights</loc>\n    <lastmod>2026-10-01T00:00:00.000Z</lastmod>');
        expect(res.text).toMatch(/<loc>https:\/\/canquery\.com\/docs<\/loc>\n\s+<changefreq>/);
        expect(res.text).toMatch(/<loc>https:\/\/canquery\.com\/about<\/loc>\n\s+<changefreq>/);
        expect(res.text).toContain('<loc>https://canquery.com/privacy</loc>');
        expect(res.text).toContain('<loc>https://canquery.com/faq</loc>');
        expect(res.text).not.toMatch(/\/account|\/signup|\/api\/v1/);
    });
});

describe('analytics configuration injection', () => {
    const template = '<head><!-- analytics:config --></head>';

    it('injects only a valid website id into the static bootstrap marker', () => {
        const id = '123e4567-e89b-42d3-a456-426614174000';
        expect(injectAnalytics(template, id)).toContain('content="' + id + '"');
        expect(injectAnalytics(template, '" /><script>bad</script>')).toBe('<head></head>');
    });

    it('accepts UUIDv7 website ids generated by the analytics service', () => {
        const id = '01a02c60-cd0a-77f4-8680-7e9e317534a1';
        expect(injectAnalytics(template, id)).toContain('content="' + id + '"');
    });

    it('removes the marker when analytics is not configured', () => {
        expect(injectAnalytics(template, '')).toBe('<head></head>');
    });
});

describe('dataset sitemap chunk', () => {
    it('emits a url per dataset using its slug + lastmod, id as fallback', async () => {
        catalogRead.listDatasetSitemap.mockResolvedValue([
            { id: 'd1', name: 'water-quality', metadata_modified: '2026-01-02T00:00:00Z' },
            { id: 'd2', name: null, metadata_modified: null },
        ]);
        const res = await request(app).get('/sitemap-datasets-1.xml');
        expect(res.status).toBe(200);
        expect(catalogRead.listDatasetSitemap).toHaveBeenCalledWith({ limit: 25000, offset: 0 });
        expect(res.text).toContain('<loc>https://canquery.com/datasets/water-quality</loc>');
        expect(res.text).toContain('<lastmod>2026-01-02T00:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/datasets/d2</loc>');
    });

    it('computes the offset from the chunk number', async () => {
        catalogRead.listDatasetSitemap.mockResolvedValue([{ id: 'd9', name: 'x', metadata_modified: null }]);
        await request(app).get('/sitemap-datasets-3.xml');
        expect(catalogRead.listDatasetSitemap).toHaveBeenCalledWith({ limit: 25000, offset: 50000 });
    });

    it('404s past the last chunk', async () => {
        catalogRead.listDatasetSitemap.mockResolvedValue([]);
        const res = await request(app).get('/sitemap-datasets-99.xml');
        expect(res.status).toBe(404);
    });
});

describe('resource sitemap chunk', () => {
    it('emits canonical resource urls with the file or dataset change date', async () => {
        catalogRead.listResourceSitemap.mockResolvedValue([
            { id: 'r1', lastmod: '2026-08-27T12:00:00Z' },
            { id: 'r/2', lastmod: null }
        ]);
        const res = await request(app).get('/sitemap-resources-1.xml');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/xml/);
        expect(catalogRead.listResourceSitemap).toHaveBeenCalledWith({ limit: 25000, offset: 0 });
        expect(res.text).toContain('<loc>https://canquery.com/resources/r1</loc>');
        expect(res.text).toContain('<lastmod>2026-08-27T12:00:00.000Z</lastmod>');
        expect(res.text).toContain('<loc>https://canquery.com/resources/r%2F2</loc>');
    });

    it('computes chunk offsets and 404s beyond the current resource set', async () => {
        catalogRead.listResourceSitemap
            .mockResolvedValueOnce([{ id: 'r9', lastmod: null }])
            .mockResolvedValueOnce([]);
        await request(app).get('/sitemap-resources-3.xml');
        expect(catalogRead.listResourceSitemap).toHaveBeenNthCalledWith(1, {
            limit: 25000,
            offset: 50000
        });
        const res = await request(app).get('/sitemap-resources-99.xml');
        expect(res.status).toBe(404);
    });

    it('rejects malformed chunk numbers without querying the catalogue', async () => {
        const res = await request(app).get('/sitemap-resources-1x.xml');
        expect(res.status).toBe(404);
        expect(catalogRead.listResourceSitemap).not.toHaveBeenCalled();
    });
});

describe('place sitemap', () => {
    it('emits only place rows supplied by the active-dataset query', async () => {
        catalogRead.listPlaceSitemap.mockResolvedValue([
            { slug: 'oshawa-on', metadata_modified: '2026-08-01T00:00:00Z' },
            { slug: 'ottawa-on', metadata_modified: '2026-08-23T00:00:00Z' }
        ]);
        const res = await request(app).get('/sitemap-places.xml');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<loc>https://canquery.com/places/oshawa-on</loc>');
        expect(res.text).toContain('<loc>https://canquery.com/places/ottawa-on</loc>');
        expect(res.text).toContain('<lastmod>2026-08-01T00:00:00.000Z</lastmod>');
    });
});

describe('organization sitemap', () => {
    it('emits canonical organization pages with their latest dataset modification', async () => {
        catalogRead.listOrganizationSitemap.mockResolvedValue([
            { name: 'city-works', metadata_modified: '2026-08-30T00:00:00Z' }
        ]);
        const res = await request(app).get('/sitemap-organizations.xml');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<loc>https://canquery.com/organizations/city-works</loc>');
        expect(res.text).toContain('<lastmod>2026-08-30T00:00:00.000Z</lastmod>');
    });
});

describe('resolveMeta routing', () => {
    it('resolves a dataset via the DB and includes Dataset JSON-LD', async () => {
        const deps = {
            getDatasetByIdOrName: jest.fn().mockResolvedValue({ id: 'd1', name: 'n1', title_en: 'T', notes_en: 'N' }),
            listResourcesForDataset: jest.fn().mockResolvedValue([]),
            getResourceById: jest.fn(),
        };
        const meta = await resolveMeta('/datasets/n1', deps);
        expect(deps.getDatasetByIdOrName).toHaveBeenCalledWith('n1');
        expect(meta.title).toBe('T - CanQuery');
        expect(meta.jsonLd[0]['@type']).toBe('Dataset');
    });

    it('returns noindex not-found meta for an unknown dataset (no resource lookup)', async () => {
        const deps = {
            getDatasetByIdOrName: jest.fn().mockResolvedValue(null),
            listResourcesForDataset: jest.fn(),
            getResourceById: jest.fn(),
        };
        const meta = await resolveMeta('/datasets/ghost', deps);
        expect(meta.noindex).toBe(true);
        expect(deps.listResourcesForDataset).not.toHaveBeenCalled();
    });

    it('resolves a resource page', async () => {
        const deps = {
            getResourceById: jest.fn().mockResolvedValue({
                id: 'r1', dataset_id: 'd1', dataset_name: 'dataset-slug',
                name_en: 'File', format: 'CSV', dataset_title_en: 'DS'
            }),
            getDatasetByIdOrName: jest.fn(),
            listResourcesForDataset: jest.fn(),
        };
        const meta = await resolveMeta('/resources/r1', deps);
        expect(meta.title).toBe('DS (CSV table) - CanQuery');
        expect(meta.canonical).toBe('https://canquery.com/resources/r1');
        const breadcrumb = meta.jsonLd.find(item => item['@type'] === 'BreadcrumbList');
        expect(breadcrumb.itemListElement[1].item).toBe('https://canquery.com/datasets/dataset-slug');
    });

    it('resolves a place page from its stable slug', async () => {
        const deps = {
            getPlaceByIdOrSlug: jest.fn().mockResolvedValue({
                id: 'ca-on-oshawa', slug: 'oshawa-on', name_en: 'Oshawa', type_en: 'City',
                dataset_count: 10, mappable_dataset_count: 4,
                ancestors: [{ id: 'ca-on-oshawa', slug: 'oshawa-on', name_en: 'Oshawa' }]
            }),
            searchDatasets: jest.fn().mockResolvedValue([])
        };
        const meta = await resolveMeta('/places/oshawa-on', deps);
        expect(deps.getPlaceByIdOrSlug).toHaveBeenCalledWith('oshawa-on');
        expect(meta.title).toContain('Oshawa');
        expect(meta.noindex).not.toBe(true);
        expect(meta.jsonLd.some(item => item['@type'] === 'BreadcrumbList')).toBe(true);
    });

    it('uses static home meta without touching the DB', async () => {
        const deps = { getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn() };
        const meta = await resolveMeta('/', deps);
        expect(meta.jsonLd.some((o) => o['@type'] === 'WebSite')).toBe(true);
        expect(deps.getDatasetByIdOrName).not.toHaveBeenCalled();
    });
});

describe('resolvePage crawl responses', () => {
    test.each(['faq', 'about'])('resolves %s without any catalogue dependency', async type => {
        const unavailable = new Proxy({}, { get() { throw new Error('Catalogue must not be accessed'); } });
        const page = await resolvePage('/' + type + '?from=footer', unavailable);
        expect(page.status).toBe(200);
        expect(page.canonicalPath).toBe('/' + type);
        expect(page.meta.canonical).toBe('https://canquery.com/' + type);
        expect(page.body).toContain('href="mailto:support@canquery.com"');
    });

    it('renders homepage metadata, explanation and guides without accessing catalogue data', async () => {
        const unavailable = new Proxy({}, { get() { throw new Error('Catalogue must not be accessed'); } });
        const page = await resolvePage('/?q=climate&place=toronto-on', unavailable);
        expect(page.status).toBe(200);
        expect(page.canonicalPath).toBe('/');
        expect(page.meta.canonical).toBe('https://canquery.com/');
        expect(page.meta.title).toBe('Canadian open data & government datasets - CanQuery');
        expect(page.meta.description).toBe('Search Canadian government datasets by place and topic. Find CSV downloads, explore supported tables and maps, and use CanQuery’s free API.');
        expect(page.body).toContain('<h1>Search Canadian open data</h1>');
        expect(page.body).toContain('<h2>How CanQuery works</h2>');
        expect(page.body.match(/href="\/blog\//g)).toHaveLength(3);
    });

    it('returns a canonical dataset path and meaningful initial HTML', async () => {
        const deps = {
            getDatasetByIdOrName: jest.fn().mockResolvedValue({
                id: 'd1', name: 'roads', title_en: 'Road network', notes_en: 'Public road geometry.',
                org_name: 'city-works', org_title_en: 'City Works', places: []
            }),
            listResourcesForDataset: jest.fn().mockResolvedValue([{
                id: 'r1', name_en: 'Road lines', format: 'GEOJSON', url: 'https://example.test/roads.geojson',
                map_provider: 'arcgis'
            }])
        };
        const page = await resolvePage('/datasets/d1', deps);
        expect(page.status).toBe(200);
        expect(page.canonicalPath).toBe('/datasets/roads');
        expect(page.body).toContain('<h1>Road network</h1>');
        expect(page.body).toContain('<p data-cq-lead="true">Road network is an open dataset from City Works with 1 file (GEOJSON). ' +
            'On CanQuery you can explore its interactive map and follow the original downloads.</p>');
        expect(page.body).toContain('/resources/r1');
        expect(page.body).toContain('/organizations/city-works');
    });

    it('opens every snapshot with one section nav that reaches both guide indexes', async () => {
        const unavailable = new Proxy({}, { get() { throw new Error('Catalogue must not be accessed'); } });
        const about = await resolvePage('/about', unavailable);
        expect(about.body.match(/<nav aria-label="CanQuery sections"/g)).toHaveLength(1);
        for (const path of ['/datasets', '/places', '/organizations', '/insights', '/blog', '/fr/blog', '/docs', '/about']) {
            expect(about.body).toContain('<li><a href="' + path + '">');
        }
        expect(about.body.indexOf('<nav aria-label="CanQuery sections"')).toBeLessThan(about.body.indexOf('<h1>'));
        const deps = {
            getDatasetByIdOrName: jest.fn().mockResolvedValue({ id: 'd1', name: 'roads', title_en: 'Roads' }),
            listResourcesForDataset: jest.fn().mockResolvedValue([])
        };
        const dataset = await resolvePage('/datasets/roads', deps);
        expect(dataset.body.match(/<nav aria-label="CanQuery sections"/g)).toHaveLength(1);
        const guide = await resolvePage('/fr/blog');
        expect(guide.body.match(/<nav aria-label="CanQuery sections"/g)).toHaveLength(1);
    });

    it('keeps download-only resource pages out of the index while tables and maps stay in', async () => {
        const base = { id: 'r1', name_en: 'Report', dataset_id: 'd1', dataset_name: 'limits', dataset_title_en: 'Limits',
            url: 'https://example.test/report.pdf', places: [] };
        const resolve = resource => resolvePage('/resources/r1', { getResourceById: jest.fn().mockResolvedValue(resource) });
        const pdf = await resolve({ ...base, format: 'PDF' });
        expect(pdf.status).toBe(200);
        expect(pdf.meta.noindex).toBe(true);
        expect(pdf.meta.canonical).toBe('https://canquery.com/resources/r1');
        expect(pdf.body).toContain('href="https://example.test/report.pdf"');
        expect((await resolve({ ...base, format: 'CSV' })).meta.noindex).toBeUndefined();
        expect((await resolve({ ...base, format: 'PDF', map_provider: 'arcgis' })).meta.noindex).toBeUndefined();
        expect((await resolve({ ...base, format: 'PDF', datastore_active: true })).meta.noindex).toBeUndefined();
    });

    it('lists the Top 100 datasets on /insights before JavaScript, and keeps the static copy when they cannot be read', async () => {
        const links = jest.fn().mockResolvedValue([
            { rank: 1, dataset_id: 'd1', dataset_name: 'roads', title_en: 'Roads', title_fr: 'Routes', downloads: 5042 },
            { rank: 2, dataset_id: 'd2', dataset_name: null, title_en: null, title_fr: 'Routes du Nord', downloads: 7 }
        ]);
        const page = await resolvePage('/insights', { listTopDownloadLinks: links });
        expect(page.status).toBe(200);
        expect(page.body).toContain('<h2>Top 100 downloaded datasets</h2>');
        expect(page.body).toContain('<a href="/datasets/roads">#1 · Roads</a> <span>5,042 downloads</span>');
        expect(page.body).toContain('<a href="/datasets/d2">#2 · Routes du Nord</a> <span>7 downloads</span>');
        expect(page.body).toContain('<h2>Related open data</h2><ul><li><a href="/">Search all datasets</a>');
        expect(page.meta.title).toContain('Top 100');

        catalogReadCache.clear();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const failed = await resolvePage('/insights', { listTopDownloadLinks: jest.fn().mockRejectedValue(new Error('db')) });
            expect(failed.status).toBe(200);
            expect(failed.body).toContain('<h2>Explore CanQuery</h2>');
            expect(failed.body).not.toContain('Top 100 downloaded datasets</h2>');
        } finally {
            warn.mockRestore();
        }
        const without = await resolvePage('/insights', {});
        expect(without.status).toBe(200);
        expect(without.body).toContain('<h1>Top downloaded Canadian datasets</h1>');
    });

    it('gives later resource pages their own snippet and a CollectionPage instead of a second Dataset', async () => {
        const resources = Array.from({ length: 60 }, (_, i) => ({
            id: 'r' + i, name_en: 'File ' + i, format: 'CSV', url: 'https://example.test/' + i + '.csv'
        }));
        const deps = {
            getDatasetByIdOrName: jest.fn().mockResolvedValue({ id: 'd1', name: 'roads', title_en: 'Road network', notes_en: 'Public roads.', org_title_en: 'City Works' }),
            listResourcesForDataset: jest.fn().mockResolvedValue(resources)
        };
        const first = await resolvePage('/datasets/roads', deps);
        expect(first.meta.title).toBe('Road network (City Works): 60 tables (CSV) - CanQuery');
        expect(first.meta.jsonLd.map(item => item['@type'])).toEqual(['Dataset', 'BreadcrumbList']);
        const second = await resolvePage('/datasets/roads?page=2', deps);
        expect(second.status).toBe(200);
        expect(second.meta.title).toBe('Road network (City Works): 60 tables (CSV) (page 2) - CanQuery');
        expect(second.meta.description.endsWith(' (page 2)')).toBe(true);
        expect(second.meta.canonical).toBe('https://canquery.com/datasets/roads?page=2');
        expect(second.meta.jsonLd.map(item => item['@type'])).toEqual(['CollectionPage', 'BreadcrumbList']);
        const collection = second.meta.jsonLd[0];
        expect(collection.url).toBe('https://canquery.com/datasets/roads?page=2');
        expect(collection.isPartOf).toBe('https://canquery.com/datasets/roads');
        expect(collection.mainEntity.numberOfItems).toBe(60);
        expect(collection.mainEntity.itemListElement).toHaveLength(10);
        expect(collection.mainEntity.itemListElement[0]).toMatchObject({ position: 51, url: 'https://canquery.com/resources/r50' });
        expect(second.body).toContain('<h1>Road network (page 2)</h1>');
        expect(second.body).toContain('href="/resources/r50"');
    });

    it('resolves organization pages with datasets and CollectionPage metadata', async () => {
        const deps = {
            getOrganizationByName: jest.fn().mockResolvedValue({
                id: 'o1', name: 'city-works', title_en: 'City Works',
                dataset_count: 4, queryable_dataset_count: 2, mappable_dataset_count: 1
            }),
            searchDatasets: jest.fn().mockResolvedValue([{ id: 'd1', name: 'roads', title_en: 'Roads' }])
        };
        const page = await resolvePage('/organizations/city-works', deps);
        expect(page.status).toBe(200);
        expect(page.canonicalPath).toBe('/organizations/city-works');
        expect(page.body).toContain('<h1>City Works open data</h1>');
        expect(page.meta.jsonLd.some(item => item['@type'] === 'CollectionPage')).toBe(true);
    });

    it('returns a real noindex 404 page model for unknown routes and entities', async () => {
        const route = await resolvePage('/not-a-route', {});
        expect(route.status).toBe(404);
        expect(route.meta.noindex).toBe(true);
        expect(route.body).toContain('<h1>Page not found</h1>');

        const dataset = await resolvePage('/datasets/missing', {
            getDatasetByIdOrName: jest.fn().mockResolvedValue(null)
        });
        expect(dataset.status).toBe(404);
        expect(dataset.body).toContain('<h1>Dataset not found</h1>');
    });
});

describe('production SPA response semantics', () => {
    let distDir;
    let spa;

    beforeAll(() => {
        distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-seo-'));
        fs.writeFileSync(path.join(distDir, 'index.html'),
            '<!doctype html><html><head><!-- seo:start --><title>x</title><!-- seo:end -->' +
            '<!-- analytics:config --></head><body><div id="root"></div></body></html>');
        spa = express();
        spa.get(/.*/, serveSpa(distDir));
    });

    afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));

    test.each([
        ['faq', 'Frequently asked questions'],
        ['about', 'About CanQuery']
    ])('serves complete indexable %s HTML during a catalogue outage', async (type, heading) => {
        for (const method of Object.values(catalogRead)) method.mockRejectedValue(new Error('Catalogue unavailable'));
        const res = await request(spa).get('/' + type);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
        expect(res.text.match(/<h1>/g)).toHaveLength(1);
        expect(res.text).toContain('<h1>' + heading + '</h1>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/' + type + '"');
        expect(res.text).toContain('href="mailto:support@canquery.com"');
        expect(res.text).not.toContain('name="robots" content="noindex');
        for (const method of Object.values(catalogRead)) expect(method).not.toHaveBeenCalled();
    });

    test.each(['faq', 'about'])('redirects the %s trailing slash and preserves query parameters', async type => {
        const res = await request(spa).get('/' + type + '/?from=footer');
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/' + type + '?from=footer');
    });

    it('serves the homepage introduction and guide anchors in initial HTML during a catalogue outage', async () => {
        for (const method of Object.values(catalogRead)) method.mockRejectedValue(new Error('Catalogue unavailable'));
        const res = await request(spa).get('/');
        expect(res.status).toBe(200);
        expect(res.text.match(/<h1>/g)).toHaveLength(1);
        expect(res.text).toContain('<title>Canadian open data &amp; government datasets - CanQuery</title>');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/"');
        expect(res.text).toContain('Search Canadian government datasets by place and topic.');
        expect(res.text).toContain('<h2>How CanQuery works</h2>');
        expect(res.text.match(/href="\/blog\//g)).toHaveLength(3);
        for (const method of Object.values(catalogRead)) expect(method).not.toHaveBeenCalled();
    });

    it('301s aliases and trailing slashes while preserving the query string', async () => {
        catalogRead.getDatasetByIdOrName.mockResolvedValue({
            id: 'd1', name: 'roads', title_en: 'Roads', notes_en: 'Road data for public use.'
        });
        catalogRead.listResourcesForDataset.mockResolvedValue([]);
        const alias = await request(spa).get('/datasets/d1?highlight=r1');
        expect(alias.status).toBe(301);
        expect(alias.headers.location).toBe('/datasets/roads?highlight=r1');

        const slash = await request(spa).get('/docs/');
        expect(slash.status).toBe(301);
        expect(slash.headers.location).toBe('/docs');
    });

    it('serves semantic initial HTML with the canonical 200 response', async () => {
        catalogRead.getDatasetByIdOrName.mockResolvedValue({
            id: 'd1', name: 'roads', title_en: 'Roads', notes_en: 'Road data for public use.',
            org_title_en: 'City Works',
            provenance_sources: [{ authoritative: true, license_url: 'https://example.test/roads-license' }]
        });
        catalogRead.listResourcesForDataset.mockResolvedValue([]);
        const res = await request(spa).get('/datasets/roads');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<h1>Roads</h1>');
        expect(res.text).toContain('data-cq-seo-snapshot="true"');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/datasets/roads"');
        const schema = [...res.text.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
            .map(match => JSON.parse(match[1]));
        const dataset = schema.find(item => item['@type'] === 'Dataset');
        expect(dataset.description.length).toBeGreaterThanOrEqual(50);
        expect(dataset.description.length).toBeLessThanOrEqual(5000);
        expect(dataset.creator).toEqual({ '@type': 'Organization', name: 'City Works' });
        expect(dataset.license).toBe('https://example.test/roads-license');
    });

    test.each(['/resources/r1', '/resources/r1?view=map'])('keeps %s indexable with a parent URL instead of an incomplete Dataset', async route => {
        catalogRead.getResourceById.mockResolvedValue({
            id: 'r1', name_fr: 'Limites', format: 'GEOJSON', url: 'https://example.test/limits.geojson',
            dataset_id: 'd1', dataset_name: 'limits', dataset_title_fr: 'Limites municipales',
            map_provider: 'canquery', places: []
        });
        const res = await request(spa).get(route);
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('name="robots" content="noindex');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/resources/r1"');
        const schema = [...res.text.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
            .map(match => JSON.parse(match[1]));
        const page = schema.find(item => item['@type'] === 'WebPage');
        expect(page.mainEntity['@type']).toBe('DataDownload');
        expect(page.mainEntity.isPartOf).toBe('https://canquery.com/datasets/limits');
        expect(page.mainEntity.contentUrl).toBe('https://example.test/limits.geojson');
        expect(JSON.stringify(schema)).not.toContain('"@type":"Dataset"');
        expect(schema.some(item => item['@type'] === 'BreadcrumbList')).toBe(true);
        expect(catalogRead.getDatasetByIdOrName).not.toHaveBeenCalled();
        expect(catalogRead.listResourcesForDataset).not.toHaveBeenCalled();
    });

    it('returns noindex 404s and retryable 503s instead of soft 200 pages', async () => {
        const missing = await request(spa).get('/not-a-route');
        expect(missing.status).toBe(404);
        expect(missing.text).toContain('name="robots" content="noindex');

        catalogRead.getDatasetByIdOrName.mockRejectedValue(new Error('db unavailable'));
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        const unavailable = await request(spa).get('/datasets/roads');
        log.mockRestore();
        expect(unavailable.status).toBe(503);
        expect(unavailable.headers['retry-after']).toBe('60');
        expect(unavailable.headers['cache-control']).toBe('no-store');
        expect(unavailable.text).toContain('<h1>Temporarily unavailable</h1>');
    });

    test.each([
        ['/organizations', 'listOrganizations'],
        ['/places', 'listPlaces'],
        ['/organizations/city-works', 'searchDatasets'],
        ['/places/example-on', 'searchDatasets']
    ])('returns a retryable 503 when required catalogue data fails for %s', async (route, method) => {
        catalogRead.getOrganizationByName.mockResolvedValue({ name: 'city-works', title_en: 'City Works' });
        catalogRead.getPlaceByIdOrSlug.mockResolvedValue({ id: 'p1', slug: 'example-on', name_en: 'Example' });
        catalogRead[method].mockRejectedValue(new Error('private database detail'));
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const res = await request(spa).get(route);
            expect(res.status).toBe(503);
            expect(res.headers['retry-after']).toBe('60');
            expect(res.text).toContain('name="robots" content="noindex');
            expect(res.text).not.toContain('private database detail');
        } finally {
            log.mockRestore();
        }
    });

    test.each(['/organizations', '/places'])('keeps an empty but available directory valid: %s', async route => {
        const res = await request(spa).get(route);
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('name="robots" content="noindex');
    });
});

describe('resource page initial data', () => {
    let distDir;
    let spa;
    const ready = {
        id: 'r1', name_en: 'Permits', format: 'CSV', url: 'https://example.test/permits.csv',
        dataset_id: 'd1', dataset_name: 'permits', dataset_title_en: 'Building permits',
        ingest_status: 'ready', table_name: 'r_abc', ingested_at: '2026-09-01T00:00:00Z',
        ingested_columns: [{ id: 'name', type: 'TEXT' }], ingested_row_count: 120,
        last_accessed_at: '2026-10-01T00:00:00Z', places: [], provenance_sources: []
    };
    const readInitial = text => {
        const match = text.match(/<script type="application\/json" id="cq-initial">(.*?)<\/script>/s);
        return match ? JSON.parse(match[1]) : null;
    };
    const navigate = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' };

    beforeAll(() => {
        distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canquery-initial-'));
        fs.writeFileSync(path.join(distDir, 'index.html'),
            '<!doctype html><html><head><!-- seo:start --><title>x</title><!-- seo:end --></head><body><div id="root"></div></body></html>');
        spa = express();
        spa.get(/.*/, serveSpa(distDir));
    });
    afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));
    beforeEach(() => {
        catalogRead.getResourceById.mockResolvedValue(ready);
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: 1, name: 'Ottawa' }], total: 120 });
        store.touchLastAccessed.mockResolvedValue(true);
        queryLog.logQueryHit.mockResolvedValue(undefined);
    });

    it('embeds the metadata and the first page for a browser navigation and records its popularity', async () => {
        const res = await request(spa).get('/resources/r1').set(navigate);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
        expect(res.text).toContain('data-cq-seo-snapshot="true"');
        expect(res.text).toContain('<link rel="canonical" href="https://canquery.com/resources/r1"');
        const payload = readInitial(res.text);
        expect(payload).toMatchObject({ version: 1, path: '/resources/r1', page: 0 });
        expect(payload.resource.data.id).toBe('r1');
        expect(payload.resource.data.query_mode).toBe('ingested');
        expect(payload.resource.data.ingestion.row_count).toBe(120);
        expect(payload.resource.meta.source).toBe('canquery');
        expect(payload.rows.data.fields[0]).toEqual({ id: '_id', type: 'int' });
        expect(payload.rows.data.records).toEqual([{ _id: 1, name: 'Ottawa' }]);
        expect(payload.rows.data.total).toBe(120);
        expect(payload.rows.meta.query_mode).toBe('ingested');
        expect(payload.rows.meta.snapshot.id).toBe(payload.resource.data.ingestion.snapshot_id);
        expect(payload.rows.meta.retrieved_at).toBeTruthy();
        expect(payload.rows.meta.limits.max_page_rows).toBe(100);
        expect(store.queryStoreTable).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'r_abc', limit: 50, offset: 0 }));
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
        expect(queryLog.logQueryHit).toHaveBeenCalledWith('r1', 'ingested');
        expect(catalogRead.getResourceById).toHaveBeenCalledTimes(2);
    });

    it('embeds the data for a plain document request without recording popularity', async () => {
        const res = await request(spa).get('/resources/r1');
        expect(readInitial(res.text).rows.data.total).toBe(120);
        expect(queryLog.logQueryHit).not.toHaveBeenCalled();
        expect(store.touchLastAccessed).not.toHaveBeenCalled();
    });

    it('skips the data block for in-app HTML fetches and HEAD requests', async () => {
        const fetched = await request(spa).get('/resources/r1').set({ 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors' });
        expect(fetched.status).toBe(200);
        expect(fetched.text).not.toContain('cq-initial');
        const head = await request(spa).head('/resources/r1');
        expect(head.status).toBe(200);
        expect(store.queryStoreTable).not.toHaveBeenCalled();
        expect(catalogRead.getResourceById).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['?page=2', 100, 2],
        ['?page=999', 10000, 200]
    ])('answers the requested page %s within the offset ceiling', async (search, offset, page) => {
        const res = await request(spa).get('/resources/r1' + search).set(navigate);
        const payload = readInitial(res.text);
        expect(payload.path).toBe('/resources/r1' + search);
        expect(payload.page).toBe(page);
        expect(store.queryStoreTable).toHaveBeenCalledWith(expect.objectContaining({ offset, limit: 50 }));
    });

    it.each(['?view=chart', '?q=ottawa', '?cf=%7B%22name%22%3A%22a%22%7D', '?sort=name%20desc', '?view=map'])(
        'embeds only the metadata for %s', async search => {
            const res = await request(spa).get('/resources/r1' + search).set(navigate);
            const payload = readInitial(res.text);
            expect(payload.resource.data.id).toBe('r1');
            expect(payload.rows).toBeNull();
            expect(payload.page).toBeNull();
            expect(store.queryStoreTable).not.toHaveBeenCalled();
            expect(queryLog.logQueryHit).not.toHaveBeenCalled();
        });

    it.each([
        ['datastore', { ingest_status: null, table_name: null, datastore_active: true }],
        ['file-only', { ingest_status: null, table_name: null, format: 'PDF', url: 'https://example.test/guide.pdf' }]
    ])('embeds only the metadata for a %s resource', async (mode, overrides) => {
        catalogRead.getResourceById.mockResolvedValue({ ...ready, ...overrides });
        const res = await request(spa).get('/resources/r1').set(navigate);
        const payload = readInitial(res.text);
        expect(payload.resource.data.query_mode).toBe(mode);
        expect(payload.rows).toBeNull();
        expect(store.queryStoreTable).not.toHaveBeenCalled();
    });

    it('escapes cell values so the data block can never close its script element', async () => {
        store.queryStoreTable.mockResolvedValue({ records: [{ _id: 1, name: '</script><!-- <b>&amp;' }], total: 1 });
        const res = await request(spa).get('/resources/r1').set(navigate);
        const block = res.text.slice(res.text.indexOf('id="cq-initial">'));
        expect(block.indexOf('</script>')).toBe(block.indexOf('</script>\n</body>'));
        expect(block).toContain('\\u003c/script\\u003e\\u003c!--');
        expect(readInitial(res.text).rows.data.records[0].name).toBe('</script><!-- <b>&amp;');
    });

    it('serves the page with metadata only when the first page read fails or is oversized', async () => {
        store.queryStoreTable.mockRejectedValue(new Error('store unavailable'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const failed = await request(spa).get('/resources/r1').set(navigate);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('store unavailable');
        warn.mockRestore();
        expect(failed.status).toBe(200);
        expect(readInitial(failed.text).resource.data.id).toBe('r1');
        expect(readInitial(failed.text).rows).toBeNull();

        store.queryStoreTable.mockResolvedValue({ records: Array.from({ length: 50 }, (_, i) => ({ _id: i, name: 'x'.repeat(10 * 1024) })), total: 50 });
        const wide = await request(spa).get('/resources/r1').set(navigate);
        expect(readInitial(wide.text).rows).toBeNull();
        expect(readInitial(wide.text).resource.data.ingestion.row_count).toBe(120);
    });

    it('adds no data block to other pages', async () => {
        const res = await request(spa).get('/about').set(navigate);
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('cq-initial');
        expect(catalogRead.getResourceById).not.toHaveBeenCalled();
    });
});
