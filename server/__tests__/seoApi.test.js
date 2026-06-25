jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(),
    getDatasetByIdOrName: jest.fn(),
    listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(),
    listOrganizations: jest.fn(),
    getStats: jest.fn(),
    countDatasets: jest.fn(),
    listDatasetSitemap: jest.fn(),
    pingDb: jest.fn(),
    getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn(),
    getJobHealth: jest.fn(),
}));
jest.mock('../services/ckanClient', () => ({ packageList: jest.fn(), packageSearch: jest.fn(), packageShow: jest.fn(), organizationList: jest.fn(), datastoreSearch: jest.fn() }));
jest.mock('../db/storeQueries', () => ({ queryStoreTable: jest.fn(), aggregateStoreTable: jest.fn(), touchLastAccessed: jest.fn(() => Promise.resolve()), TABLE_NAME_RE: /^r_[0-9a-f_]+$/ }));
jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));

const request = require('supertest');
const catalogRead = require('../db/catalogReadQueries');
const app = require('../app');
const { resolveMeta } = require('../controllers/spaController');

beforeEach(() => { jest.clearAllMocks(); });

describe('robots.txt', () => {
    it('allows all and points at the sitemap index', async () => {
        const res = await request(app).get('/robots.txt');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toContain('User-agent: *');
        expect(res.text).toContain('Sitemap: https://canquery.com/sitemap.xml');
    });
});

describe('sitemap index', () => {
    it('lists the pages sitemap plus one chunk per 25k datasets', async () => {
        catalogRead.countDatasets.mockResolvedValue(30000);
        const res = await request(app).get('/sitemap.xml');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/xml/);
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-pages.xml</loc>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-datasets-1.xml</loc>');
        expect(res.text).toContain('<loc>https://canquery.com/sitemap-datasets-2.xml</loc>');
        expect(res.text).not.toContain('sitemap-datasets-3.xml');
    });

    it('always emits at least one dataset chunk', async () => {
        catalogRead.countDatasets.mockResolvedValue(0);
        const res = await request(app).get('/sitemap.xml');
        expect(res.text).toContain('sitemap-datasets-1.xml');
    });
});

describe('pages sitemap', () => {
    it('includes the home and section hubs', async () => {
        const res = await request(app).get('/sitemap-pages.xml');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<loc>https://canquery.com/</loc>');
        expect(res.text).toContain('<loc>https://canquery.com/insights</loc>');
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

describe('resolveMeta routing', () => {
    it('resolves a dataset via the DB and includes Dataset JSON-LD', async () => {
        const deps = {
            getDatasetByIdOrName: jest.fn().mockResolvedValue({ id: 'd1', name: 'n1', title_en: 'T', notes_en: 'N' }),
            listResourcesForDataset: jest.fn().mockResolvedValue([]),
            getResourceById: jest.fn(),
        };
        const meta = await resolveMeta('/datasets/n1', deps);
        expect(deps.getDatasetByIdOrName).toHaveBeenCalledWith('n1');
        expect(meta.title).toBe('T - canquery');
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
            getResourceById: jest.fn().mockResolvedValue({ id: 'r1', name_en: 'File', format: 'CSV', dataset_title_en: 'DS' }),
            getDatasetByIdOrName: jest.fn(),
            listResourcesForDataset: jest.fn(),
        };
        const meta = await resolveMeta('/resources/r1', deps);
        expect(meta.title).toContain('File');
        expect(meta.canonical).toBe('https://canquery.com/resources/r1');
    });

    it('uses static home meta without touching the DB', async () => {
        const deps = { getDatasetByIdOrName: jest.fn(), listResourcesForDataset: jest.fn(), getResourceById: jest.fn() };
        const meta = await resolveMeta('/', deps);
        expect(meta.jsonLd.some((o) => o['@type'] === 'WebSite')).toBe(true);
        expect(deps.getDatasetByIdOrName).not.toHaveBeenCalled();
    });
});
