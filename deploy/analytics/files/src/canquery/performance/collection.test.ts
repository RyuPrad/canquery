import { beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from '@/app/api/send/route';
import { saveEvent } from '@/queries/sql';
import { savePerformance } from './savePerformance';

const WEBSITE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NAVIGATION = '33333333-3333-4333-8333-333333333333';

vi.mock('@/canquery/performance/savePerformance', () => ({ savePerformance: vi.fn() }));
vi.mock('@/lib/clickhouse', () => ({ default: { enabled: false } }));
vi.mock('@/lib/detect', () => ({
  getClientInfo: vi.fn(async () => ({
    ip: '203.0.113.1',
    userAgent: 'test browser',
    device: 'desktop',
  })),
  hasBlockedIp: vi.fn(() => false),
}));
vi.mock('@/lib/load', () => ({ fetchWebsite: vi.fn(async () => ({ id: WEBSITE })) }));
vi.mock('isbot', () => ({ isbot: vi.fn(() => false) }));
vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(async (request, schema) => {
    const parsed = schema.safeParse(await request.json());
    return parsed.success
      ? { body: parsed.data }
      : {
          error: () => Response.json({ error: 'Invalid payload' }, { status: 400 }),
        };
  }),
}));
vi.mock('@/queries/sql', () => ({
  createSession: vi.fn(),
  saveEvent: vi.fn(),
  saveSessionData: vi.fn(),
  saveSessionLink: vi.fn(),
  updateSession: vi.fn(),
}));

function send(overrides = {}, type = 'performance-v2') {
  return POST(
    new Request('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        payload: {
          website: WEBSITE,
          url: 'https://canquery.com/datasets/initial?private=1',
          hostname: 'canquery.com',
          title: 'Original title',
          lcp: 900,
          cls: 0,
          performance: {
            id: NAVIGATION,
            revision: 2,
            method: 'web-vitals-v1',
            navigationType: 'navigate',
          },
          ...overrides,
        },
      }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_SECRET', 'isolated-collection-test');
  vi.stubEnv('CANQUERY_PERFORMANCE_WEBSITE_ID', WEBSITE);
  vi.stubEnv('CANQUERY_PERFORMANCE_COLLECTION_ENABLED', 'true');
});

describe('native corrected performance collection', () => {
  test('routes opted-in website snapshots to idempotent storage and strips query strings', async () => {
    const result = await send();
    expect(result.status).toBe(200);
    expect(saveEvent).not.toHaveBeenCalled();
    expect(savePerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteId: WEBSITE,
        urlPath: '/datasets/initial',
        pageTitle: 'Original title',
        lcp: 900,
        cls: 0,
        eventType: 5,
      }),
      { id: NAVIGATION, revision: 2, method: 'web-vitals-v1', navigationType: 'navigate' },
    );
  });

  test('unchanged legacy CanQuery and Mochi payloads use original collection', async () => {
    expect((await send({ performance: undefined }, 'performance')).status).toBe(200);
    expect((await send({ website: OTHER, performance: undefined }, 'performance')).status).toBe(
      200,
    );
    expect(saveEvent).toHaveBeenCalledTimes(2);
    expect(savePerformance).not.toHaveBeenCalled();
  });

  test('other websites and unconfigured deployments cannot opt into corrected writes', async () => {
    expect((await send({ website: OTHER })).status).toBe(400);
    vi.stubEnv('CANQUERY_PERFORMANCE_WEBSITE_ID', '');
    expect((await send()).status).toBe(400);
    expect(savePerformance).not.toHaveBeenCalled();
  });

  test.each([
    { id: 'invalid' },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { revision: 2147483648 },
    { method: 'unknown' },
    { navigationType: 'soft-navigation' },
  ])('rejects invalid snapshot metadata %j', async patch => {
    const performance = {
      id: NAVIGATION,
      revision: 1,
      method: 'web-vitals-v1',
      navigationType: 'navigate',
      ...patch,
    };
    expect((await send({ performance })).status).toBe(400);
    expect(savePerformance).not.toHaveBeenCalled();
  });

  test('rejects empty performance snapshots and event-type confusion', async () => {
    expect((await send({ lcp: undefined, cls: undefined })).status).toBe(400);
    expect((await send({}, 'event')).status).toBe(400);
    expect((await send({}, 'performance')).status).toBe(400);
    expect((await send({ performance: undefined })).status).toBe(400);
    expect(savePerformance).not.toHaveBeenCalled();
  });

  test('retains slow-tail values above legacy limits without changing legacy validation', async () => {
    expect((await send({ lcp: 90000, cls: 101 })).status).toBe(200);
    expect(savePerformance).toHaveBeenCalledWith(
      expect.objectContaining({ lcp: 90000, cls: 101 }),
      expect.anything(),
    );
    expect((await send({ lcp: 90000, performance: undefined }, 'performance')).status).toBe(400);
    expect((await send({ lcp: 86400001 })).status).toBe(400);
  });

  test('collection pause stops corrected writes while preserving legacy collection', async () => {
    vi.stubEnv('CANQUERY_PERFORMANCE_COLLECTION_ENABLED', 'false');
    const result = await send();
    expect(await result.json()).toEqual({ disabled: true });
    expect(savePerformance).not.toHaveBeenCalled();
    expect((await send({ performance: undefined }, 'performance')).status).toBe(200);
    expect(saveEvent).toHaveBeenCalledOnce();
  });
});
