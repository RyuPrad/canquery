jest.mock('../db/pool', () => ({ query: jest.fn() }));
const { reconcileColumns } = require('../scripts/repair-column-identifiers');
const long = 'é'.repeat(40);
const metadata = [{ id: long, type: 'TEXT' }, { id: 'amount', type: 'NUMERIC' }];
const physical = [{ ordinal: 1, name: '_id', type: 'bigint' },
    { ordinal: 2, name: 'é'.repeat(31), type: 'text' }, { ordinal: 3, name: 'amount', type: 'numeric' }];

test('repairs only a proved physical truncation and keeps exact legacy evidence', () => {
    const repaired = reconcileColumns(metadata, physical);
    expect(repaired).toEqual([{ id: physical[1].name, type: 'TEXT', legacy_ids: [long] }, metadata[1]]);
    expect(reconcileColumns(repaired, physical)).toEqual(repaired);
    expect(metadata[0].id).toBe(long);
});

test.each([
    physical.slice(0, 2),
    [physical[0], physical[2], physical[1]],
    [physical[0], { ...physical[1], name: 'different' }, physical[2]],
    [physical[0], { ...physical[1], type: 'numeric' }, physical[2]],
    [physical[0], physical[1], { ...physical[2], ordinal: 4 }]
])('refuses incomplete, reordered, mismatched or dropped-column inventories', columns => {
    expect(() => reconcileColumns(metadata, columns)).toThrow();
});

test('a short mismatch is not guessed or renamed by ordinal alone', () => {
    expect(() => reconcileColumns([{ id: 'old', type: 'TEXT' }], physical.slice(0, 2))).toThrow('truncation');
});
