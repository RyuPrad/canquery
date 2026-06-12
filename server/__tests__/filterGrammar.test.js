const { parseFilters, buildWhere, validateSort, quoteIdent, validateAggregation } = require('../utils/filterGrammar');

function expect400(fn) {
    expect(fn).toThrow();
    try {
        fn();
        throw new Error('expected to throw');
    } catch (err) {
        expect(err.statusCode).toBe(400);
    }
}

describe('filterGrammar', () => {
    describe('parseFilters', () => {
        it('parses shorthand equality filters', () => {
            const result = parseFilters('{"city":"Ottawa","n":5}');
            expect(result).toEqual([
                { column: 'city', op: 'eq', value: 'Ottawa' },
                { column: 'n', op: 'eq', value: 5 }
            ]);
        });

        it('parses operator filters', () => {
            const result = parseFilters('{"amount":{"op":"gte","value":100}}');
            expect(result).toEqual([
                { column: 'amount', op: 'gte', value: 100 }
            ]);
        });

        it('rejects invalid JSON, arrays, and unknown operators with 400', () => {
            expect400(() => parseFilters('not json'));
            expect400(() => parseFilters('[1,2]'));
            expect400(() => parseFilters('{"a":{"op":"drop","value":1}}'));
            expect400(() => parseFilters('{"a":{"op":"eq","value":{"nested":true}}}'));
        });

        it('rejects more than 20 filter keys', () => {
            const obj = {};
            for (let i = 0; i < 21; i++) {
                obj['key' + i] = 'value';
            }
            expect400(() => parseFilters(JSON.stringify(obj)));
        });
    });

    describe('buildWhere', () => {
        it('rejects columns not in the whitelist', () => {
            const filters = parseFilters('{"name; DROP TABLE datasets; --":"x"}');
            expect400(() => buildWhere(filters, ['name'], 1));
        });

        it('malicious values only ever travel as parameters', () => {
            const evil = String.fromCharCode(39) + '; DROP TABLE datasets; --';
            const filters = [{ column: 'name', op: 'eq', value: evil }];
            const out = buildWhere(filters, ['name'], 1);
            expect(out.clause).toBe('"name" = $1');
            expect(out.params).toEqual([evil]);
            expect(out.clause.includes('DROP')).toBe(false);
        });

        it('contains builds an ILIKE with wrapped parameter', () => {
            const out = buildWhere(
                [{ column: 'desc_col', op: 'contains', value: 'abc' }],
                ['desc_col'],
                3
            );
            expect(out.clause).toBe('"desc_col"::text ILIKE $3');
            expect(out.params).toEqual(['%abc%']);
            expect(out.nextIndex).toBe(4);
        });

        it('eq null becomes IS NULL with no parameter', () => {
            const out = buildWhere(
                [{ column: 'a', op: 'eq', value: null }],
                ['a'],
                1
            );
            expect(out.clause).toBe('"a" IS NULL');
            expect(out.params).toEqual([]);
            expect(out.nextIndex).toBe(1);
        });
    });

    describe('quoteIdent', () => {
        it('rejects embedded double quotes', () => {
            expect400(() => quoteIdent('a"b'));
        });
    });

    describe('validateSort', () => {
        it('accepts known column with direction and rejects injection', () => {
            expect(validateSort('amount desc', ['amount']).sql).toBe('"amount" DESC');
            expect400(() => validateSort('amount; DROP TABLE x', ['amount']));
            expect400(() => validateSort('unknown_col asc', ['amount']));
            expect(validateSort(undefined, ['amount'])).toBeNull();
        });
    });

    describe('validateAggregation', () => {
        const cols = [
            { id: 'province', type: 'TEXT' },
            { id: 'amount', type: 'NUMERIC' },
            { id: 'n', type: 'INTEGER' },
            { id: 'day', type: 'DATE' },
            { id: 'ts', type: 'TIMESTAMPTZ' }
        ];

        it('returns null when all params are absent', () => {
            expect(validateAggregation({}, cols)).toBeNull();
            expect(validateAggregation({ group_by: '', agg: undefined }, cols)).toBeNull();
        });

        it('throws 400 when only group_by is given', () => {
            expect400(() => validateAggregation({ group_by: 'province' }, cols));
        });

        it('throws 400 when only agg is given', () => {
            expect400(() => validateAggregation({ agg: 'count' }, cols));
        });

        it('throws 400 when only bucket is given', () => {
            expect400(() => validateAggregation({ bucket: 'month' }, cols));
        });

        it('throws 400 on unknown group_by column', () => {
            expect400(() => validateAggregation({ group_by: 'unknown', agg: 'count' }, cols));
        });

        it('throws 400 on agg median', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: 'median' }, cols));
        });

        it('throws 400 on agg __proto__', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: '__proto__' }, cols));
        });

        it('throws 400 when agg_column passed with count', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: 'count', agg_column: 'amount' }, cols));
        });

        it('throws 400 when agg_column missing for sum', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: 'sum' }, cols));
        });

        it('throws 400 on unknown agg_column', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: 'sum', agg_column: 'unknown' }, cols));
        });

        it('throws 400 for sum over the TEXT column province', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: 'sum', agg_column: 'province' }, cols));
        });

        it('throws 400 for bucket week', () => {
            expect400(() => validateAggregation({ group_by: 'ts', agg: 'count', bucket: 'week' }, cols));
        });

        it('throws 400 for bucket month when group_by is province (TEXT)', () => {
            expect400(() => validateAggregation({ group_by: 'province', agg: 'count', bucket: 'month' }, cols));
        });

        it('count over province returns correct fields', () => {
            const result = validateAggregation({ group_by: 'province', agg: 'count' }, cols);
            expect(result).toEqual({
                groupBy: 'province',
                agg: 'count',
                aggColumn: null,
                bucket: null,
                fields: [
                    { id: 'key', type: 'TEXT' },
                    { id: 'value', type: 'INTEGER' }
                ]
            });
        });

        it('avg of amount grouped by province returns value type NUMERIC', () => {
            const result = validateAggregation({ group_by: 'province', agg: 'avg', agg_column: 'amount' }, cols);
            expect(result).toEqual({
                groupBy: 'province',
                agg: 'avg',
                aggColumn: 'amount',
                bucket: null,
                fields: [
                    { id: 'key', type: 'TEXT' },
                    { id: 'value', type: 'NUMERIC' }
                ]
            });
        });

        it('max of day grouped by province returns value type DATE', () => {
            const result = validateAggregation({ group_by: 'province', agg: 'max', agg_column: 'day' }, cols);
            expect(result).toEqual({
                groupBy: 'province',
                agg: 'max',
                aggColumn: 'day',
                bucket: null,
                fields: [
                    { id: 'key', type: 'TEXT' },
                    { id: 'value', type: 'DATE' }
                ]
            });
        });

        it('count grouped by ts with bucket month returns key type TIMESTAMPTZ and bucket month', () => {
            const result = validateAggregation({ group_by: 'ts', agg: 'count', bucket: 'month' }, cols);
            expect(result).toEqual({
                groupBy: 'ts',
                agg: 'count',
                aggColumn: null,
                bucket: 'month',
                fields: [
                    { id: 'key', type: 'TIMESTAMPTZ' },
                    { id: 'value', type: 'INTEGER' }
                ]
            });
        });

        it('min of n grouped by province returns value type INTEGER', () => {
            const result = validateAggregation({ group_by: 'province', agg: 'min', agg_column: 'n' }, cols);
            expect(result).toEqual({
                groupBy: 'province',
                agg: 'min',
                aggColumn: 'n',
                bucket: null,
                fields: [
                    { id: 'key', type: 'TEXT' },
                    { id: 'value', type: 'INTEGER' }
                ]
            });
        });
    });
});
