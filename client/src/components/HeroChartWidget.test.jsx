import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LangProvider } from '../i18n.jsx';
import HeroChartWidget from './HeroChartWidget.jsx';

const carousel = vi.hoisted(() => ({ activeIndex: 0, visible: true, reduced: true }));
vi.mock('./InsightCarousel.jsx', () => ({
  default: ({ items, renderSlide, ariaLabel, showcase }) => <div role="region" aria-label={ariaLabel} data-showcase={showcase}>
    {items.map((item, index) => <div key={item.dataset_id}>{renderSlide(item, index, { active: index === carousel.activeIndex, visible: carousel.visible, reduced: carousel.reduced })}</div>)}
  </div>,
}));
vi.mock('./charts/MiniChart.jsx', () => ({
  default: ({ kind, points, context, animate }) => <svg aria-hidden="true" data-testid={'chart-' + context.resource_id}
    data-kind={kind} data-points={JSON.stringify(points)} data-context={JSON.stringify(context)} data-animate={animate} />,
}));

const context = (id, overrides = {}) => ({
  resource_id: 'resource-' + id, group_by: 'status', agg: 'count', agg_column: null, bucket: null, group_type: 'TEXT',
  snapshot_at: '2026-09-29T23:30:00.000Z', snapshot_rows: 4, total_groups: 2, displayed_groups: 2, limited: false, missing_periods: [],
  ...overrides,
});
const donut = { dataset_id: 'd1', kind: 'donut', title: { en: 'Publisher distribution dataset' },
  points: [{ key: 'A', label: 'Long recorded category A', value: 3 }, { key: 'B', label: 'Category B', value: 1 }], context: context('d1') };
const bars = { dataset_id: 'b1', kind: 'bars', title: { en: 'Publisher departmental dataset' },
  points: [{ key: 'D1', label: 'Full department name', value: 7 }, { key: 'D2', label: 'Another department', value: 3 }],
  context: context('b1', { group_by: 'department', snapshot_rows: 50, total_groups: 6, limited: true }) };
const line = { dataset_id: 'l1', kind: 'line', title: { en: 'Publisher observations dataset' },
  points: [{ key: '2015', label: '2015', value: -2.5 }, { key: '2026', label: '2026', value: 1.75 }],
  context: context('l1', { group_by: 'year', agg: 'avg', agg_column: 'temperature_departure', snapshot_rows: 80 }) };
const items = [bars, donut, line];
const wrapper = (props = {}) => <MemoryRouter><HeroChartWidget items={items} {...props} /></MemoryRouter>;
const chartFor = id => screen.getByTestId('chart-resource-' + id);

beforeEach(() => {
  carousel.activeIndex = 0;
  carousel.visible = true;
  carousel.reduced = true;
  localStorage.clear();
});

