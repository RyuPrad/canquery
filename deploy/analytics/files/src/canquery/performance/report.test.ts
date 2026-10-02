import { afterEach, expect, test, vi } from 'vitest';
import { performanceReportSchema } from '@/lib/schema';
import { performanceReportScope, summarizeMetrics } from './report';

afterEach(() => vi.unstubAllEnvs());

test('only the configured website defaults to corrected measurements', () => {
  vi.stubEnv('CANQUERY_PERFORMANCE_WEBSITE_ID', 'canquery');
  expect(performanceReportScope('canquery')).toMatchObject({
    enabled: true,
    method: 'corrected',
    params: { performanceMethod: 'web-vitals-v1' },
  });
  expect(performanceReportScope('canquery', 'legacy')).toMatchObject({
    method: 'legacy',
    sql: 'and website_event.performance_method IS NULL',
    params: {},
  });
  expect(performanceReportScope('another-site', 'corrected')).toEqual({
    enabled: false,
    method: undefined,
    sql: '',
    params: {},
  });
  vi.stubEnv('CANQUERY_PERFORMANCE_WEBSITE_ID', '');
  expect(performanceReportScope('canquery').enabled).toBe(false);
});

test('an observed zero and a missing metric remain distinct with independent sample counts', () => {
  const summary = summarizeMetrics({ cls_p50: 0, cls_p75: '0', cls_p95: '0.012', cls_count: '4' });
  expect(summary.cls).toEqual({ p50: 0, p75: 0, p95: 0.012, count: 4 });
  expect(summary.inp).toEqual({ p50: null, p75: null, p95: null, count: 0 });
  expect(summarizeMetrics().lcp).toEqual({ p50: null, p75: null, p95: null, count: 0 });
});

test('the report request validates the method without changing its default', () => {
  const request = {
    type: 'performance',
    parameters: {
      startDate: '2026-10-01',
      endDate: '2026-10-02',
      metric: 'cls',
    },
  };
  expect(performanceReportSchema.parse(request).parameters.method).toBeUndefined();
  for (const method of ['corrected', 'legacy']) {
    expect(
      performanceReportSchema.parse({ ...request, parameters: { ...request.parameters, method } })
        .parameters.method,
    ).toBe(method);
  }
  expect(
    performanceReportSchema.safeParse({
      ...request,
      parameters: { ...request.parameters, method: 'combined' },
    }).success,
  ).toBe(false);
});
