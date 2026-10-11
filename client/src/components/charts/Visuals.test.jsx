import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { CategoryBar, DonutChart } from './Visuals.jsx';

vi.mock('recharts', () => {
  const Container = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Container, PieChart: Container, Pie: Container, Cell: () => null,
    BarChart: () => <div>Signed value bars</div>, Bar: () => null,
    AreaChart: Container, Area: () => null, LineChart: Container, Line: () => null,
    XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null,
  };
});

test('donut totals preserve fractional measures', () => {
  render(<DonutChart lang="en" records={[{ key: 'A', value: 0.25 }, { key: 'B', value: 0.5 }]} totalLabel="Total" />);
  expect(screen.getByText('0.75')).toBeInTheDocument();
  expect(screen.queryByText('1')).toBeNull();
});

test.each([
  [{ key: 'A', value: -2 }, { key: 'B', value: 1 }],
  [{ key: 'A', value: 0 }, { key: 'B', value: 0 }],
])('signed or zero-total measures use bars without misleading proportions', (...records) => {
  render(<DonutChart lang="en" records={records} totalLabel="Total" />);
  expect(screen.getByText('Signed value bars')).toBeInTheDocument();
  expect(screen.getByText('Donut charts require nonnegative values and a positive total. Showing bars.')).toBeInTheDocument();
  expect(screen.queryByText(/%$/)).toBeNull();
});

test('long category lists scroll inside the card instead of squeezing bars', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ key: 'Group ' + i, value: 40 - i }));
  const { unmount } = render(<CategoryBar lang="en" records={many} height={320} />);
  expect(screen.getByRole('region', { name: 'Chart groups, scrollable' })).toHaveAttribute('tabindex', '0');
  unmount();
  render(<CategoryBar lang="en" records={many.slice(0, 6)} height={320} />);
  expect(screen.queryByRole('region')).toBeNull();
});

test('empty and missing categories keep distinct donut entries', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<DonutChart lang="en" records={[{ key: null, value: 1 }, { key: '', value: 2 }, { key: 'A', value: 3 }]} totalLabel="Total" />);
  expect(screen.getAllByText('(empty)')).toHaveLength(2);
  expect(errors.mock.calls.some(([message]) => String(message).includes('same key'))).toBe(false);
  errors.mockRestore();
});
