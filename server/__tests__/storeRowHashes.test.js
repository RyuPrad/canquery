jest.mock('../db/pool', () => ({ query: jest.fn() }));
const pool = require('../db/pool');
const { matchingRowHashes, readStoreRowsByIds } = require('../db/storeQueries');

beforeEach(() => jest.clearAllMocks());

describe('matchingRowHashes', () => {
    it('hashes each matching row without its _id, in _id order, with the table query\'s own WHERE', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ _id: '4', hash: 'a'.repeat(32) }, { _id: '9', hash: 'b'.repeat(32) }] });
        const rows = await matchingRowHashes({
            tableName: 'r_abc',
            knownColumns: ['street', 'status'],
            q: 'king',
            filters: [{ column: 'status', op: 'eq', value: 'Issued' }],
            limit: 2001
        });
        expect(rows).toEqual([{ id: '4', hash: 'a'.repeat(32) }, { id: '9', hash: 'b'.repeat(32) }]);
        expect(pool.query).toHaveBeenCalledTimes(1);
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toBe('SELECT "_id", md5(to_jsonb(ARRAY["street"::text, "status"::text]::text[])::text) AS "hash" FROM store."r_abc"' +
            ' WHERE "status" = $1 AND ("street"::text ILIKE $2 OR "status"::text ILIKE $2) ORDER BY "_id" ASC LIMIT $3');
        expect(params).toEqual(['Issued', '%king%', 2001]);
    });

    it('reads the whole table when nothing is searched', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect(await matchingRowHashes({ tableName: 'r_abc', knownColumns: ['street'], q: '', filters: [], limit: 5 })).toEqual([]);
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toBe('SELECT "_id", md5(to_jsonb(ARRAY["street"::text]::text[])::text) AS "hash" FROM store."r_abc" ORDER BY "_id" ASC LIMIT $1');
        expect(params).toEqual([5]);
    });

    it('refuses a table name that is not a store table, and an unknown filter column', async () => {
        await expect(matchingRowHashes({ tableName: 'users; --', knownColumns: [], filters: [], limit: 1 })).rejects.toThrow('invalid store table name');
        await expect(matchingRowHashes({ tableName: 'r_abc', knownColumns: ['street'], filters: [{ column: 'nope', op: 'eq', value: '1' }], limit: 1 }))
            .rejects.toThrow('unknown column: nope');
        expect(pool.query).not.toHaveBeenCalled();
    });
});

describe('readStoreRowsByIds', () => {
    it('reads the named rows in _id order', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ _id: '4', street: 'KING ST' }] });
        expect(await readStoreRowsByIds({ tableName: 'r_abc', ids: ['4', '9'] })).toEqual({ records: [{ _id: '4', street: 'KING ST' }] });
        expect(pool.query.mock.calls[0]).toEqual(['SELECT * FROM store."r_abc" WHERE "_id" = ANY($1::bigint[]) ORDER BY "_id" ASC', [['4', '9']]]);
    });

    it('asks nothing for no ids, and refuses a table name that is not a store table', async () => {
        expect(await readStoreRowsByIds({ tableName: 'r_abc', ids: [] })).toEqual({ records: [] });
        await expect(readStoreRowsByIds({ tableName: 'nope', ids: ['1'] })).rejects.toThrow('invalid store table name');
        expect(pool.query).not.toHaveBeenCalled();
    });
});
