import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: any) => queries.prisma(),
}));
vi.mock('@/lib/clickhouse', () => ({ default: {} }));
vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: (sql: string, params: any) => state.query(sql, params),
    getDateSQL: () =>
      "to_char(date_trunc('day', website_event.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')",
    parseFilters: (filters: any, options: any = {}) => ({
      filterQuery: filters.path ? 'and website_event.url_path = {{path}}' : '',
      joinSessionQuery: options.joinSession
        ? 'join session on session.session_id = website_event.session_id'
        : '',
      cohortQuery: '',
      queryParams: filters,
    }),
  },
}));

import { getPerformanceStats } from '@/queries/sql/performance/getPerformanceStats';
import { getPerformance } from '@/queries/sql/reports/getPerformance';
import { getPerformanceMetrics } from '@/queries/sql/reports/getPerformanceMetrics';

const url = process.env.ANALYTICS_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const websiteId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const params = {
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: new Date('2026-10-03T00:00:00Z'),
  unit: 'day',
  timezone: 'utc',
  metric: 'cls',
};

integration('method-isolated performance SQL on disposable PostgreSQL', () => {
  let pool: any, db: any;
  beforeAll(async () => {
    vi.stubEnv('CANQUERY_PERFORMANCE_WEBSITE_ID', websiteId);
    pool = new Pool({ connectionString: url });
    db = await pool.connect();
    await db.query('BEGIN');
    // Shadow the migrated tables for this connection. No fixtures touch the
    // shared schema or another test's tenant, even while suites run in parallel.
    await db.query(
      'CREATE TEMP TABLE website_event (LIKE public.website_event INCLUDING ALL) ON COMMIT DROP',
    );
    await db.query('CREATE TEMP TABLE session (LIKE public.session INCLUDING ALL) ON COMMIT DROP');
    const desktop = randomUUID(),
      mobile = randomUUID();
    await db.query(
      `INSERT INTO session (session_id, website_id, device, browser)
      VALUES ($1,$3,'desktop','firefox'),($2,$3,'mobile','safari')`,
      [desktop, mobile, websiteId],
    );
    for (const [site, method, date, path, sessionId, lcp, inp, cls, fcp, ttfb, type = 5] of [
      [websiteId, 'web-vitals-v1', '2026-10-01', '/zero', desktop, 1000, null, 0, 800, 200],
      [websiteId, 'web-vitals-v1', '2026-10-01', '/shift', mobile, 3000, 400, 0.2, null, null],
      [
        websiteId,
        'web-vitals-v1',
        '2026-10-02',
        '/missing-cls',
        desktop,
        2000,
        null,
        null,
        900,
        100,
      ],
      [websiteId, null, '2026-10-01', '/legacy', desktop, 9000, 2000, 0.9, 8000, 6000],
      [websiteId, 'future-method', '2026-10-01', '/future', desktop, 12000, 3000, 1, 9000, 7000],
      [
        websiteId,
        'web-vitals-v1',
        '2026-10-01',
        '/not-performance',
        desktop,
        18000,
        5000,
        2,
        10000,
        8000,
        1,
      ],
      [otherId, null, '2026-10-01', '/other', desktop, 8000, null, 0.8, 7000, 5000],
    ]) {
      await db.query(
        `INSERT INTO website_event
        (event_id,website_id,session_id,visit_id,created_at,url_path,page_title,event_type,
         performance_method,lcp,inp,cls,fcp,ttfb)
        VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          site,
          sessionId,
          randomUUID(),
          date,
          path,
          type,
          method,
          lcp,
          inp,
          cls,
          fcp,
          ttfb,
        ],
      );
    }
    state.query.mockImplementation(async (sql: string, params: Record<string, unknown>) => {
      const values: unknown[] = [];
      const query = sql.replace(/\{\{(\w+)(::\w+)?\}\}/g, (_match, key, cast = '') => {
        if (!(key in params)) throw new Error(`Missing SQL parameter: ${key}`);
        values.push(params[key]);
        return `$${values.length}${cast}`;
      });
      return (await db.query(query, values)).rows;
    });
  });
  afterAll(async () => {
    if (db) {
      await db.query('ROLLBACK');
      db.release();
    }
    if (pool) await pool.end();
    vi.unstubAllEnvs();
  });

  test('corrected summary counts each observed metric and keeps a missing day as a gap', async () => {
    const { chart, summary } = await getPerformance(websiteId, params, {});
    expect(summary.count).toBe(3);
    expect(summary.cls.count).toBe(2);
    expect(summary.cls.p50).toBeCloseTo(0.1);
    expect(summary.cls.p75).toBeCloseTo(0.15);
    expect(summary.inp).toEqual({ count: 1, p50: 400, p75: 400, p95: 400 });
    expect(summary.lcp).toEqual({ count: 3, p50: 2000, p75: 2500, p95: 2900 });
    expect(Number(chart[0].count)).toBe(2);
    expect(chart[1]).toMatchObject({ t: '2026-10-02', p50: null, p75: null, p95: null });
    expect(Number(chart[1].count)).toBe(0);
  });

  test('breakdowns retain observed zero CLS, omit unobserved CLS, and count the selected metric', async () => {
    const pages = await getPerformanceMetrics(websiteId, params, {}, 'url_path');
    expect(pages.map(row => row.name)).toEqual(['/shift', '/zero']);
    expect(pages[1]).toMatchObject({ p50: 0, p75: 0, p95: 0 });
    expect(Number(pages[1].count)).toBe(1);
    const devices = await getPerformanceMetrics(websiteId, params, {}, 'device');
    expect(devices.map(row => row.name)).toEqual(['mobile', 'desktop']);
    const browsers = await getPerformanceMetrics(
      websiteId,
      { ...params, metric: 'inp' },
      {},
      'browser',
    );
    expect(browsers.map(row => row.name)).toEqual(['safari']);
    expect(Number(browsers[0].count)).toBe(1);
  });

  test('legacy is a separate population and unconfigured sites retain their original report shape', async () => {
    const legacy = await getPerformance(websiteId, { ...params, method: 'legacy' }, {});
    expect(legacy.summary.count).toBe(1);
    expect(legacy.summary.cls).toEqual({ p50: 0.9, p75: 0.9, p95: 0.9, count: 1 });
    const other = await getPerformance(otherId, { ...params, method: 'corrected' }, {});
    expect(other.summary.count).toBe(1);
    expect(other.summary.cls).toEqual({ p50: 0.8, p75: 0.8, p95: 0.8 });
    expect(other.summary.inp).toEqual({ p50: 0, p75: 0, p95: 0 });
    expect(other.chart[0]).not.toHaveProperty('count');
  });

  test('empty periods show null metrics, and date/path filters apply to both chart and summary', async () => {
    const empty = await getPerformance(
      websiteId,
      { ...params, startDate: new Date('2025-01-01'), endDate: new Date('2025-01-02') },
      {},
    );
    expect(empty.chart).toEqual([]);
    expect(empty.summary.cls).toEqual({ p50: null, p75: null, p95: null, count: 0 });
    const zero = await getPerformance(websiteId, params, { path: '/zero' } as any);
    expect(zero.summary.cls).toEqual({ p50: 0, p75: 0, p95: 0, count: 1 });
    expect(zero.summary.inp).toEqual({ p50: null, p75: null, p95: null, count: 0 });
    expect(zero.chart).toHaveLength(1);
    const stats = await getPerformanceStats(websiteId, { ...params, path: '/zero' } as any);
    expect(stats).toMatchObject({ cls: 0, inp: null });
  });
});
