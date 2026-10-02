import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { UPSERT_PERFORMANCE_SQL } from './collect';

const connectionString = process.env.ANALYTICS_TEST_DATABASE_URL;
const website = randomUUID();
const otherWebsite = randomUUID();
let pool: Pool;

describe.runIf(Boolean(connectionString))('native performance PostgreSQL snapshots', () => {
  beforeAll(async () => {
    const url = new URL(connectionString || '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/analytics_performance' ||
      process.env.DATABASE_URL !== connectionString
    ) {
      throw new Error('Requires the explicitly isolated local analytics_performance database.');
    }
    pool = new Pool({ connectionString, max: 5, statement_timeout: 5000 });
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(
      'analytics_performance',
    );
  });
  afterEach(async () => {
    await pool?.query('DELETE FROM website_event WHERE website_id IN ($1::uuid,$2::uuid)', [
      website,
      otherWebsite,
    ]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const write = (
    id: string,
    revision: number,
    inp: number | null,
    extra: Record<string, unknown> = {},
  ) => {
    const values = {
      website,
      session: randomUUID(),
      visit: randomUUID(),
      at: '2026-10-02T00:00:00Z',
      path: '/resources/original',
      title: 'Original title',
      lcp: 900,
      cls: 0,
      method: 'web-vitals-v1',
      navigation: 'navigate',
      ...extra,
    };
    return pool.query(UPSERT_PERFORMANCE_SQL, [
      id,
      values.website,
      values.session,
      values.visit,
      values.at,
      values.path,
      values.title,
      'canquery.com',
      values.lcp,
      inp,
      values.cls,
      450,
      200,
      values.method,
      revision,
      values.navigation,
    ]);
  };
  const read = async (id: string) =>
    (await pool.query('SELECT * FROM website_event WHERE event_id=$1::uuid', [id])).rows[0];

  test('out-of-order and duplicate deliveries preserve one newest snapshot, including decreasing INP', async () => {
    const id = randomUUID();
    await write(id, 1, 400);
    await Promise.all([
      write(id, 4, 240),
      write(id, 2, 320),
      write(id, 5, 180),
      write(id, 3, 260),
      write(id, 5, 180),
    ]);
    const result = await read(id);
    expect(result.performance_revision).toBe(5);
    expect(Number(result.inp)).toBe(180);
    expect(Number(result.cls)).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::int n FROM website_event WHERE website_id=$1', [website]))
        .rows[0].n,
    ).toBe(1);
  });

  test('a newer snapshot arriving first is not overwritten or moved to later report dates', async () => {
    const id = randomUUID();
    await write(id, 4, 200);
    await write(id, 1, 900, { at: '2026-10-03T00:00:00Z', title: 'Changed title' });
    const result = await read(id);
    expect(result.performance_revision).toBe(4);
    expect(result.created_at.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(result.page_title).toBe('Original title');
  });

  test('updates retain original dimensions and missing metrics remain NULL until observed', async () => {
    const id = randomUUID();
    await write(id, 1, null);
    const original = await read(id);
    expect(original.inp).toBeNull();
    await write(id, 2, 80, { title: 'Later route title', at: '2026-10-04T00:00:00Z' });
    const updated = await read(id);
    expect(updated.session_id).toBe(original.session_id);
    expect(updated.visit_id).toBe(original.visit_id);
    expect(updated.page_title).toBe(original.page_title);
    expect(updated.created_at).toEqual(original.created_at);
    expect(Number(updated.inp)).toBe(80);
  });

  test('conflicting website, path, method or navigation cannot overwrite an existing snapshot', async () => {
    const id = randomUUID();
    await write(id, 1, 50);
    for (const conflict of [
      { website: otherWebsite },
      { path: '/other' },
      { method: 'other' },
      { navigation: 'back-forward-cache' },
    ])
      await write(id, 2, 900, conflict);
    const result = await read(id);
    expect(result.performance_revision).toBe(1);
    expect(Number(result.inp)).toBe(50);
  });
});
