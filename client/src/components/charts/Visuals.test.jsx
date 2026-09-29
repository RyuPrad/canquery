import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { DonutChart } from './Visuals.jsx';

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
