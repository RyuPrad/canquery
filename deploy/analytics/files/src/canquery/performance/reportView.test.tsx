import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ data: null as any, query: vi.fn(), chart: vi.fn() }));
vi.mock('@/components/metrics/PerformanceCard.module.css', () => ({ default: {} }));
vi.mock('@/app/(main)/websites/[websiteId]/(reports)/performance/Performance.module.css', () => ({
  default: {},
}));
vi.mock('@umami/react-zen', () => {
  const Container = ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>;
  return {
    Column: Container,
    Grid: Container,
    Row: Container,
    Heading: Container,
    Tab: Container,
    TabList: Container,
    TabPanel: Container,
    Tabs: Container,
    Text: ({ children }: any) => <span>{children}</span>,
    Select: ({ children, label, value, onChange }: any) => (
      <label>
        {label}
        <select value={value} onChange={event => onChange(event.target.value)}>
          {children}
        </select>
      </label>
    ),
    ListItem: ({ id, children }: any) => <option value={id}>{children}</option>,
  };
});
vi.mock('@/components/hooks', () => ({
  useMessages: () => ({
    t: (value: string) => value,
    labels: {
      lcp: 'LCP',
      inp: 'INP',
      cls: 'CLS',
      fcp: 'FCP',
      ttfb: 'TTFB',
      good: 'Good',
      poor: 'Poor',
      needsImprovement: 'Needs improvement',
      sampleSize: 'Sample size',
    },
  }),
  useLocale: () => ({ locale: 'en-US', dateLocale: 'en-US' }),
  useResultQuery: (...args: unknown[]) => {
    state.query(...args);
    return { data: state.data, isLoading: false };
  },
}));
vi.mock('motion/react', () => ({
  useSpring: (value: number) => ({ value, set: vi.fn(), jump: vi.fn() }),
  useTransform: (spring: any, format: any) => format(spring.value),
}));
vi.mock('@/components/common/AnimatedDiv', () => ({
  AnimatedDiv: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('@/components/common/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('@/components/common/Panel', () => ({
  Panel: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/common/GridRow', () => ({
  GridRow: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/common/LoadingPanel', () => ({
  LoadingPanel: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/charts/BarChart', () => ({
  BarChart: (props: any) => {
    state.chart(props);
    return <div />;
  },
}));
vi.mock('@/components/metrics/MetricLabel', () => ({
  MetricLabel: ({ data }: any) => <span>{data.label}</span>,
}));
vi.mock('@/components/metrics/ListTable', () => ({
  ListTable: ({ data = [], renderLabel, formatCount }: any) => (
    <ul>
      {data.map((row: any) => (
        <li key={row.label}>
          {renderLabel(row)} {formatCount(row.count)}
        </li>
      ))}
    </ul>
  ),
}));

import { Performance } from '@/app/(main)/websites/[websiteId]/(reports)/performance/Performance';

const props = {
  websiteId: 'canquery',
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: new Date('2026-10-03T00:00:00Z'),
  unit: 'day',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.data = {
    method: 'corrected',
    availableMethods: ['corrected', 'legacy'],
    methodologyStartedAt: null,
    chart: [
      { t: '2026-10-01', p50: 0, p75: 0, p95: 0 },
      { t: '2026-10-02', p50: null, p75: null, p95: null },
    ],
    summary: {
      count: 9,
      lcp: { p50: null, p75: null, p95: null, count: 0 },
      cls: { p50: 0, p75: 0, p95: 0.02, count: 7 },
    },
    pages: [{ name: '/zero', p50: 0, p75: 0, p95: 0, count: 7 }],
    pageTitles: [],
    devices: [],
    browsers: [],
  };
});

test('observed zero is displayed with its sample count while missing cards have no rating', () => {
  render(<Performance {...props} />);
  const clsCard = screen.getByText('CLS').parentElement;
  expect(within(clsCard).getByText('0.000')).toBeInTheDocument();
  expect(within(clsCard).getByText('Good')).toBeInTheDocument();
  expect(within(clsCard).getByText('n = 7')).toBeInTheDocument();
  const lcpCard = screen.getByText('LCP').parentElement;
  expect(within(lcpCard).getByText('No data')).toBeInTheDocument();
  expect(within(lcpCard).queryByText('Good')).not.toBeInTheDocument();
  expect(screen.getByText('/zero (n=7)')).toBeInTheDocument();
});

test('null metrics and absent dates remain chart gaps and use the selected metric sample size', () => {
  render(<Performance {...props} />);
  const chart = state.chart.mock.lastCall?.[0].chartData;
  expect(chart.datasets[0].data.map((point: any) => point.y)).toEqual([0, null, null]);
  expect(chart.datasets.every((series: any) => series.spanGaps === false)).toBe(true);
  fireEvent.click(screen.getByText('CLS'));
  expect(screen.getByText('Sample size: 7')).toBeInTheDocument();
});

test('method and percentile selection update the report and disclose the legacy limitation', () => {
  const view = render(<Performance {...props} />);
  fireEvent.change(screen.getByLabelText('Measurement method'), { target: { value: 'legacy' } });
  expect(state.query.mock.lastCall?.[1]).toMatchObject({ websiteId: 'canquery', method: 'legacy' });
  state.data = { ...state.data, method: 'legacy', methodologyStartedAt: '2026-10-02T12:00:00Z' };
  view.rerender(<Performance {...props} />);
  expect(screen.getByText(/not directly comparable/)).toHaveTextContent('2026-10-02 (UTC)');
  fireEvent.change(screen.getByLabelText('Percentile'), { target: { value: 'p95' } });
  expect(within(screen.getByText('CLS').parentElement).getByText('0.020')).toBeInTheDocument();
});

test('unconfigured websites retain the old zero summary and hide methodology controls', () => {
  delete state.data.availableMethods;
  render(<Performance {...props} websiteId="other" />);
  expect(screen.queryByLabelText('Measurement method')).not.toBeInTheDocument();
  expect(screen.queryByText('No data')).not.toBeInTheDocument();
  expect(screen.getByText('Sample size: 9')).toBeInTheDocument();
  expect(screen.queryByText('/zero')).not.toBeInTheDocument();
  expect(screen.queryByText('n = 7')).not.toBeInTheDocument();
});
