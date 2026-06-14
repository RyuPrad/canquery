import { useState, useEffect, useMemo } from 'react';
import { queryResource } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { buildInsights, buildKpis, hasAnyInsight } from './charts/classify.js';
import {
  ChartCard, KpiCard, ChartSkeleton, ChartEmpty,
  DonutChart, CategoryBar, TimeSeriesChart,
} from './charts/Visuals.jsx';
import { humanize, fmtInt, fmtNum, yearOf, cleanRecords } from './charts/theme.js';
import { DatabaseIcon, SparklesIcon, ZapIcon, CalendarIcon } from './Icons.jsx';

// One self-contained insight: fetches its own aggregation (respecting the
// explorer's current search + filters) and renders the matching visual.
function InsightChart({ resourceId, q, filters, spec, lang }) {
  const { t } = useLang();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const filtersKey = JSON.stringify(filters || {});
  const isTime = spec.kind === 'timeseries';

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    queryResource(resourceId, {
      q,
      filters,
      group_by: spec.column,
      agg: spec.agg,
      agg_column: spec.aggColumn,
      bucket: spec.bucket,
      sort: isTime ? 'key asc' : 'value desc',
      limit: isTime ? 100 : 12,
    })
      .then((env) => { if (!cancelled) setRows(cleanRecords(env.data.records)); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, spec.column, spec.agg, spec.aggColumn, spec.bucket, isTime]);

  let title = humanize(spec.column);
  let subtitle;
  if (spec.role === 'metric_time') { title = humanize(spec.aggColumn); subtitle = t('chart.role_metric_time'); }
  else if (spec.role === 'time') subtitle = t('chart.role_time');
  else if (spec.role === 'measure') subtitle = t('chart.role_sum') + ' ' + humanize(spec.aggColumn);
  else subtitle = t('chart.role_share');

  let body;
  if (error) body = <ChartEmpty label={t('chart.no_data')} />;
  else if (rows === null) body = <ChartSkeleton />;
  else if (rows.length === 0) body = <ChartEmpty label={t('chart.no_data')} />;
  else if (spec.kind === 'donut') {
    body = <DonutChart records={rows} lang={lang} colorOffset={spec.colorOffset} totalLabel={t('chart.total_records')} />;
  } else if (spec.kind === 'timeseries') {
    body = <TimeSeriesChart records={rows} lang={lang} bucket={spec.bucket} categorical={spec.categorical} colorOffset={spec.colorOffset} />;
  } else {
    body = <CategoryBar records={rows} lang={lang} colorOffset={spec.colorOffset} />;
  }

  return (
    <ChartCard title={title} subtitle={subtitle} accent={spec.colorOffset}>
      {body}
    </ChartCard>
  );
}

const KPI_ICON = {
  rows: <DatabaseIcon size={20} />,
  distinct: <SparklesIcon size={20} />,
  avg: <ZapIcon size={20} />,
  span: <CalendarIcon size={20} />,
};

function kpiView(kpi, lang, t) {
  if (kpi.role === 'rows') return { value: fmtInt(kpi.value, lang), label: t('chart.kpi_rows') };
  if (kpi.role === 'distinct') return { value: fmtInt(kpi.value, lang), label: t('chart.kpi_categories'), sub: humanize(kpi.column) };
  if (kpi.role === 'avg') return { value: fmtNum(kpi.value, lang), label: t('chart.kpi_avg'), sub: humanize(kpi.column) };
  return { value: yearOf(kpi.min) + '–' + yearOf(kpi.max), label: t('chart.kpi_span'), sub: humanize(kpi.column) };
}

export default function InsightsDashboard({ resourceId, q, filters, classified, error }) {
  const { t, lang } = useLang();

  const plan = useMemo(() => {
    if (!classified) return null;
    return {
      kpis: buildKpis(classified),
      insights: buildInsights(classified),
      any: hasAnyInsight(classified),
    };
  }, [classified]);

  if (error) {
    return <ChartEmpty label={t('chart.profile_failed')} height={200} />;
  }

  if (!plan) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="cq-skel h-[76px] rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map((i) => <div key={i} className="cq-skel h-[320px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!plan.any) {
    return (
      <div className="cq-card p-10 text-center space-y-2 cq-fade">
        <p className="text-base-content/70">{t('chart.no_insights')}</p>
        <p className="text-sm text-base-content/40">{t('chart.try_custom')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 cq-fade">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {plan.kpis.map((kpi, i) => {
          const v = kpiView(kpi, lang, t);
          return <KpiCard key={kpi.role + i} accent={i} icon={KPI_ICON[kpi.role]} {...v} />;
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {plan.insights.map((spec) => (
          <InsightChart key={spec.key} resourceId={resourceId} q={q} filters={filters} spec={spec} lang={lang} />
        ))}
      </div>
    </div>
  );
}
