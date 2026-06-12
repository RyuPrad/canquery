jest.mock('../db/pool', () => ({ query: jest.fn() }));
const pool = require('../db/pool');
const { aggregateStoreTable } = require('../db/storeQueries');

describe('aggregateStoreTable', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValueOnce({ rows: [{ total: 3 }] }).mockResolvedValueOnce({ rows: [{ key: 'a', value: '2' }] });
    });

    it('builds GROUP BY 1 with key/value aliases', async () => {
        await aggregateStoreTable({
            tableName: 'r_abc',
            knownColumns: ['province', 'amount'],
            q: undefined,
            filters: [],
            groupBy: 'province',
            agg: 'count',
            aggColumn: null,
            bucket: null,
            sortSql: null,
            limit: 100,
            offset: 0
        });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const secondCall = pool.query.mock.calls[1];
        expect(secondCall[0]).toContain('AS "key"');
        expect(secondCall[0]).toContain('AS "value"');
        expect(secondCall[0]).toContain('GROUP BY 1');
        expect(secondCall[0]).toContain('ORDER BY "key" ASC');
        expect(secondCall[0]).toContain('count(*)');
        expect(secondCall[1]).toEqual([100, 0]);
    });

    it('count query wraps a GROUP BY subquery and reuses where params', async () => {
        await aggregateStoreTable({
            tableName: 'r_abc',
            knownColumns: ['province', 'amount'],
            q: 'x',
            filters: [{ column: 'province', op: 'eq', value: 'ON' }],
            groupBy: 'province',
            agg: 'count',
            aggColumn: null,
            bucket: null,
            sortSql: null,
            limit: 100,
            offset: 0
        });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const firstCall = pool.query.mock.calls[0];
        expect(firstCall[0]).toContain('count(*)::int');
        expect(firstCall[0]).toContain('GROUP BY "province"');
        expect(firstCall[1]).toEqual(['ON', '%x%']);
        const secondCall = pool.query.mock.calls[1];
        expect(secondCall[1]).toEqual(['ON', '%x%', 100, 0]);
    });

    it('value sort gets a key tiebreaker', async () => {
        await aggregateStoreTable({
            tableName: 'r_abc',
            knownColumns: ['province', 'amount'],
            q: undefined,
            filters: [],
            groupBy: 'province',
            agg: 'sum',
            aggColumn: 'amount',
            bucket: null,
            sortSql: '"value" DESC',
            limit: 100,
            offset: 0
        });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const secondCall = pool.query.mock.calls[1];
        expect(secondCall[0]).toContain('ORDER BY "value" DESC, "key" ASC');
    });

    it('bucket wraps the key in date_trunc', async () => {
        await aggregateStoreTable({
            tableName: 'r_abc',
            knownColumns: ['day', 'amount'],
            q: undefined,
            filters: [],
            groupBy: 'day',
            agg: 'count',
            aggColumn: null,
            bucket: 'month',
            sortSql: null,
            limit: 100,
            offset: 0
        });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const secondCall = pool.query.mock.calls[1];
        expect(secondCall[0]).toContain("date_trunc('");
        expect(secondCall[0]).toContain("'month'");
        expect(secondCall[0]).toContain('"day"');
    });

    it('sum aggregates the agg column', async () => {
        await aggregateStoreTable({
            tableName: 'r_abc',
            knownColumns: ['province', 'amount'],
            q: undefined,
            filters: [],
            groupBy: 'province',
            agg: 'sum',
            aggColumn: 'amount',
            bucket: null,
            sortSql: null,
            limit: 100,
            offset: 0
        });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const secondCall = pool.query.mock.calls[1];
        expect(secondCall[0]).toContain('sum("amount")');
    });

    it('invalid table name throws 500-coded AppError', async () => {
        await expect(
            aggregateStoreTable({
                tableName: 'public.users; DROP',
                knownColumns: ['province'],
                q: undefined,
                filters: [],
                groupBy: 'province',
                agg: 'count',
                aggColumn: null,
                bucket: null,
                sortSql: null,
                limit: 100,
                offset: 0
            })
        ).rejects.toMatchObject({ statusCode: 500 });
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('unknown agg fn and bad bucket throw', async () => {
        await expect(
            aggregateStoreTable({
                tableName: 'r_abc',
                knownColumns: ['province', 'amount'],
                q: undefined,
                filters: [],
                groupBy: 'province',
                agg: 'median',
                aggColumn: null,
                bucket: null,
                sortSql: null,
                limit: 100,
                offset: 0
            })
        ).rejects.toMatchObject({ statusCode: 500 });
        expect(pool.query).not.toHaveBeenCalled();

        await expect(
            aggregateStoreTable({
                tableName: 'r_abc',
                knownColumns: ['province', 'amount'],
                q: undefined,
                filters: [],
                groupBy: 'province',
                agg: 'count',
                aggColumn: null,
                bucket: 'week',
                sortSql: null,
                limit: 100,
                offset: 0
            })
        ).rejects.toMatchObject({ statusCode: 500 });
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('group column with embedded quote is rejected by quoteIdent', async () => {
        await expect(
            aggregateStoreTable({
                tableName: 'r_abc',
                knownColumns: ['a"b'],
                q: undefined,
                filters: [],
                groupBy: 'a"b',
                agg: 'count',
                aggColumn: null,
                bucket: null,
                sortSql: null,
                limit: 100,
                offset: 0
            })
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(pool.query).not.toHaveBeenCalled();
    });
});
