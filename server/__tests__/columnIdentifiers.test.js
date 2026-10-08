const { truncateUtf8, validColumnId, resolveLocalQueryColumns } = require('../utils/columnIdentifiers');
const { sanitizeColumnName, inferColumns, inferType } = require('../utils/csvTypes');
const { quoteIdent } = require('../utils/filterGrammar');

test.each(['é', '中', '🐟'])('Unicode %s identifiers remain unique inside the byte limit', character => {
    const used = new Set(['_id']);
    const source = character.repeat(80);
    const ids = [0, 119, 119].map(index => sanitizeColumnName(source, index, used));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
        expect(Buffer.byteLength(id)).toBeLessThanOrEqual(63);
        expect(validColumnId(id)).toBe(true);
    }
});

test('preserves existing valid names and the legacy physical truncation for invalid names', () => {
    expect(sanitizeColumnName('x'.repeat(80), 0, new Set())).toBe('x'.repeat(60));
    const original = 'é'.repeat(40);
    expect(inferColumns([original], [['abc']])).toEqual([{ id: 'é'.repeat(31), type: 'TEXT',
        original_label: original, legacy_ids: [original] }]);
    expect(() => quoteIdent(original)).toThrow('invalid identifier');
    expect(truncateUtf8('ab🐟', 5)).toBe('ab');
});

test('preserves source labels separately from usable identifiers', () => {
    expect(inferColumns([' A"b ', '_id', ''], [['x', 'y', 'z']])).toEqual([
        { id: 'Ab', type: 'TEXT', original_label: ' A"b ' },
        { id: '_id_2', type: 'TEXT', original_label: '_id' },
        { id: 'column_3', type: 'TEXT', original_label: '' }
    ]);
});

test('resolves only explicit aliases across local query options', () => {
    const legacy = 'é'.repeat(40);
    const canonical = truncateUtf8(legacy);
    const columns = [{ id: canonical, legacy_ids: [legacy] }, { id: 'field desc', legacy_ids: ['old desc'] }];
    expect(resolveLocalQueryColumns({ filters: [{ column: legacy, op: 'eq', value: 'x' }],
        sort: legacy + ' desc', group_by: legacy, agg_column: legacy }, columns)).toEqual({
        filters: [{ column: canonical, op: 'eq', value: 'x' }], sort: canonical + ' desc',
        group_by: canonical, agg_column: canonical
    });
    expect(resolveLocalQueryColumns({ sort: 'old desc' }, columns).sort).toBe('field desc');
    expect(resolveLocalQueryColumns({ group_by: 'unknown' }, columns).group_by).toBe('unknown');
});

test('canonical names win and ambiguous legacy aliases fail closed', () => {
    const columns = [{ id: 'one', legacy_ids: ['old', '_id'] }, { id: 'two', legacy_ids: ['old', 'one'] }];
    expect(resolveLocalQueryColumns({ sort: '_id' }, columns).sort).toBe('_id');
    expect(resolveLocalQueryColumns({ group_by: 'one' }, columns).group_by).toBe('one');
    expect(() => resolveLocalQueryColumns({ group_by: 'old' }, columns)).toThrow('ambiguous');
});

test.each(['00123', '-00123', '+00123', '00'])('leading-zero code %s remains text', value => {
    expect(inferType(['1', value])).toBe('TEXT');
});

test('ordinary integer zero and decimal quantities retain numeric inference', () => {
    expect(inferType(['0', '-12', '3000000000'])).toBe('INTEGER');
    expect(inferType(['0.25', '-1.5'])).toBe('NUMERIC');
});
