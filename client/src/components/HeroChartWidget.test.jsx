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
  default: ({ kind, points, context, animate }) => <svg aria-hidden="true" data-testid="mini-chart"
    data-kind={kind} data-points={JSON.stringify(points)} data-context={JSON.stringify(context)} data-animate={animate} />,
}));

// Engine charts as GET /web-api/v1/insights/charts carries them.
const chart = (overrides = {}) => ({
  id: 'c_000000000000', template: 'records_by_category', kind: 'donut',
  x: { type: 'category', column: 'status', label: 'status' },
  y: { agg: 'count', column: null, label: null, additive: 'yes', integer: true, lower_bound: false, unit: null, percent: false, currency: false },
  points: [{ key: 'a', label: 'Long recorded category A', value: 3, rows: 3, share: 0.75 }, { key: 'b', label: 'Category B', value: 1, rows: 1, share: 0.25 }],
  other: null, total: 4,
  scope: { rows: 4, groups_total: 2, groups_shown: 2, complete: true, filtered: false },
  notes: [], score: 50, fit: { tab: true, card: true, social: true },
  ...overrides,
});
const card = (id, title, chartOverrides, extra = {}) => ({ dataset_id: id, title: { en: title }, resource_id: 'resource-' + id,
  snapshot_at: '2026-09-29T23:30:00.000Z', rows: 100, kpis: [], chart: chart(chartOverrides), ...extra });

const donut = card('d1', 'Publisher distribution dataset');
const bars = card('b1', 'Publisher departmental dataset', { id: 'c_111111111111', template: 'share_by_category', kind: 'bars',
  x: { type: 'category', column: 'department', label: 'department' },
  y: { agg: 'sum', column: 'amount', label: 'amount', additive: 'yes', integer: true, lower_bound: true, unit: null, percent: false, currency: false },
  points: [{ key: 'd1', label: 'Full department name', value: 7, rows: 3 }, { key: 'd2', label: 'Another department', value: 3, rows: 2 }],
  other: { groups: 4, value: 5 }, total: 15, scope: { rows: 50, groups_total: 6, groups_shown: 2, complete: false, filtered: false },
  notes: [{ code: 'placeholders_left_out', level: 'caution', column: 'amount', cells: 12, share: 0.24, tokens: ['--'] }] });
const line = card('l1', 'Publisher observations dataset', { id: 'c_222222222222', template: 'measure_over_time', kind: 'line',
  x: { type: 'time', axis: 't:year', columns: ['year'], label: 'year', grain: 'year' },
  y: { agg: 'avg', column: 'temperature_departure', label: 'temperature_departure', additive: 'no', integer: false, lower_bound: false, unit: null, percent: false, currency: false },
  points: [{ key: '2015', start: '2015-01-01', value: -2.5, rows: 4 }, { key: '2026', start: '2026-01-01', value: 1.75, rows: 4 }],
  total: null, time: { grain: 'year', first: '2015-01-01', last: '2026-01-01', periods_total: 3, periods_shown: 3, missing: ['2020-01-01'] },
  scope: { rows: 80, groups_total: 3, groups_shown: 2, complete: true, filtered: false },
  notes: [{ code: 'missing_periods', level: 'info', periods: 1 }] });
const items = [bars, donut, line];
const wrapper = (props = {}) => <MemoryRouter><HeroChartWidget items={items} {...props} /></MemoryRouter>;
const chartFor = id => within(document.querySelector('[data-dataset-id="' + id + '"]')).getByTestId('mini-chart');

beforeEach(() => {
  carousel.activeIndex = 0;
  carousel.visible = true;
  carousel.reduced = true;
  localStorage.clear();
});

