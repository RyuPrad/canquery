import { useMemo } from 'react';
import { useLang } from '../i18n.jsx';
import { buildInsights, buildKpis, hasAnyInsight } from './charts/classify.js';
import { ChartEmpty } from './charts/Visuals.jsx';
import InsightChart from './charts/InsightChart.jsx';
import KpiRow from './charts/KpiRow.jsx';

export default function InsightsDashboard({ resourceId, q, filters, classified, error }) {
  const { t } = useLang();

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
      <KpiRow kpis={plan.kpis} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {plan.insights.map((spec) => (
          <InsightChart key={spec.key} resourceId={resourceId} q={q} filters={filters} spec={spec} />
        ))}
      </div>
    </div>
  );
}
