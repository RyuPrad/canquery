jest.mock('../db/topDownloadsQueries', () => ({
    listTopDownloads: jest.fn(),
    replaceTopDownloads: jest.fn(),
    pinResource: jest.fn(),
    prunePins: jest.fn()
}));
const request = require('supertest');
const topq = require('../db/topDownloadsQueries');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/v1/insights/top-downloads', () => {
    it('returns ranked items, the period in meta, and live ingest status', async () => {
        topq.listTopDownloads.mockResolvedValue([
            { rank: 1, dataset_id: 'd1', title_en: 'TFW', title_fr: 'PTET', department: 'ESDC', ministere: 'EDSC',
              downloads: 5042, period_year: 2026, period_month: 5,
              history: [{ y: 2026, m: 4, d: 4000 }, { y: 2026, m: 5, d: 5042 }],
              resource_id: 'r1', ingest_status: 'ready', ingested_row_count: '1200' },
            { rank: 2, dataset_id: 'd2', title_en: 'OAS', title_fr: 'SV', department: 'ESDC', ministere: 'EDSC',
              downloads: 3003, period_year: 2026, period_month: 5, history: [],
              resource_id: null, ingest_status: null, ingested_row_count: null }
        ]);
        const res = await request(app).get('/api/v1/insights/top-downloads');
        expect(res.status).toBe(200);
        expect(res.body.meta.period).toEqual({ year: 2026, month: 5 });
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toMatchObject({
            rank: 1, dataset_id: 'd1', downloads: 5042, resource_id: 'r1', ingest_status: 'ready', row_count: 1200
        });
        expect(res.body.data[0].title).toEqual({ en: 'TFW', fr: 'PTET' });
        expect(res.body.data[0].history).toHaveLength(2);
        // A dataset with no chartable resource is a download-only card.
        expect(res.body.data[1]).toMatchObject({ rank: 2, resource_id: null, ingest_status: null, row_count: null });
    });

    it('returns an empty list with a null period when nothing is seeded', async () => {
        topq.listTopDownloads.mockResolvedValue([]);
        const res = await request(app).get('/api/v1/insights/top-downloads');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta.period).toBeNull();
    });
});