describe('chart cards on the homepage', () => {
  test('alternate chart kinds and hand each small chart the engine\'s points, periods by their first day', () => {
    const original = JSON.stringify(items);
    render(wrapper());
    expect(screen.getByRole('region')).toHaveAttribute('data-showcase', 'true');
    expect(screen.getAllByRole('article').map(article => article.getAttribute('data-dataset-id'))).toEqual(['d1', 'b1', 'l1']);
    expect(JSON.parse(chartFor('d1').getAttribute('data-points'))).toEqual([{ key: 'Long recorded category A', label: 'Long recorded category A', value: 3 },
      { key: 'Category B', label: 'Category B', value: 1 }]);
    expect(JSON.parse(chartFor('d1').getAttribute('data-context'))).toEqual({ agg: 'count', limited: false, grain: null, missing_periods: [], totalLabel: null });
    expect(JSON.parse(chartFor('b1').getAttribute('data-context'))).toMatchObject({ agg: 'avg', limited: true, totalLabel: 'amount' });
    expect(JSON.parse(chartFor('l1').getAttribute('data-points')).map(point => point.key)).toEqual(['2015-01-01', '2026-01-01']);
    expect(JSON.parse(chartFor('l1').getAttribute('data-context'))).toMatchObject({ grain: 'year', missing_periods: ['2020-01-01'] });
    expect(chartFor('l1')).toHaveAttribute('data-kind', 'line');
    expect(JSON.stringify(items)).toBe(original);
  });

  test('name the measure above the plot, say how much is shown, and keep the publisher title below', () => {
    render(wrapper());
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map(heading => heading.textContent)).toEqual(['Records by Status', 'Amount by Department', 'Average Temperature departure over time']);
    const figures = screen.getAllByRole('figure');
    for (let index = 0; index < figures.length; index += 1) {
      expect(figures[index]).toHaveAttribute('aria-labelledby', headings[index].id);
      expect(headings[index].compareDocumentPosition(figures[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText('2 groups')).toBeInTheDocument();
    expect(screen.getByText('Largest 2 of 6 groups · At least: some cells hold no number')).toBeInTheDocument();
    expect(screen.getByText('2015 – 2026')).toBeInTheDocument();
    const title = screen.getByText('Publisher observations dataset');
    expect(title.tagName).toBe('P');
    expect(title).toHaveClass('cq-home-chart-dataset');
    // What a reader of a small card should not miss.
    expect(screen.getByText('12 cells hold “--” instead of a number and are left out.')).toBeInTheDocument();
    // A sentence for readers who cannot see the chart.
    expect(screen.getByText('2 groups. Largest: Long recorded category A, 3.')).toBeInTheDocument();
    expect(screen.getByText('2 periods, 2015 to 2026. Latest: 1.75.')).toBeInTheDocument();
  });

  test('show the prepared snapshot date and keep long text whole', () => {
    const longTitle = 'Complete publisher title with all of its original dataset context and a reference period that remains visible on narrow screens';
    render(wrapper({ items: [{ ...donut, title: { en: longTitle }, snapshot_at: '2020-01-02T01:00:00.000Z' }] }));
    const article = screen.getByRole('article');
    expect(article).not.toHaveAttribute('aria-label');
    expect(screen.getByText(longTitle)).not.toHaveClass('line-clamp-2', 'truncate');
    const snapshot = document.querySelector('.cq-home-chart-snapshot');
    expect(snapshot).toHaveTextContent('Prepared');
    expect(snapshot).toHaveTextContent('(UTC)');
    expect(snapshot.querySelector('time')).toHaveAttribute('datetime', '2020-01-02T01:00:00.000Z');
  });

  test('attach the deep link and analytics only to the exploration action, with the dataset identity encoded', () => {
    const view = render(wrapper());
    for (const item of items) {
      const article = document.querySelector('[data-dataset-id="' + item.dataset_id + '"]');
      expect(article).not.toHaveAttribute('data-analytics-event');
      const link = within(article).getByRole('link', { name: 'Explore insights' });
      expect(link).toHaveAttribute('href', '/insights?focus=' + item.dataset_id);
      expect(link).toHaveAttribute('data-analytics-event', 'dataset_open');
      expect(link).toHaveAttribute('data-analytics-dataset-id', item.dataset_id);
      expect(link).toHaveAttribute('data-analytics-source', 'hero_insight');
    }
    view.rerender(wrapper({ items: [{ ...donut, dataset_id: 'dataset / bilingual' }] }));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/insights?focus=dataset%20%2F%20bilingual');
  });

  test('drop cards that do not hold together and keep the order of the rest', () => {
    const broken = [{ ...bars, dataset_id: 'x1', chart: { ...bars.chart, kind: 'area' } }, { ...bars, dataset_id: 'x2', chart: undefined },
      { ...bars, dataset_id: 'x3', chart: { ...bars.chart, points: [] } }, { ...bars, dataset_id: 'x4', snapshot_at: 'soon' }];
    const secondDonut = { ...donut, dataset_id: 'd2' };
    const secondBars = { ...bars, dataset_id: 'b2' };
    const view = render(wrapper({ items: [bars, ...broken, secondBars, donut, line, secondDonut] }));
    expect(screen.getAllByRole('article').map(article => article.getAttribute('data-dataset-id'))).toEqual(['d1', 'b1', 'l1', 'd2', 'b2']);
    view.rerender(wrapper({ items: [] }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.rerender(wrapper({ items: broken }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  test('speak the reader\'s language and fall back to any title there is', () => {
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
    expect(screen.getByRole('heading', { name: 'Temperature departure : moyenne dans le temps' })).toBeInTheDocument();
    expect(screen.getAllByText('Explorer les aperçus')).toHaveLength(3);
    expect(document.querySelector('.cq-home-chart-snapshot')).toHaveTextContent('Préparé le');
  });

  test('animate only the active visible page and remount the drawing chart on page entry', () => {
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

  test('settle invisible or reduced-motion cards and create no local rotation timer', () => {
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
