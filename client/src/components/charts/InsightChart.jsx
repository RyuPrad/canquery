import { useState, useEffect } from 'react';
import { queryResource } from '../../api/catalog.js';
import { useLang } from '../../i18n.jsx';
import {
  ChartCard, ChartSkeleton, ChartEmpty,
  DonutChart, CategoryBar, TimeSeriesChart,
} from './Visuals.jsx';
import { humanize, cleanRecords } from './theme.js';

// One self-contained insight: fetches its own aggregation (respecting the
// current search + filters) and renders the matching visual. Shared by the
// resource dashboard (framed in a card) and the Insights gallery (framed=false,
// the gallery card is the frame).
export default function InsightChart({ resourceId, q, filters, spec, framed = true, height }) {
  const { t, lang } = useLang();
  const [rows, setRows] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null);

  const filtersKey = JSON.stringify(filters || {});
  const isTime = spec.kind === 'timeseries';

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
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
    }, { signal: controller.signal })
      .then((env) => { if (!cancelled) { setRows(cleanRecords(env.data.records)); setTruncated(env.data.total > env.data.records.length); } })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, q, filtersKey, spec.column, spec.agg, spec.aggColumn, spec.bucket, isTime]);

  let title = humanize(spec.column);
  let subtitle;
  if (spec.role === 'metric_time') { title = humanize(spec.aggColumn); subtitle = t('chart.role_metric_time'); }
  else if (spec.role === 'time') subtitle = t('chart.role_time');
  else if (spec.role === 'measure') subtitle = t('chart.role_sum') + ' ' + humanize(spec.aggColumn);
  else subtitle = t('chart.role_share');

  let body;
  if (error) body = <ChartEmpty label={t('chart.no_data')} height={height} />;
  else if (rows === null) body = <ChartSkeleton height={height} />;
  else if (rows.length === 0) body = <ChartEmpty label={t('chart.no_data')} height={height} />;
  else if (spec.kind === 'donut' && !truncated) {
    body = <DonutChart records={rows} lang={lang} colorOffset={spec.colorOffset} totalLabel={t('chart.total_records')} height={height} />;
  } else if (spec.kind === 'timeseries') {
    body = <TimeSeriesChart records={rows} lang={lang} bucket={spec.bucket} categorical={spec.categorical} colorOffset={spec.colorOffset} height={height} />;
  } else {
    body = <CategoryBar records={rows} lang={lang} colorOffset={spec.colorOffset} height={height} />;
  }

  if (!framed) return <>{body}{truncated && <p className="text-xs text-base-content/60">{t('preparation.limited_groups')}</p>}</>;
  return (
    <ChartCard title={title} subtitle={truncated ? subtitle + ' · ' + t('preparation.limited_groups') : subtitle} accent={spec.colorOffset}>
      {body}
    </ChartCard>
  );
}
