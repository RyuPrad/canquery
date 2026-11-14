import { useLang } from '../../i18n.jsx';
import { columnReading, skipReason, specTitle } from './chartText.js';
import { fmtInt, humanize } from './theme.js';

// "How CanQuery read this table": what each column was taken for and why
// some charts were set aside. Closed by default; for readers who want to
// check the charts against the table.
export default function TableReadout({ model, skipped = [] }) {
  const { t, lang } = useLang();
  if (!model || !Array.isArray(model.columns) || !model.columns.length) return null;
  const sample = model.sample || {};
  const intro = sample.complete
    ? t('chart.readout_intro_whole')
    : t('chart.readout_intro').replace('{rows}', fmtInt(sample.rows, lang));
  const shown = skipped.filter((skip) => skip && skip.reason !== 'not_tried').slice(0, 12);
  return (
    <details className="cq-card p-4 text-sm">
      <summary className="cursor-pointer select-none font-semibold">{t('chart.readout_title')}</summary>
      <p className="text-xs text-base-content/60 mt-2">{intro}</p>
      <div className="cq-table-wrap mt-2 max-h-96 overflow-auto">
        <table className="cq-table text-xs">
          <thead>
            <tr>
              <th scope="col">{t('chart.readout_column')}</th>
              <th scope="col">{t('chart.readout_role')}</th>
              <th scope="col">{t('chart.readout_detail')}</th>
            </tr>
          </thead>
          <tbody>
            {model.columns.map((column) => {
              const reading = columnReading(column, t);
              return (
                <tr key={column.id}>
                  <td className="break-words max-w-[16rem]">{humanize(column.label || column.id)}</td>
                  <td>{reading.role}</td>
                  <td className="text-base-content/60">{reading.details.join(' · ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold">{t('chart.skipped_title')}</p>
          <ul className="text-xs text-base-content/60 list-disc pl-4 mt-1 space-y-0.5">
            {shown.map((skip) => (
              <li key={skip.id}>{specTitle(skip, model, t)}: {skipReason(skip.reason, t)}</li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
