jest.mock('../db/pool', () => ({ query: jest.fn() }));
jest.mock('../db/snapshotRead', () => ({ snapshotDb: () => require('../db/pool') }));

const pool = require('../db/pool');
const queries = require('../db/catalogReadQueries');

beforeEach(() => jest.clearAllMocks());

describe('detail queries used by page metadata', () => {
    it('reads the declared jurisdiction with a dataset so federal fallbacks apply only to federal records', async () => {
        pool.query.mockResolvedValue({ rows: [{ id: 'd1', jurisdiction: 'federal' }] });
        await expect(queries.getDatasetByIdOrName('d1')).resolves.toEqual({ id: 'd1', jurisdiction: 'federal' });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('d.metadata_modified, d.jurisdiction,');
        expect(sql).toContain('WHERE d.id = $1 OR d.name = $1');
        expect(params).toEqual(['d1']);
    });

    it('flags publishers that mirror federal-portal records as governments', async () => {
        pool.query.mockResolvedValue({ rows: [{ name: 'statcan', government: true }] });
        await expect(queries.getOrganizationByName('statcan')).resolves.toEqual({ name: 'statcan', government: true });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toMatch(/EXISTS \(SELECT 1 FROM datasets d\s+WHERE d\.org_id = o\.id AND d\.jurisdiction IS NOT NULL\) AS government/);
        expect(params).toEqual(['statcan']);
    });
});