describe('contextual featured chart cards', () => {
  test('alternates real admitted chart kinds while preserving their points and recorded context', () => {
    const original = JSON.stringify(items);
    render(wrapper());
    expect(screen.getByRole('region')).toHaveAttribute('data-showcase', 'true');
    expect(screen.getAllByRole('article').map(card => card.getAttribute('data-dataset-id'))).toEqual(['d1', 'b1', 'l1']);
    for (const item of items) {
      expect(JSON.parse(chartFor(item.dataset_id).getAttribute('data-points'))).toEqual(item.points);
      expect(JSON.parse(chartFor(item.dataset_id).getAttribute('data-context'))).toEqual(item.context);
      expect(chartFor(item.dataset_id)).toHaveAttribute('data-kind', item.kind);
    }
    expect(JSON.stringify(items)).toBe(original);
  });

  test('names the actual measure above the plot and keeps the publisher title below it', () => {
    render(wrapper());
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map(heading => heading.textContent)).toEqual(['Records by Status', 'Records by Department', 'Average Temperature departure']);
    const figures = screen.getAllByRole('figure');
    for (let index = 0; index < figures.length; index += 1) {
      expect(figures[index]).toHaveAttribute('aria-labelledby', headings[index].id);
      expect(headings[index].compareDocumentPosition(figures[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const title = screen.getByText('Publisher observations dataset');
    expect(title.tagName).toBe('P');
    expect(title).toHaveClass('cq-home-chart-dataset');
    expect(screen.getAllByText('Record counts from the prepared file')).toHaveLength(2);
    expect(screen.queryByText('Grouped by Status')).not.toBeInTheDocument();
    expect(screen.getByText('Grouped by Year')).toBeInTheDocument();
    expect(screen.getByText('2026: average 1.75.')).toBeInTheDocument();
    expect(screen.queryByText(/CAD|°C|dollars/)).not.toBeInTheDocument();
  });

  test('retains full publisher and category text without overriding readable values with an aria label', () => {
    const longTitle = 'Complete publisher title with all of its original dataset context and a reference period that remains visible on narrow screens';
    const longLabel = 'Complete category label with regional qualifiers and a full administrative designation';
    render(wrapper({ items: [{ ...donut, title: { en: longTitle }, points: [{ ...donut.points[0], label: longLabel }, donut.points[1]] }] }));
    const card = screen.getByRole('article');
    expect(card).not.toHaveAttribute('aria-label');
    expect(screen.getByText(longTitle)).not.toHaveClass('line-clamp-2', 'truncate');
    expect(screen.getByText(longLabel + ': 3 records.')).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Explore insights' });
    expect(link).not.toHaveAttribute('aria-label');
    expect(card.tagName).toBe('ARTICLE');
  });

  test('reports exact group coverage and the actual prepared snapshot date', () => {
    render(wrapper({ items: [{ ...bars, context: { ...bars.context, snapshot_at: '2020-01-02T01:00:00.000Z' } }] }));
    expect(screen.getByText('Showing 2 of 6 groups')).toBeInTheDocument();
    const snapshot = document.querySelector('.cq-home-chart-snapshot');
    expect(snapshot).toHaveTextContent('Prepared');
    expect(snapshot).toHaveTextContent('2020');
    expect(snapshot).toHaveTextContent('(UTC)');
    expect(snapshot.querySelector('time')).toHaveAttribute('datetime', '2020-01-02T01:00:00.000Z');
    expect(screen.getByText('Full department name: 7 records.')).toBeInTheDocument();
  });

  test('describes the selected temporal window and limits missing-value claims to that window', () => {
    const temporal = { ...line, context: { ...line.context, total_groups: 8, limited: true, missing_periods: ['2020'] } };
    render(wrapper({ items: [temporal] }));
    expect(screen.getByText('Showing 2 of 8 groups')).toBeInTheDocument();
    expect(screen.getByText('Latest time window: 2015–2026')).toBeInTheDocument();
    expect(screen.getByText('1 period in this window has no numeric value; it is left unconnected.')).toBeInTheDocument();
    expect(JSON.parse(chartFor('l1').getAttribute('data-context')).missing_periods).toEqual(['2020']);
  });

  test('uses the actual date bucket and includes a missing latest boundary in the window', () => {
    const temporal = { ...line, points: [
      { key: '2026-01-01T00:00:00.000Z', label: 'Jan 2026', value: -2 },
      { key: '2026-03-01T00:00:00.000Z', label: 'Mar 2026', value: 0 },
    ], context: { ...line.context, group_by: 'observation_date', group_type: 'DATE', bucket: 'month',
      total_groups: 4, limited: true, missing_periods: ['2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'] } };
    render(wrapper({ items: [temporal] }));
    expect(screen.getByText('Monthly groups of Observation date')).toBeInTheDocument();
    expect(screen.getByText(/Latest time window: Jan 2026–Apr/)).toHaveTextContent('2026');
    expect(screen.getByText('2 periods in this window have no numeric value; they are left unconnected.')).toBeInTheDocument();
    expect(screen.getByText('Mar 2026: average 0.')).toBeInTheDocument();
  });

  test('attaches deep-link and analytics only to the separate exploration action', () => {
    render(wrapper());
    for (const item of items) {
      const card = document.querySelector('[data-dataset-id="' + item.dataset_id + '"]');
      expect(card).not.toHaveAttribute('data-analytics-event');
      const link = within(card).getByRole('link', { name: 'Explore insights' });
      expect(link).toHaveAttribute('href', '/insights?focus=' + item.dataset_id);
      expect(link).toHaveAttribute('data-analytics-event', 'dataset_open');
      expect(link).toHaveAttribute('data-analytics-dataset-id', item.dataset_id);
      expect(link).toHaveAttribute('data-analytics-source', 'hero_insight');
    }
  });

  test('encodes the focused dataset identity', () => {
    render(wrapper({ items: [{ ...donut, dataset_id: 'dataset / bilingual' }] }));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/insights?focus=dataset%20%2F%20bilingual');
  });

  test('omits unsupported, old, malformed and flat candidates while preserving supported source order', () => {
    const invalid = [{ ...bars, kind: 'area' }, { ...bars, context: undefined },
      { ...bars, points: [{ key: 'a', label: 'a', value: 3 }, { key: 'b', label: 'b', value: 3 }] }];
    const secondDonut = { ...donut, dataset_id: 'd2' };
    const secondBars = { ...bars, dataset_id: 'b2' };
    render(wrapper({ items: [bars, ...invalid, secondBars, donut, line, secondDonut] }));
    expect(screen.getAllByRole('article').map(card => card.getAttribute('data-dataset-id'))).toEqual(['d1', 'b1', 'l1', 'd2', 'b2']);
  });

  test('renders no carousel for empty or metadata-poor responses', () => {
    const view = render(wrapper({ items: [] }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.rerender(wrapper({ items: [{ dataset_id: 'old', title: { en: 'Old preview' }, kind: 'donut', points: donut.points }] }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.rerender(wrapper({ items: [bars] }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Records by Department')).toBeInTheDocument();
  });

  test('translates context and preserves bilingual or available publisher titles', () => {
    localStorage.setItem('cq-lang', 'fr');
    render(<MemoryRouter><LangProvider><HeroChartWidget items={[
      { ...bars, title: { en: 'English title', fr: 'Titre français' } },
      { ...donut, title: { en: 'English fallback' } },
      { ...line, title: { fr: 'Titre disponible' } },
    ]} /></LangProvider></MemoryRouter>);
    expect(screen.getByText('Titre français')).toBeInTheDocument();
    expect(screen.getByText('English fallback')).toBeInTheDocument();
    expect(screen.getByText('Titre disponible')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enregistrements par Status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Moyenne de Temperature departure' })).toBeInTheDocument();
    expect(screen.getByText('2 groupes affichés sur 6')).toBeInTheDocument();
    expect(screen.getByText('2026 : moyenne de 1,75.')).toBeInTheDocument();
    expect(screen.getAllByText('Explorer les aperçus')).toHaveLength(3);
    expect(document.querySelector('.cq-home-chart-snapshot')).toHaveTextContent('Préparé le');
  });

  test('animates only the active visible page and remounts the drawing chart on page entry', () => {
    carousel.reduced = false;
    const view = render(wrapper());
    const first = chartFor('d1');
    const next = chartFor('b1');
    expect(first).toHaveAttribute('data-animate', 'true');
    expect(next).toHaveAttribute('data-animate', 'false');
    carousel.activeIndex = 1;
    view.rerender(wrapper());
    expect(chartFor('b1')).not.toBe(next);
    expect(chartFor('b1')).toHaveAttribute('data-animate', 'true');
    expect(chartFor('d1')).not.toBe(first);
    expect(chartFor('d1')).toHaveAttribute('data-animate', 'false');
  });

  test('settles invisible or reduced-motion previews and creates no local rotation timer', () => {
    vi.useFakeTimers();
    try {
      carousel.reduced = false;
      carousel.visible = false;
      const view = render(wrapper());
      expect(chartFor('d1')).toHaveAttribute('data-animate', 'false');
      carousel.visible = true;
      view.rerender(wrapper());
      expect(chartFor('d1')).toHaveAttribute('data-animate', 'true');
      carousel.reduced = true;
      view.rerender(wrapper());
      expect(chartFor('d1')).toHaveAttribute('data-animate', 'false');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
