import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  parse: vi.fn(),
  permission: vi.fn(),
  result: vi.fn(),
  metrics: vi.fn(),
  first: vi.fn(),
}));
vi.mock('@/lib/request', () => ({
  parseRequest: state.parse,
  setWebsiteDate: async (_id: string, params: unknown) => params,
  getQueryFilters: async (filters: unknown) => filters,
}));
vi.mock('@/lib/response', () => ({
  json: (body: any) => ({ status: 200, body }),
  unauthorized: () => ({ status: 401 }),
}));
vi.mock('@/lib/schema', () => ({ reportResultSchema: {} }));
vi.mock('@/permissions', () => ({ canViewWebsiteSection: state.permission }));
vi.mock('@/lib/prisma', () => ({ default: { rawQuery: state.first } }));
vi.mock('@/queries/sql/reports/getPerformance', () => ({ getPerformance: state.result }));
vi.mock('@/queries/sql/reports/getPerformanceMetrics', () => ({
  getPerformanceMetrics: state.metrics,
}));

import { POST } from '@/app/api/reports/performance/route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CANQUERY_PERFORMANCE_WEBSITE_ID', 'canquery');
  state.parse.mockResolvedValue({
    auth: {},
    body: {
      websiteId: 'canquery',
      parameters: { method: 'legacy', metric: 'cls' },
      filters: { path: '/' },
    },
  });
  state.permission.mockResolvedValue(true);
  state.result.mockResolvedValue({ chart: [], summary: {} });
  state.metrics.mockResolvedValue([]);
  state.first.mockResolvedValue([{ started_at: '2026-10-02T00:00:00Z' }]);
});
afterEach(() => vi.unstubAllEnvs());

test('reports authorize before reading measurements or methodology metadata', async () => {
  state.permission.mockResolvedValue(false);
  expect(await POST({} as Request)).toMatchObject({ status: 401 });
  expect(state.result).not.toHaveBeenCalled();
  expect(state.first).not.toHaveBeenCalled();
});

test('the selected method reaches every report query and first-collection metadata stays tenant-scoped', async () => {
  const response: any = await POST({} as Request);
  expect(response.body).toMatchObject({
    method: 'legacy',
    availableMethods: ['corrected', 'legacy'],
    methodologyStartedAt: '2026-10-02T00:00:00Z',
  });
  expect(state.result).toHaveBeenCalledWith(
    'canquery',
    { method: 'legacy', metric: 'cls' },
    { path: '/' },
  );
  expect(state.metrics).toHaveBeenCalledTimes(4);
  for (const call of state.metrics.mock.calls) {
    expect(call.slice(0, 3)).toEqual([
      'canquery',
      { method: 'legacy', metric: 'cls' },
      { path: '/' },
    ]);
  }
  expect(state.first.mock.calls[0][0]).toContain('website_id = {{websiteId::uuid}}');
  expect(state.first.mock.calls[0][1]).toEqual({
    websiteId: 'canquery',
    performanceMethod: 'web-vitals-v1',
  });
});

test('other websites keep the original response without an extra metadata read', async () => {
  state.parse.mockResolvedValue({
    auth: {},
    body: { websiteId: 'other', parameters: {}, filters: {} },
  });
  const response: any = await POST({} as Request);
  expect(Object.keys(response.body).sort()).toEqual([
    'browsers',
    'chart',
    'devices',
    'pageTitles',
    'pages',
    'summary',
  ]);
  expect(state.first).not.toHaveBeenCalled();
});
