import { useLang } from '../../i18n.jsx';
import { KpiCard } from './Visuals.jsx';
import { kpiView } from './theme.js';
import { DatabaseIcon, SparklesIcon, ZapIcon, CalendarIcon } from '../Icons.jsx';

const KPI_ICON = {
  rows: <DatabaseIcon size={20} />,
  distinct: <SparklesIcon size={20} />,
  avg: <ZapIcon size={20} />,
  span: <CalendarIcon size={20} />,
};

export default function KpiRow({ kpis, className = 'grid grid-cols-2 lg:grid-cols-4 gap-3' }) {
  const { t, lang } = useLang();
  return (
    <div className={className}>
      {kpis.map((kpi, i) => {
        const v = kpiView(kpi, lang, t);
        return <KpiCard key={kpi.role + i} accent={i} icon={KPI_ICON[kpi.role]} {...v} />;
      })}
    </div>
  );
}
