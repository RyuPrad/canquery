import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../extensions.js');
  vi.resetModules();
});

async function load(part) {
  vi.resetModules();
  vi.doMock('../extensions.js', () => ({ hostedPart: (_modules, fallback) => part || fallback }));
  return (await import('./queryGate.js')).allowQuery;
}

test('the community edition lets every table change through', async () => {
  const allowQuery = await load(null);
  for (const kind of ['search', 'filter', 'sort', 'page']) {
    for (let index = 0; index < 10; index += 1) expect(allowQuery(kind, { resource: 'a' })).toBe(true);
  }
});

test('the hosted gate gets the change and its answer is kept', async () => {
  const gate = { allowQuery: vi.fn(() => false) };
  const allowQuery = await load(gate);
  expect(allowQuery('filter', { resource: 'a', field: 'City', value: 'Ottawa' })).toBe(false);
  expect(gate.allowQuery).toHaveBeenCalledWith('filter', { resource: 'a', field: 'City', value: 'Ottawa' });
  gate.allowQuery.mockReturnValue(true);
  expect(allowQuery('page', { resource: 'a', page: 2 })).toBe(true);
  gate.allowQuery.mockReturnValue(undefined);
  expect(allowQuery('sort', { resource: 'a', value: 'City asc' })).toBe(true);
});

test('a hosted gate that fails lets the change through', async () => {
  const allowQuery = await load({ allowQuery: () => { throw new Error('storage gone'); } });
  expect(allowQuery('search', { resource: 'a', value: 'Ottawa' })).toBe(true);
});
