import { useLang } from '../i18n.jsx';
import { ChartEmpty, KpiCard } from './charts/Visuals.jsx';
import ChartView from './charts/ChartView.jsx';
import TableReadout from './charts/TableReadout.jsx';
import { kpiText, blockedText } from './charts/chartText.js';
import { fmtInt } from './charts/theme.js';
import { DatabaseIcon, SparklesIcon, ZapIcon, CalendarIcon } from './Icons.jsx';

const KPI_ICON = {
  rows: <DatabaseIcon size={20} />,
  groups: <SparklesIcon size={20} />,
  sum: <ZapIcon size={20} />,
  avg: <ZapIcon size={20} />,
  span: <CalendarIcon size={20} />,
};

// Errors the chart engine asks to retry, in words.
function errorText(error, t) {
  const code = error?.body?.code;
  if (code === 'CHARTS_BUSY' || error?.status === 429) return t('chart.busy');
  if (code === 'CHARTS_TIMEOUT') return t('chart.timeout');
  return t('chart.profile_failed');
}

// A measure that holds different things in each value of a column: the page
// offers those values as filters, after which the measure is charted.
function BlockedMeasures({ blocked, onPin }) {
  const { t, lang } = useLang();
  if (!blocked.length) return null;
  return (
    <div className="cq-card p-4 space-y-3">
      <p className="font-semibold text-sm">{t('chart.blocked_title')}</p>
      {blocked.slice(0, 3).map((block) => (
        <div key={(block.measure || '*') + '|' + block.column} className="space-y-1.5">
          <p className="text-xs text-base-content/70">{blockedText(block, t)}</p>
          {block.values.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {block.values.map((entry) => (
                <li key={entry.value}>
                  {onPin ? (
                    <button type="button" className="btn btn-xs btn-outline normal-case font-normal"
                      onClick={() => onPin(block.column, entry.value)}>
                      {entry.label ?? entry.value} <span className="text-base-content/50 tabular-nums">{fmtInt(entry.rows, lang)}</span>
                    </button>
                  ) : (
                    <span className="badge badge-ghost">{entry.label ?? entry.value}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// The Chart tab's automatic view: the figures, the charts the engine chose,
// and how it read the table. Everything comes from one answer of the chart
// engine; while the visitor searches or filters, the same charts are redrawn.
export default function InsightsDashboard({ data, loading, error, onPin, onRetry }) {
  const { t, lang } = useLang();

  if (error && !data) {
    return (
      <div className="cq-card p-8 text-center space-y-3">
        <p className="text-base-content/70">{errorText(error, t)}</p>
        {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>{t('chart.retry')}</button>}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="cq-skel h-[76px] rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map((i) => <div key={i} className="cq-skel h-[320px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  const kpis = data.kpis.map((kpi) => ({ kpi, view: kpiText(kpi, t, lang) })).filter((entry) => entry.view);
  const filtered = Boolean(data.scope && data.scope.filtered);
  return (
    <div className={'space-y-4 cq-fade' + (loading ? ' opacity-60 transition-opacity' : '')} aria-busy={loading ? 'true' : undefined}>
      {error && (
        <div className="alert alert-warning text-sm flex justify-between">
          <span>{errorText(error, t)}</span>
          {onRetry && <button type="button" className="btn btn-xs" onClick={onRetry}>{t('chart.retry')}</button>}
        </div>
      )}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map(({ kpi, view }, i) => (
            <KpiCard key={kpi.role + i} accent={i} icon={KPI_ICON[kpi.role]} value={view.value} label={view.label} sub={view.sub} />
          ))}
        </div>
      )}
      <BlockedMeasures blocked={data.blocked} onPin={onPin} />
      {data.charts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.charts.map((chart, i) => <ChartView key={chart.id} chart={chart} accent={i} height={280} />)}
        </div>
      ) : (
        <div className="cq-card p-8 text-center space-y-2">
          <ChartEmpty label={t(filtered ? 'chart.no_charts_filtered' : data.model && data.model.shape === 'dictionary' ? 'chart.dictionary' : 'chart.no_charts')}
            height={60} />
          <p className="text-sm text-base-content/40">{t('chart.try_custom')}</p>
        </div>
      )}
      <TableReadout model={data.model} skipped={data.skipped} />
    </div>
  );
}
