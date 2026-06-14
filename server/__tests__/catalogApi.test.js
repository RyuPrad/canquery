jest.mock('../db/queryLogQueries', () => ({ logQueryHit: jest.fn(() => Promise.resolve()), listPopularResources: jest.fn(), countOlderThan: jest.fn(), pruneOlderThan: jest.fn() }));
jest.mock('../db/catalogReadQueries', () => ({
    searchDatasets: jest.fn(),
    getDatasetByIdOrName: jest.fn(),
    listResourcesForDataset: jest.fn(),
    getResourceById: jest.fn(),
    listOrganizations: jest.fn(),
    getStats: jest.fn(),
    pingDb: jest.fn(),
    getLastSyncTime: jest.fn(),
    listRecentlyIngested: jest.fn()
}));

jest.mock('../services/ckanClient', () => ({
    packageList: jest.fn(),
    packageSearch: jest.fn(),
    packageShow: jest.fn(),
    organizationList: jest.fn(),
    datastoreSearch: jest.fn()
}));

const request = require('supertest');
const queries = require('../db/catalogReadQueries');
const ckan = require('../services/ckanClient');
const app = require('../app');

function makeSearchRow(i) {
    return {
        id: 'id-' + i,
        name: 'name-' + i,
        title_en: 'Title ' + i,
        title_fr: 'Titre ' + i,
        metadata_modified: '2026-01-01T00:00:00Z',
        org_name: 'org',
        org_title_en: 'Org EN',
        org_title_fr: 'Org FR',
        resource_count: 3,
        queryable_count: 1
    };
}

describe('Catalog API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('GET /api/v1/datasets returns the stable envelope and shaped items', async () => {
        queries.searchDatasets.mockResolvedValue([makeSearchRow(1), makeSearchRow(2)]);
        const res = await request(app).get('/api/v1/datasets?q=water');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('pagination');
        expect(res.body.pagination).toHaveProperty('nextCursor', null);
        expect(res.body.meta.source).toBe('canquery');
        expect(res.body.meta.upstream).toBe('open.canada.ca');
        expect(typeof res.body.meta.license).toBe('string');
        expect(res.body.data[0].title.en).toBe('Title 1');
        expect(res.body.data[0].organization.name).toBe('org');
        expect(res.body.data[0].queryable_count).toBe(1);
    });

    it('search params pass through and limit is clamped to 100', async () => {
        queries.searchDatasets.mockResolvedValue([]);
        await request(app).get('/api/v1/datasets?q=water&org=statcan&format=csv&keyword=health&limit=500');
        expect(queries.searchDatasets).toHaveBeenCalledWith({
            q: 'water',
            org: 'statcan',
            format: 'csv',
            keyword: 'health',
            limit: 101,
            offset: 0
        });
    });

    it('returns nextCursor when there are more rows', async () => {
        queries.searchDatasets.mockResolvedValue([makeSearchRow(1), makeSearchRow(2), makeSearchRow(3)]);
        const res = await request(app).get('/api/v1/datasets?limit=2');
        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination.nextCursor).toBe('2');
    });

    it('invalid cursor is a 400', async () => {
        const res = await request(app).get('/api/v1/datasets?cursor=abc');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid cursor');
    });

    it('GET /api/v1/datasets/:idOrName 404s on unknown dataset', async () => {
        queries.getDatasetByIdOrName.mockResolvedValue(null);
        const res = await request(app).get('/api/v1/datasets/nope');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Dataset not found');
    });

    it('GET /api/v1/datasets/:idOrName tags resource query modes', async () => {
        queries.getDatasetByIdOrName.mockResolvedValue({
            id: 'd1',
            name: 'd1',
            title_en: 'T',
            title_fr: null,
            notes_en: null,
            notes_fr: null,
            keywords_en: [],
            keywords_fr: [],
            metadata_modified: null,
            org_name: null
        });
        queries.listResourcesForDataset.mockResolvedValue([
            { id: 'r1', dataset_id: 'd1', name_en: 'a', name_fr: null, format: 'CSV', url: 'u', size_bytes: null, datastore_active: true, language: null, last_modified: null, ingest_status: null },
            { id: 'r2', dataset_id: 'd1', name_en: 'b', name_fr: null, format: 'CSV', url: 'u', size_bytes: '1000', datastore_active: false, language: null, last_modified: null, ingest_status: 'ready', ingested_row_count: '5', ingested_at: '2026-01-01' },
            { id: 'r3', dataset_id: 'd1', name_en: 'c', name_fr: null, format: 'CSV', url: 'u', size_bytes: '999999999999', datastore_active: false, language: null, last_modified: null, ingest_status: null },
            { id: 'r4', dataset_id: 'd1', name_en: 'd', name_fr: null, format: 'PDF', url: 'u', size_bytes: null, datastore_active: false, language: null, last_modified: null, ingest_status: null },
            { id: 'r5', dataset_id: 'd1', name_en: 'e', name_fr: null, format: 'XLSX', url: 'u', size_bytes: '1048576', datastore_active: false, language: null, last_modified: null, ingest_status: null },
            { id: 'r6', dataset_id: 'd1', name_en: 'f', name_fr: null, format: 'XLSX', url: 'u', size_bytes: String(25 * 1024 * 1024), datastore_active: false, language: null, last_modified: null, ingest_status: null },
            { id: 'r7', dataset_id: 'd1', name_en: 'g', name_fr: null, format: 'XLS', url: 'u', size_bytes: null, datastore_active: false, language: null, last_modified: null, ingest_status: null }
        ]);
        const res = await request(app).get('/api/v1/datasets/d1');
        expect(res.status).toBe(200);
        const modes = res.body.data.resources.map(r => r.query_mode);
        expect(modes).toEqual(['datastore', 'ingested', 'file-only', 'file-only', 'ingestable', 'file-only', 'ingestable']);
    });

    it('GET /api/v1/stats wraps totals in the envelope', async () => {
        queries.getStats.mockResolvedValue({
            datasets: 10,
            resources: 20,
            datastore_active_resources: 3,
            ingested_resources: 2,
            store_bytes: '1234',
            organizations: 4
        });
        const res = await request(app).get('/api/v1/stats');
        expect(res.status).toBe(200);
        expect(res.body.data.store_bytes).toBe(1234);
        expect(res.body.meta.source).toBe('canquery');
    });

    it('healthz reports ok when db and upstream are reachable', async () => {
        queries.pingDb.mockResolvedValue(true);
        ckan.packageList.mockResolvedValue(['x']);
        const res = await request(app).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, db: true, upstream: true });
    });

    it('disallowed origin gets a 403', async () => {
        const res = await request(app).get('/api/v1/stats').set('Origin', 'https://evil.example.com');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Origin not allowed');
    });
});
