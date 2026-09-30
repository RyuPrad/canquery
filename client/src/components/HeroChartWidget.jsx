import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import InsightCarousel from './InsightCarousel.jsx';
import MiniChart from './charts/MiniChart.jsx';
import { fmtBucketKey, fmtInt, fmtNum, humanize } from './charts/theme.js';
import { featuredPeriodTime, selectFeaturedCharts } from '../utils/featuredCharts.js';
import { ArrowRightIcon } from './Icons.jsx';

const KINDS = ['donut', 'bars', 'line'];
const getId = item => item.dataset_id;
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace('{' + key + '}', String(value)), template);

function alternateKinds(items) {
  const groups = KINDS.map(kind => items.filter(item => item.kind === kind));
  const ordered = [];
  const rounds = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < rounds; index += 1) {
    for (const group of groups) {
      if (group[index]) ordered.push(group[index]);
    }
  }
  return ordered;
}

function FeaturedChartCard({ item, active, visible, reduced }) {
  const { t, lang } = useLang();
  const headingId = useId();
  const { context, points } = item;
  const title = item.title?.[lang] || item.title?.en || item.title?.fr;
  const headline = fill(t(context.agg === 'count' ? 'home.chart_records_by' : 'home.chart_average'), {
    field: humanize(context.agg === 'count' ? context.group_by : context.agg_column),
  });
  const grouping = context.agg === 'count' && item.kind !== 'line' ? t('home.chart_count_scope') : fill(t(context.bucket ? 'home.chart_grouped_bucket' : 'home.chart_grouped_by'), {
    field: humanize(context.group_by),
    bucket: context.bucket ? t('home.chart_bucket_' + context.bucket) : '',
  });
  const coverage = fill(t('home.chart_coverage'), {
    shown: fmtInt(context.displayed_groups, lang), total: fmtInt(context.total_groups, lang),
  });
  const summaryPoint = item.kind === 'line' ? points[points.length - 1] : points.reduce((largest, point) => point.value > largest.value ? point : largest);
  const summary = fill(t(context.agg === 'count' ? 'home.chart_summary_count' : 'home.chart_summary_average'), {
    label: summaryPoint.key === null ? t('chart.not_recorded') : summaryPoint.label,
    value: context.agg === 'count' ? fmtInt(summaryPoint.value, lang) : fmtNum(summaryPoint.value, lang),
  });
  const preparedDate = new Date(context.snapshot_at).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  let window = '';
  if (item.kind === 'line') {
    const keys = [...points.map(point => point.key), ...context.missing_periods].sort((a, b) => featuredPeriodTime(a) - featuredPeriodTime(b));
    const periodLabel = key => points.find(point => point.key === key)?.label || (/^\d{4}$/.test(key) ? key : fmtBucketKey(key, context.bucket || 'day', lang));
    window = fill(t('home.chart_latest_window'), { start: periodLabel(keys[0]), end: periodLabel(keys[keys.length - 1]) });
  }

  return <article className="cq-home-chart-card" data-chart-kind={item.kind} data-dataset-id={item.dataset_id}>
    <header className="cq-home-chart-heading">
      <h3 id={headingId} className="cq-home-chart-title">{headline}</h3>
      <p className="cq-home-chart-grouping">{grouping}</p>
    </header>
    <figure className="cq-home-chart-figure" aria-labelledby={headingId}>
      <div className="cq-home-chart-stage">
        <MiniChart
          key={item.dataset_id + ':' + active + ':' + visible + ':' + reduced}
          kind={item.kind}
          points={points}
          context={context}
          animate={active && visible && !reduced}
        />
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
    <p className="cq-home-chart-dataset">{title}</p>
    <p className="cq-home-chart-coverage">{coverage}</p>
    {window && <p className="cq-home-chart-scope">{window}</p>}
    {context.missing_periods.length > 0 && <p className="cq-home-chart-scope">
      {fill(t(context.missing_periods.length === 1 ? 'home.chart_missing_period_one' : 'home.chart_missing_periods'), { count: fmtInt(context.missing_periods.length, lang) })}
    </p>}
    <p className="cq-home-chart-snapshot">{t('home.chart_prepared')} <time dateTime={context.snapshot_at}>{preparedDate}</time> (UTC)</p>
    <Link to={'/insights?focus=' + encodeURIComponent(item.dataset_id)} className="cq-home-chart-link"
      data-analytics-event="dataset_open" data-analytics-dataset-id={item.dataset_id} data-analytics-source="hero_insight">
      {t('home.featured_cta')} <ArrowRightIcon size={14} />
    </Link>
  </article>;
}

// The carousel alone rotates. Each card explains a validated snapshot preview.
export default function HeroChartWidget({ items, className = '' }) {
  const { t } = useLang();
  const ordered = useMemo(() => alternateKinds(selectFeaturedCharts(items)), [items]);
  if (ordered.length === 0) return null;
  return <div className={className}>
    <InsightCarousel items={ordered} getId={getId} ariaLabel={t('home.insight_title')} showcase
      renderSlide={(item, _index, presentation) => <FeaturedChartCard item={item} {...presentation} />}
    />
  </div>;
}
