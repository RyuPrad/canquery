import { afterEach, describe, expect, test } from 'vitest';
import { INITIAL_DATA_ID, readInitialData, takeInitialData, takeDatasetInitialData, consumeInitialData } from './initialData.js';

const resource = (overrides = {}) => ({
  data: { id: 'r1', query_mode: 'ingested', dataset: { id: 'd1' }, ingestion: { snapshot_id: 'cqs1_' + '1'.repeat(64) }, ...overrides },
  pagination: { nextCursor: null },
  meta: { source: 'canquery' },
});
const rows = () => ({
  data: { fields: [{ id: '_id', type: 'int' }, { id: 'name', type: 'TEXT' }], records: [{ _id: 1, name: '</script><!-- Ottawa' }], total: 2 },
  pagination: { nextCursor: null },
  meta: { query_mode: 'ingested', snapshot: { id: 'cqs1_' + '1'.repeat(64) } },
});
const payload = (overrides = {}) => ({ version: 1, path: '/resources/r1', page: 0, resource: resource(), rows: rows(), ...overrides });
// Mirrors the server's data-block escaping: < > & never appear literally.
const embed = (value) => {
  const json = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const element = document.createElement('script');
  element.type = 'application/json';
  element.id = INITIAL_DATA_ID;
  element.textContent = json;
  document.body.appendChild(element);
  return json;
};
const location = (search = '') => ({ pathname: '/resources/r1', search });

afterEach(() => { document.body.innerHTML = ''; });

describe('reading the embedded block', () => {
  test('returns the parsed payload with its escapes decoded', () => {
    const json = embed(payload());
    expect(json).not.toContain('</script>');
    const read = readInitialData();
    expect(read.path).toBe('/resources/r1');
    expect(read.rows.data.records[0].name).toBe('</script><!-- Ottawa');
    expect(read.resource.data.id).toBe('r1');
  });

  test('is null without a block, for malformed JSON and for other versions or shapes', () => {
    expect(readInitialData()).toBeNull();
    const element = document.createElement('script');
    element.type = 'application/json';
    element.id = INITIAL_DATA_ID;
    element.textContent = '{not json';
    document.body.appendChild(element);
    expect(readInitialData()).toBeNull();
    document.body.innerHTML = '';
    for (const broken of [
      payload({ version: 2 }),
      payload({ path: 7 }),
      payload({ page: 'two' }),
      payload({ resource: { data: { id: 'r1', query_mode: 'unknown', dataset: {} } } }),
      payload({ rows: { data: { fields: [], records: [], total: -1 }, meta: { query_mode: 'ingested' } } }),
      payload({ rows: { data: { fields: [], records: [], total: 1 }, meta: { query_mode: 'file' } } }),
      ['not', 'an', 'object'],
    ]) {
      embed(broken);
      expect(readInitialData()).toBeNull();
      document.body.innerHTML = '';
    }
    embed(payload({ rows: null, page: null }));
    expect(readInitialData().rows).toBeNull();
  });
});

describe('taking the block for an explorer', () => {
  test('requires the same URL and resource and rewrites map tiles like a fetched envelope', () => {
    embed(payload({ path: '/resources/r1?page=2', page: 2,
      resource: resource({ map: { available: true, tiles: '/api/v1/resources/r1/map/tiles/v/{z}/{x}/{y}.pbf' } }) }));
    expect(takeInitialData({ id: 'r1', location: location() })).toBeNull();
    expect(takeInitialData({ id: 'other', location: location('?page=2') })).toBeNull();
    const taken = takeInitialData({ id: 'r1', location: location('?page=2') });
    expect(taken.page).toBe(2);
    expect(taken.rows.data.total).toBe(2);
    expect(taken.resource.data.map.tiles).toBe('/web-api/v1/resources/r1/map/tiles/v/{z}/{x}/{y}.pbf');
    expect(taken.resource.meta.source).toBe('canquery');
  });

  test('consuming removes the block and is safe to repeat', () => {
    embed(payload());
    expect(document.getElementById(INITIAL_DATA_ID)).not.toBeNull();
    consumeInitialData();
    consumeInitialData();
    expect(document.getElementById(INITIAL_DATA_ID)).toBeNull();
    expect(takeInitialData({ id: 'r1', location: location() })).toBeNull();
  });
});

describe('a dataset page block', () => {
  const dataset = () => ({ data: { id: 'd1', name: 'roads', resources: [{ id: 'r1' }] }, pagination: { nextCursor: null }, meta: { source: 'canquery' } });
  const guides = () => ({ en: { data: [{ id: 'g1' }] }, fr: { data: [] } });
  const block = (overrides = {}) => ({ version: 1, kind: 'dataset', path: '/datasets/roads', dataset: dataset(), guides: guides(), ...overrides });
  const at = (search = '') => ({ pathname: '/datasets/roads', search });

  test('answers its dataset by name or id on the exact URL', () => {
    embed(block());
    const taken = takeDatasetInitialData({ idOrName: 'roads', location: at() });
    expect(taken.dataset.data.id).toBe('d1');
    expect(taken.guides.en.data).toEqual([{ id: 'g1' }]);
    expect(takeDatasetInitialData({ idOrName: 'd1', location: at() })).not.toBeNull();
    expect(takeDatasetInitialData({ idOrName: 'other', location: at() })).toBeNull();
    expect(takeDatasetInitialData({ idOrName: 'roads', location: at('?page=2') })).toBeNull();
  });

  test('is null for other kinds, versions and shapes, and the resource reader ignores it', () => {
    embed(block());
    expect(readInitialData()).toBeNull();
    for (const overrides of [{ kind: 'resource' }, { version: 2 }, { dataset: { data: { id: 'd1' } } },
      { guides: { en: { data: [] } } }, { guides: { en: { data: 'x' }, fr: { data: [] } } }]) {
      document.body.innerHTML = '';
      embed(block(overrides));
      expect(takeDatasetInitialData({ idOrName: 'roads', location: at() })).toBeNull();
    }
  });
});
