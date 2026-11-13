import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import InsightCarousel from './InsightCarousel.jsx';
import MiniChart from './charts/MiniChart.jsx';
import { chartTitle, chartSubtitle, chartSummary, chartNotes, miniChartOf } from './charts/chartText.js';
import { isInsightCard } from '../utils/chartContract.js';
import { ArrowRightIcon } from './Icons.jsx';

const KINDS = ['donut', 'bars', 'line'];
const getId = card => card.dataset_id;

// Kinds take turns, so the carousel does not show three bar charts in a row.
function alternateKinds(cards) {
  const groups = KINDS.map(kind => cards.filter(card => card.chart.kind === kind));
  const ordered = [];
  const rounds = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < rounds; index += 1) {
    for (const group of groups) {
      if (group[index]) ordered.push(group[index]);
    }
  }
  return ordered;
}

function FeaturedChartCard({ card, active, visible, reduced }) {
  const { t, lang } = useLang();
  const headingId = useId();
  const { chart } = card;
  const title = card.title?.[lang] || card.title?.en || card.title?.fr;
  const mini = miniChartOf(chart, t);
  // The one note a reader of a small card should not miss: a caution first.
  const note = chartNotes(chart, t, lang).find(entry => entry.caution);
  const preparedDate = new Date(card.snapshot_at).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  return <article className="cq-home-chart-card" data-chart-kind={chart.kind} data-dataset-id={card.dataset_id}>
    <header className="cq-home-chart-heading">
      <h3 id={headingId} className="cq-home-chart-title">{chartTitle(chart, t)}</h3>
      <p className="cq-home-chart-grouping">{chartSubtitle(chart, t, lang)}</p>
    </header>
    <figure className="cq-home-chart-figure" aria-labelledby={headingId}>
      <div className="cq-home-chart-stage">
        <MiniChart
          key={card.dataset_id + ':' + active + ':' + visible + ':' + reduced}
          kind={mini.kind}
          points={mini.points}
          context={mini.context}
          animate={active && visible && !reduced}
        />
      </div>
      <figcaption className="sr-only">{chartSummary(chart, t, lang)}</figcaption>
    </figure>
    <p className="cq-home-chart-dataset">{title}</p>
    {note && <p className="cq-home-chart-scope">{note.text}</p>}
    <p className="cq-home-chart-snapshot">{t('home.chart_prepared')} <time dateTime={card.snapshot_at}>{preparedDate}</time> (UTC)</p>
    <Link to={'/insights?focus=' + encodeURIComponent(card.dataset_id)} className="cq-home-chart-link"
      data-analytics-event="dataset_open" data-analytics-dataset-id={card.dataset_id} data-analytics-source="hero_insight">
      {t('home.featured_cta')} <ArrowRightIcon size={14} />
    </Link>
  </article>;
}

// The carousel alone rotates. Each card is a chart the engine chose and
// checked for a card, from the whole prepared table.
export default function HeroChartWidget({ items, className = '' }) {
  const { t } = useLang();
  const ordered = useMemo(() => alternateKinds((items || []).filter(isInsightCard)), [items]);
  if (ordered.length === 0) return null;
  return <div className={className}>
    <InsightCarousel items={ordered} getId={getId} ariaLabel={t('home.insight_title')} showcase
      renderSlide={(card, _index, presentation) => <FeaturedChartCard card={card} {...presentation} />}
    />
  </div>;
}
