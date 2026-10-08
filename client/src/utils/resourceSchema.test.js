import { reconcileResourceFields, schemaFingerprint } from './resourceSchema.js';

test('schema identity includes ordered field types but not original labels', () => {
  expect(schemaFingerprint([{ id: 'a', type: 'TEXT', original_label: 'A' }]))
    .toBe(schemaFingerprint([{ id: 'a', type: 'TEXT', original_label: 'B' }]));
  expect(schemaFingerprint([{ id: 'a', type: 'TEXT' }]))
    .not.toBe(schemaFingerprint([{ id: 'a', type: 'INTEGER' }]));
});

test('canonical fields win over aliases, including whole names ending in a direction', () => {
  const fields = [{ id: 'code', type: 'TEXT', legacy_ids: ['old'] }, { id: 'status desc', type: 'TEXT' }];
  expect(reconcileResourceFields({ old: 'x', code: 'y', removed: 'z' }, 'old desc', fields))
    .toEqual({ filters: { code: 'y' }, sort: 'code desc', changed: true });
  expect(reconcileResourceFields({}, 'status desc', fields).sort).toBe('status desc');
  expect(reconcileResourceFields({}, '_id desc', fields).sort).toBe('_id desc');
});

test('ambiguous aliases are dropped and publisher aliases cannot replace generated _id', () => {
  const fields = [{ id: 'a', legacy_ids: ['old', '_id'] }, { id: 'b', legacy_ids: ['old'] }];
  expect(reconcileResourceFields({ old: 'x', _id: '1' }, 'old', fields))
    .toEqual({ filters: { _id: '1' }, sort: null, changed: true });
});
