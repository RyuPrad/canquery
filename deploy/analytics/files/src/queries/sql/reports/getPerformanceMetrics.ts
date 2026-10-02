import { performanceReportScope } from '@/canquery/performance/report';
import clickhouse from '@/lib/clickhouse';
import { SESSION_COLUMNS } from '@/lib/constants';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';
import type { PerformanceParameters } from './getPerformance';

export interface PerformanceMetricsData {
  name: string;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  count: number;
}

export async function getPerformanceMetrics(
  ...args: [
    websiteId: string,
    parameters: PerformanceParameters,
    filters: QueryFilters,
    column: string,
    limit?: number,
  ]
) {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(
  websiteId: string,
  parameters: PerformanceParameters,
  filters: QueryFilters,
  column: string,
  limit?: number,
): Promise<PerformanceMetricsData[]> {
  const { startDate, endDate, metric = 'lcp' } = parameters;
  const scope = performanceReportScope(websiteId, parameters.method);
  const { rawQuery, parseFilters } = prisma;
  const { filterQuery, joinSessionQuery, cohortQuery, queryParams } = parseFilters(
    { ...filters, websiteId },
    { joinSession: SESSION_COLUMNS.includes(column) },
  );

  return rawQuery(
    `
    select
      ${column} as "name",
      percentile_cont(0.5) within group (order by ${metric}) as p50,
      percentile_cont(0.75) within group (order by ${metric}) as p75,
      percentile_cont(0.95) within group (order by ${metric}) as p95,
      count(${scope.enabled ? metric : '*'}) as count
    from website_event
    ${cohortQuery}
    ${joinSessionQuery}
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.event_type = 5
      and website_event.created_at between {{startDate}} and {{endDate}}
      ${scope.sql}
      ${filterQuery}
    group by ${column}
    ${scope.enabled ? `having count(${metric}) > 0` : ''}
    order by p75 desc
    ${limit ? `limit ${limit}` : ''}
    `,
    { ...queryParams, ...scope.params, startDate, endDate },
  );
}

async function clickhouseQuery(
  websiteId: string,
  parameters: PerformanceParameters,
  filters: QueryFilters,
  column: string,
  limit?: number,
): Promise<PerformanceMetricsData[]> {
  const { startDate, endDate, metric = 'lcp' } = parameters;
  const { rawQuery, parseFilters } = clickhouse;
  const { filterQuery, cohortQuery, queryParams } = parseFilters({ ...filters, websiteId });

  return rawQuery<PerformanceMetricsData[]>(
    `
    select
      ${column} as "name",
      quantile(0.5)(${metric}) as p50,
      quantile(0.75)(${metric}) as p75,
      quantile(0.95)(${metric}) as p95,
      count() as count
    from website_event
    ${cohortQuery}
    where website_event.website_id = {websiteId:UUID}
      and website_event.event_type = 5
      and website_event.created_at between {startDate:DateTime64} and {endDate:DateTime64}
      ${filterQuery}
    group by ${column}
    order by p75 desc
    ${limit ? `limit ${limit}` : ''}
    `,
    { ...queryParams, startDate, endDate },
  );
}
