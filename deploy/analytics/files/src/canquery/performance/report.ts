import { isCanQueryPerformanceWebsite, PERFORMANCE_METHOD } from './config';

export const PERFORMANCE_METRICS = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const;
export type PerformanceMethod = 'corrected' | 'legacy';
export function performanceReportScope(websiteId: string, requested?: PerformanceMethod) {
  const enabled = isCanQueryPerformanceWebsite(websiteId);
  const method = enabled ? requested || 'corrected' : undefined;
  return {
    enabled,
    method,
    sql: !enabled
      ? ''
      : method === 'legacy'
        ? 'and website_event.performance_method IS NULL'
        : 'and website_event.performance_method = {{performanceMethod}}',
    params: method === 'corrected' ? { performanceMethod: PERFORMANCE_METHOD } : {},
  };
}

export function nullableMetric(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function summarizeMetrics(row: Record<string, unknown> = {}) {
  return Object.fromEntries(
    PERFORMANCE_METRICS.map(metric => [
      metric,
      {
        p50: nullableMetric(row[`${metric}_p50`]),
        p75: nullableMetric(row[`${metric}_p75`]),
        p95: nullableMetric(row[`${metric}_p95`]),
        count: Number(row[`${metric}_count`] || 0),
      },
    ]),
  );
}
