import { PERFORMANCE_METHOD } from '@/canquery/performance/config';
import { performanceReportScope } from '@/canquery/performance/report';
import prisma from '@/lib/prisma';
import { getQueryFilters, parseRequest, setWebsiteDate } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { reportResultSchema } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import { getPerformance, type PerformanceParameters } from '@/queries/sql/reports/getPerformance';
import { getPerformanceMetrics } from '@/queries/sql/reports/getPerformanceMetrics';

export async function POST(request: Request) {
  const { auth, body, error } = await parseRequest(request, reportResultSchema);

  if (error) {
    return error();
  }

  const { websiteId } = body;

  if (!(await canViewWebsiteSection(auth, websiteId, 'performance'))) {
    return unauthorized();
  }

  const parameters = await setWebsiteDate(websiteId, body.parameters);
  const filters = await getQueryFilters(body.filters, websiteId);

  const [{ chart, summary }, pages, pageTitles, devices, browsers] = await Promise.all([
    getPerformance(websiteId, parameters as PerformanceParameters, filters),
    getPerformanceMetrics(websiteId, parameters as PerformanceParameters, filters, 'url_path', 500),
    getPerformanceMetrics(
      websiteId,
      parameters as PerformanceParameters,
      filters,
      'page_title',
      500,
    ),
    getPerformanceMetrics(websiteId, parameters as PerformanceParameters, filters, 'device'),
    getPerformanceMetrics(websiteId, parameters as PerformanceParameters, filters, 'browser', 500),
  ]);

  const scope = performanceReportScope(websiteId, (parameters as PerformanceParameters).method);
  if (!scope.enabled) return json({ chart, summary, pages, pageTitles, devices, browsers });
  const first = await prisma.rawQuery(
    `select min(created_at) as started_at from website_event
     where website_id = {{websiteId::uuid}} and event_type = 5
       and performance_method = {{performanceMethod}}`,
    { websiteId, performanceMethod: PERFORMANCE_METHOD },
  );
  return json({
    chart,
    summary,
    pages,
    pageTitles,
    devices,
    browsers,
    method: scope.method,
    availableMethods: ['corrected', 'legacy'],
    methodologyStartedAt: first?.[0]?.started_at || null,
  });
}
