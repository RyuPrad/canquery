const { parseFilters, buildWhere, validateSort, quoteIdent } = require('../utils/filterGrammar');
const AppError = require('../utils/AppError');

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
});
