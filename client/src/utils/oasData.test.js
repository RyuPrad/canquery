import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadOasSummary, loadOasTable, peekOasSummary, peekOasTable, resetOasData, takeOasInitialData } from './oasData.js';

vi.mock('../api/oas.js', async (original) => ({ ...(await original()), fetchOasSummary: vi.fn(), fetchOasTable: vi.fn() }));
import { fetchOasSummary, fetchOasTable } from '../api/oas.js';

const row = [0, 2399, 113890, null, 190140, 197765];
const figures = (table) => ({ table, resource_id: 'res-' + table, row_count: 1, max_amount_cents: 113890, max_allowance_cents: null, ends_at_cents: 2400 });
const period = (key) => ({ key, year: Math.floor(key / 100), quarter: (key % 100) / 3, start: '2026-10-01', end: '2026-12-31', income_year: 2025 });
const summary = (key = 202612) => ({ period: period(key), oas: { age_65_cents: 76250, age_75_cents: 83875 },
  tables: [1, 2, 3, 4, 5].map((table) => ({ ...figures(table), condensed: [row] })), previous: null });
const table = (number, key = 202612) => ({ period: period(key), oas: null, table: figures(number), rows: [row] });
const envelope = (data) => ({ data, pagination: { nextCursor: null }, meta: {} });
function block(payload) {
  document.getElementById('cq-initial')?.remove();
  const element = document.createElement('script');
  element.type = 'application/json';
  element.id = 'cq-initial';
  element.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload);
  document.body.appendChild(element);
}
const at = (pathname, search = '') => ({ pathname, search });

beforeEach(() => {
  vi.clearAllMocks();
  resetOasData();
  document.getElementById('cq-initial')?.remove();
  fetchOasSummary.mockResolvedValue(envelope(summary()));
  fetchOasTable.mockImplementation(async (number, key) => envelope(table(number, key)));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('what the OAS pages have read', () => {
  test('the summary is asked for once, kept five minutes, then asked for again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    expect(peekOasSummary()).toBeNull();
    const [first, second] = await Promise.all([loadOasSummary(), loadOasSummary()]);
    expect(first).toBe(second);
    expect(fetchOasSummary).toHaveBeenCalledTimes(1);
    expect(peekOasSummary()).toBe(first);
    vi.setSystemTime(new Date('2026-11-11T12:04:59Z'));
    await loadOasSummary();
    expect(fetchOasSummary).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-11T12:05:01Z'));
    expect(peekOasSummary()).toBeNull();
    await loadOasSummary();
    expect(fetchOasSummary).toHaveBeenCalledTimes(2);
  });

  test('a table is kept by quarter and number; a failed request is not kept', async () => {
    expect(peekOasTable(202612, 2)).toBeNull();
    const [first, second] = await Promise.all([loadOasTable(202612, 2), loadOasTable(202612, 2)]);
    expect(first).toBe(second);
    expect(fetchOasTable).toHaveBeenCalledTimes(1);
    expect(fetchOasTable).toHaveBeenCalledWith(2, 202612);
    expect(peekOasTable(202612, 2)).toBe(first);
    expect(peekOasTable(202609, 2)).toBeNull();
    await loadOasTable(202609, 2);
    expect(fetchOasTable).toHaveBeenCalledTimes(2);
    fetchOasTable.mockRejectedValueOnce(new Error('offline'));
    await expect(loadOasTable(202612, 3)).rejects.toThrow('offline');
    expect(peekOasTable(202612, 3)).toBeNull();
    await loadOasTable(202612, 3);
    expect(peekOasTable(202612, 3)).not.toBeNull();
  });

  test('the block of a direct visit is taken only when it answers this address, language and table', () => {
    const hub = { version: 1, kind: 'oas', path: '/oas', lang: 'en', table: null, summary: envelope(summary()), rows: null };
    block(hub);
    expect(takeOasInitialData({ language: 'en', table: null, location: at('/oas', '?utm=1') })).toBe(false);
    expect(takeOasInitialData({ language: 'fr', table: null, location: at('/oas') })).toBe(false);
    expect(takeOasInitialData({ language: 'en', table: 1, location: at('/oas') })).toBe(false);
    expect(peekOasSummary()).toBeNull();
    expect(takeOasInitialData({ language: 'en', table: null, location: at('/oas') })).toBe(true);
    expect(peekOasSummary().period.key).toBe(202612);

    resetOasData();
    const page = { version: 1, kind: 'oas', path: '/fr/sv/tableau-3?x=1', lang: 'fr', table: 3, summary: envelope(summary()), rows: envelope(table(3)) };
    block(page);
    expect(takeOasInitialData({ language: 'fr', table: 3, location: at('/fr/sv/tableau-3', '?x=1') })).toBe(true);
    expect(peekOasTable(202612, 3).rows).toEqual([row]);
  });

  test('a block that is not what the server sends is left alone', () => {
    const good = { version: 1, kind: 'oas', path: '/oas/table-3', lang: 'en', table: 3, summary: envelope(summary()), rows: envelope(table(3)) };
    const location = at('/oas/table-3');
    for (const bad of [
      'not json', { ...good, version: 2 }, { ...good, kind: 'guide' }, { ...good, rows: null }, { ...good, rows: envelope(table(4)) },
      { ...good, rows: envelope(table(3, 202609)) }, { ...good, summary: envelope({ ...summary(), tables: [] }) },
      { ...good, rows: envelope({ ...table(3), rows: [[0, 2399, -5, null, null, null]] }) },
      { ...good, rows: envelope({ ...table(3), rows: [[0, 2399, '113890', null, null, null]] }) },
      { ...good, summary: envelope({ ...summary(), period: { key: '202612' } }) }, [good], null
    ]) {
      block(bad);
      expect([JSON.stringify(bad).slice(0, 60), takeOasInitialData({ language: 'en', table: 3, location })]).toEqual([JSON.stringify(bad).slice(0, 60), false]);
      expect(peekOasSummary()).toBeNull();
      expect(peekOasTable(202612, 3)).toBeNull();
    }
    document.getElementById('cq-initial')?.remove();
    expect(takeOasInitialData({ language: 'en', table: 3, location })).toBe(false);
  });
});
