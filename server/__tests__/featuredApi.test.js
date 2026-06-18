jest.mock('../db/topDownloadsQueries', () => ({
    listIngestedTop: jest.fn(),
    listTopDownloads: jest.fn(),
    replaceTopDownloads: jest.fn(),
    pinResource: jest.fn(),
    prunePins: jest.fn()
}));
jest.mock('../db/storeQueries', () => ({
    profileStoreTable: jest.fn(),
    aggregateStoreTable: jest.fn(),
    queryStoreTable: jest.fn(),
    touchLastAccessed: jest.fn(() => Promise.resolve()),
    TABLE_NAME_RE: /^r_[0-9a-f_]+$/
}));
const request = require('supertest');
const topq = require('../db/topDownloadsQueries');
const store = require('../db/storeQueries');
const app = require('../app');

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/v1/insights/featured', () => {
    it('returns a compact chart spec per ingested dataset', async () => {
        topq.listIngestedTop.mockResolvedValue([
            { dataset_id: 'd1', title_en: 'Grants', title_fr: 'Subventions', resource_id: 'r1', table_name: 'r_aaa',
              columns: [{ id: 'status', type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }], row_count: 100 }
        ]);
        store.profileStoreTable.mockResolvedValue({ rowCount: 100, columns: [
            { id: 'status', type: 'TEXT', distinct: 3, nulls: 0 },
            { id: 'amount', type: 'NUMERIC', distinct: 80, nulls: 0, avg: 5, min: 1, max: 9 }
        ] });
        store.aggregateStoreTable.mockResolvedValue({ records: [
            { key: 'Approved', value: '60' }, { key: 'Pending', value: '30' }, { key: 'Rejected', value: '10' }
        ], total: 3 });

        const res = await request(app).get('/api/v1/insights/featured');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({ dataset_id: 'd1', kind: 'donut' });
        expect(res.body.data[0].title).toEqual({ en: 'Grants', fr: 'Subventions' });
        expect(res.body.data[0].points).toHaveLength(3);
        expect(res.body.data[0].points[0]).toEqual({ label: 'Approved', value: 60 });
        expect(store.aggregateStoreTable).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'status', agg: 'count' }));
    });
});
