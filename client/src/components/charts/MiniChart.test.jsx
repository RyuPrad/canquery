import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import MiniChart from './MiniChart.jsx';
import { LangProvider } from '../../i18n.jsx';
import { chartSummary } from './theme.js';

const points = [{ key: 'A', label: 'A complete category name', value: 5 }, { key: 'B', label: 'B', value: 3 }, { key: 'C', label: 'C', value: 2 }];
const count = { agg: 'count', limited: false, missing_periods: [] };
const yearly = [{ key: '2020', label: '2020', value: 5 }, { key: '2021', label: '2021', value: 7 }, { key: '2025', label: '2025', value: 3 }];
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('MiniChart', () => {
  test('horizontal bars expose full labels, count values and proportional lengths in one accent', () => {
    const { container } = render(<MiniChart kind="bars" points={points} context={count} animate={false} />);
    const rows = container.querySelectorAll('.cq-chart-bar-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('A complete category name')).toBeInTheDocument();
    expect(within(rows[0]).getByText('5')).toBeInTheDocument();
    expect(rows[0].querySelector('.cq-chart-bar-fill')).toHaveStyle({ width: '100%', transform: 'scaleX(1)' });
    expect(rows[1].querySelector('.cq-chart-bar-fill')).toHaveStyle({ width: '60%' });
    expect(container.querySelector('svg')).toBeNull();
  });

  test('signed bars extend on opposite sides of zero and a zero has no fabricated length', () => {
    const signed = [{ key: 'n', label: 'Negative', value: -5 }, { key: 'z', label: 'Zero', value: 0 }, { key: 'p', label: 'Positive', value: 10 }];
    const { container } = render(<MiniChart kind="bars" points={signed} context={{ agg: 'avg' }} animate={false} />);
    const fills = container.querySelectorAll('.cq-chart-bar-fill');
    expect(fills[0]).toHaveStyle({ left: '0%', transformOrigin: 'right' });
    expect(parseFloat(fills[0].style.width)).toBeCloseTo(100 / 3);
    expect(parseFloat(fills[2].style.left)).toBeCloseTo(100 / 3);
    expect(fills[1]).toHaveStyle({ width: '0%' });
    expect(container.querySelectorAll('.cq-chart-zero')).toHaveLength(3);
    expect(within(container.querySelector('.cq-chart-bar-row')).getByText('-5')).toBeInTheDocument();
  });

  test('fractional and tiny nonzero measures retain visible precision', () => {
    render(<MiniChart kind="bars" points={[{ key: 'a', label: 'Tiny', value: 0.0001 }, { key: 'b', label: 'Fraction', value: 1.25 }]} context={{ agg: 'avg' }} animate={false} />);
    expect(screen.getByText('1E-4')).toBeInTheDocument();
    expect(screen.getAllByText('1.25').length).toBeGreaterThan(0);
  });

  test('a donut explains all categories with counts, shares and a computed total', () => {
    const { container } = render(<MiniChart kind="donut" points={points} context={count} animate={false} />);
    const legend = screen.getByRole('list', { name: 'Categories and values' });
    expect(within(legend).getAllByRole('listitem')).toHaveLength(3);
    expect(within(legend).getByText('A complete category name')).toBeInTheDocument();
    expect(within(legend).getByText('50%')).toBeInTheDocument();
    expect(container.querySelector('.cq-chart-ring-total')).toHaveTextContent('10');
    expect(container.querySelector('.cq-chart-ring-unit')).toHaveTextContent('Records');
  });

  test('incomplete, oversized and signed distributions do not render a misleading donut', () => {
    const { container, rerender } = render(<MiniChart kind="donut" points={points} context={{ ...count, limited: true }} animate={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MiniChart kind="donut" points={[...points, { key: 'd', label: 'Negative', value: -1 }]} context={count} animate={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MiniChart kind="donut" points={Array.from({ length: 7 }, (_, i) => ({ key: String(i), label: String(i), value: i + 1 }))} context={count} animate={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('small nonzero shares do not display as zero percent', () => {
    render(<MiniChart kind="donut" points={[{ key: 'a', label: 'Small', value: 1 }, { key: 'b', label: 'Large', value: 1000000 }]} context={count} animate={false} />);
    expect(within(screen.getByRole('list', { name: 'Categories and values' })).getByText('1E-4%')).toBeInTheDocument();
  });

  test('lines use elapsed time, labelled axes and the actual latest value', () => {
    const { container } = render(<MiniChart kind="line" points={yearly} context={{ agg: 'avg', bucket: null, missing_periods: [] }} animate={false} />);
    const dots = container.querySelectorAll('.cq-chart-line-point');
    const positions = [...dots].map(dot => Number(dot.getAttribute('cx')));
    expect((positions[1] - positions[0]) / (positions[2] - positions[0])).toBeCloseTo(0.2, 2);
    expect(container.querySelectorAll('.cq-chart-time-tick')).toHaveLength(2);
    expect(container.querySelectorAll('.cq-chart-grid')).toHaveLength(3);
    expect(container.querySelector('.cq-chart-line-current')).toHaveTextContent('3');
    expect(container.querySelector('.cq-chart-line-current')).toHaveTextContent('2025');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  });

  test('explicit missing periods break the line and are labelled without plotting a zero', () => {
    const { container } = render(<MiniChart kind="line" points={yearly} context={{ agg: 'avg', missing_periods: ['2023'], bucket: null }} animate={false} />);
    expect(container.querySelector('.cq-chart-line-path').getAttribute('d').match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('.cq-chart-line-point')).toHaveLength(3);
    expect(within(screen.getByRole('table')).getByRole('row', { name: '2023 No numeric value' })).toBeInTheDocument();
  });

  test('long month labels reserve space instead of adding a crowded middle tick', () => {
    const monthly = [{ key: '2023-01-01T00:00:00Z', label: '2023-01', value: 1 },
      { key: '2024-02-01T00:00:00Z', label: '2024-02', value: 2 },
      { key: '2025-12-01T00:00:00Z', label: '2025-12', value: 3 }];
    const { container } = render(<MiniChart kind="line" points={monthly} context={{ agg: 'avg', bucket: 'month', missing_periods: [] }} animate={false} />);
    expect(container.querySelectorAll('.cq-chart-time-tick')).toHaveLength(2);
    expect(within(screen.getByRole('table')).getByRole('row', { name: 'Feb 2024 2' })).toBeInTheDocument();
  });

  test.each([[-1e308, 1e308], [1.6e308, 1.7e308], [Number.MAX_VALUE / 2, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE * 2]])(
    'finite large measures keep finite coordinates and readable axis labels: %s, %s', (first, second) => {
      const extreme = [{ key: '2020', label: '2020', value: first }, { key: '2025', label: '2025', value: second }];
      const { container, rerender } = render(<MiniChart kind="line" points={extreme} context={{ agg: 'avg', missing_periods: [] }} animate={false} />);
      expect(container.querySelector('.cq-chart-line-path').getAttribute('d')).not.toMatch(/NaN|Infinity/);
      for (const point of container.querySelectorAll('.cq-chart-line-point')) expect(Number.isFinite(Number(point.getAttribute('cy')))).toBe(true);
      expect(container.querySelector('.cq-chart-line-current strong').textContent.length).toBeLessThan(12);
      rerender(<MiniChart kind="bars" points={extreme} context={{ agg: 'avg' }} animate={false} />);
      for (const fill of container.querySelectorAll('.cq-chart-bar-fill')) {
        expect(Number.isFinite(parseFloat(fill.style.width))).toBe(true);
        expect(parseFloat(fill.style.width)).toBeGreaterThan(0);
      }
    });

  test('French legends and date tables are localized', () => {
    localStorage.setItem('cq-lang', 'fr');
    const { rerender } = render(<LangProvider><MiniChart kind="donut" points={points} context={count} animate={false} /></LangProvider>);
    expect(screen.getByRole('list', { name: 'Catégories et valeurs' })).toBeInTheDocument();
    rerender(<LangProvider><MiniChart kind="line" points={yearly} context={{ agg: 'count', missing_periods: ['2023'] }} animate={false} /></LangProvider>);
    expect(screen.getByRole('columnheader', { name: 'Période' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Enregistrements' })).toBeInTheDocument();
    expect(screen.getByText('Aucune valeur numérique')).toBeInTheDocument();
  });

  test('entry animation draws briefly, while reduced motion shows the final frame immediately', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<MiniChart kind="bars" points={points} context={count} />);
    expect(container.querySelector('.cq-chart-bar-fill')).toHaveStyle({ transform: 'scaleX(0)' });
    act(() => vi.advanceTimersByTime(40));
    expect(container.querySelector('.cq-chart-bar-fill')).toHaveStyle({ transform: 'scaleX(1)' });
    rerender(<MiniChart kind="bars" points={points} context={count} animate={false} />);
    expect(container.querySelector('.cq-chart-bar-fill')).toHaveStyle({ transform: 'scaleX(1)' });
  });

  test('empty, unknown and nonnumeric inputs do not draw chart shapes', () => {
    const { container, rerender } = render(<MiniChart kind="donut" points={[]} animate={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MiniChart kind="unknown" points={points} animate={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MiniChart kind="bars" points={[{ label: 'Missing', value: null }, { label: 'Text', value: '3' }]} animate={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('chartSummary', () => {
  test('other chart users retain a computed total and top-share caption', () => {
    const summary = chartSummary('donut', [{ label: 'Banks', value: 90 }, { label: 'Other', value: 10 }], 'en');
    expect(summary.center).toBe('100');
    expect(summary.caption).toBe('Banks · 90%');
  });
});
