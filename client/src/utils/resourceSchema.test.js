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
    .toEqual({ filters: { code: 'y' }, sort: 'code desc', changed: true, dropped: true });
  expect(reconcileResourceFields({}, 'status desc', fields).sort).toBe('status desc');
  expect(reconcileResourceFields({}, '_id desc', fields).sort).toBe('_id desc');
});

test('ambiguous aliases are dropped and publisher aliases cannot replace generated _id', () => {
  const fields = [{ id: 'a', legacy_ids: ['old', '_id'] }, { id: 'b', legacy_ids: ['old'] }];
  expect(reconcileResourceFields({ old: 'x', _id: '1' }, 'old', fields))
    .toEqual({ filters: { _id: '1' }, sort: null, changed: true, dropped: true });
});

test("a file's columns renamed in its prepared copy are matched by their publisher label, not dropped", () => {
  const before = [{ id: '_id', type: 'int' }, { id: 'Year 2', type: 'INTEGER', original_label: 'Year' }, { id: 'City', type: 'TEXT', original_label: 'City' }];
  const after = [{ id: 'Year', type: 'INTEGER', original_label: 'Year' }, { id: 'City', type: 'TEXT', original_label: 'City' }];
  expect(reconcileResourceFields({ 'Year 2': '>2020', City: 'Ottawa' }, 'Year 2 desc', after, before))
    .toEqual({ filters: { Year: '>2020', City: 'Ottawa' }, sort: 'Year desc', changed: true, dropped: false });
  // A column with no counterpart is still dropped.
  expect(reconcileResourceFields({ Gone: 'x' }, null, after, before)).toMatchObject({ changed: true, dropped: true });
  // Without earlier columns nothing is matched by label.
  expect(reconcileResourceFields({ 'Year 2': '1' }, null, after)).toMatchObject({ filters: {}, dropped: true });
});
