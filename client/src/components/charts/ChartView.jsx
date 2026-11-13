import { useLang } from '../../i18n.jsx';
import { ChartCard, DonutChart, CategoryBar, TimeSeriesChart } from './Visuals.jsx';
import ChartNotes from './ChartNotes.jsx';
import { chartTitle, chartSubtitle, chartRecords, chartRows, chartSummary, pointLabel } from './chartText.js';
import { fmtNum, fmtPeriod } from './theme.js';

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])));

// One chart from the chart engine, drawn as it came: the engine has already
// chosen the groups, the periods and the kind, and says what it left out. A
// figure with a sentence for screen readers and the values as a table.
export default function ChartView({ chart, height = 260, accent, framed = true }) {
  const { t, lang } = useLang();
  const records = chartRecords(chart, t, lang);

  let visual;
  if (chart.kind === 'donut') {
    visual = <DonutChart records={records} lang={lang} colorOffset={accent} height={height}
      totalLabel={chart.y.agg === 'count' ? t('chart.total_records') : t('chart.total')} />;
  } else if (chart.kind === 'line') {
    visual = <TimeSeriesChart records={records} lang={lang} categorical gaps colorOffset={accent} height={height} />;
  } else {
    visual = <CategoryBar records={records} lang={lang} colorOffset={accent} height={height} />;
  }

  const shares = chart.points.some((point) => typeof point.share === 'number');
  const body = (
    <figure className="space-y-2 m-0">
      <figcaption className="sr-only">{chartSummary(chart, t, lang)}</figcaption>
      {visual}
      {chart.other && (
        <p className="text-xs text-base-content/60">
          {fill(t('chart.other_groups'), { groups: fmtNum(chart.other.groups, lang) })}: {fmtNum(chart.other.value, lang)}
        </p>
      )}
      <ChartNotes chart={chart} />
      <details className="text-xs text-base-content/60">
        <summary className="cursor-pointer select-none">{t('chart.values_title')}</summary>
        <div className="cq-table-wrap mt-1 max-h-64 overflow-auto">
          <table className="cq-table">
            <thead>
              <tr>
                <th scope="col">{chart.x.type === 'time' ? t('chart.period') : t('chart.category')}</th>
                <th scope="col">{chart.y.agg === 'count' ? t('chart.records') : t('chart.value')}</th>
                {shares && <th scope="col">{t('chart.percent')}</th>}
              </tr>
            </thead>
            <tbody>
              {chartRows(chart).map(({ point, start }, index) => (
                <tr key={index}>
                  <td>{point ? pointLabel(point, chart, t, lang) : fmtPeriod(start, chart.x.grain, lang)}</td>
                  <td className="tabular-nums">{point ? fmtNum(point.value, lang) : t('chart.no_number')}</td>
                  {shares && <td className="tabular-nums">{point && typeof point.share === 'number' ? fmtNum(point.share * 100, lang) + ' %' : ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
  if (!framed) return body;
  return (
    <ChartCard title={chartTitle(chart, t)} subtitle={chartSubtitle(chart, t, lang)} accent={accent}>
      {body}
    </ChartCard>
  );
}
