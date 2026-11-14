import { describe, beforeEach, vi, expect, test } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ChartPanel from './ChartPanel.jsx';
import { ANALYSIS, BLOCKED } from '../test/chartAnalysis.js';

vi.mock('../api/catalog.js', () => ({ fetchResourceCharts: vi.fn(), fetchCustomChart: vi.fn(), queryResource: vi.fn() }));
vi.mock('./charts/Visuals.jsx', () => ({
  ChartCard: ({ title, subtitle, children }) => <section><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}{children}</section>,
  ChartSkeleton: () => <div>Chart loading</div>,
  ChartEmpty: ({ label }) => <div>{label}</div>,
  KpiCard: ({ label, value, sub }) => <div data-testid="kpi">{label}: {value}{sub ? ' (' + sub + ')' : ''}</div>,
  DonutChart: ({ records }) => <div>Donut {records.map((r) => r.key + '=' + r.value).join(', ')}</div>,
  CategoryBar: ({ records }) => <div>Bars {records.map((r) => r.key + '=' + r.value).join(', ')}</div>,
  TimeSeriesChart: ({ records }) => <div>Line {records.map((r) => r.key + '=' + r.value).join(', ')}</div>,
}));
import { fetchResourceCharts, fetchCustomChart } from '../api/catalog.js';
import { ApiError, NotIngestedError } from '../api/client.js';
import { ChartLoadContext, createChartLoadStore } from '../hooks/useChartLoadReport.js';

const FIELDS = [{ id: '_id', type: 'int' }, { id: 'Province', type: 'TEXT' }, { id: 'TOTAL', type: 'TEXT' }];
const answer = (data) => Promise.resolve({ data, meta: {} });

beforeEach(() => {
  vi.clearAllMocks();
  fetchResourceCharts.mockImplementation(() => answer(ANALYSIS));
  fetchCustomChart.mockImplementation(() => new Promise(() => {}));
});

describe('the Chart tab', () => {
  test('asks the chart engine once and draws what it chose, with the figures above and what it left out', async () => {
    render(<ChartPanel resourceId="r1" q="" fields={FIELDS} queryMode="ingested" />);
    expect(screen.getByRole('button', { name: 'Insights', pressed: true })).toBeInTheDocument();
    await screen.findByText('TOTAL by Province');
    expect(fetchResourceCharts).toHaveBeenCalledTimes(1);
    expect(fetchResourceCharts).toHaveBeenCalledWith('r1', { q: '', filters: undefined, lang: 'en' }, expect.objectContaining({ background: false, signal: expect.any(AbortSignal) }));
    expect(screen.getAllByTestId('kpi').map((kpi) => kpi.textContent)).toEqual(['Rows: 288', 'Time span: Jan 2019 – Apr 2019', 'Total: ≥ 1,000 (TOTAL)']);
    // Placeholders are left out of a sum that is then a floor; the blank group is named.
    expect(screen.getByText('Donut Ontario=600, Quebec=300, Not recorded=100')).toBeInTheDocument();
    expect(screen.getByText('2 groups · At least: some cells hold no number')).toBeInTheDocument();
    expect(screen.getByText('200 cells hold “--” instead of a number and are left out.')).toBeInTheDocument();
    expect(screen.getByText('8 rows have no value here and are shown as “Not recorded”.')).toBeInTheDocument();
    expect(screen.getByText('TOTAL over time')).toBeInTheDocument();
    expect(screen.getByText('Line Jan 2019=10, Feb 2019=20, Mar 2019=15, Apr 2019=30')).toBeInTheDocument();
    // Each chart is a figure with a sentence and its values.
    expect(screen.getByText('2 groups. Largest: Ontario, 600.')).toBeInTheDocument();
    expect(screen.getAllByText('Values')).toHaveLength(2);
    // How the table was read, and what was set aside.
    expect(screen.getByText('How CanQuery read this table')).toBeInTheDocument();
    expect(screen.getByText('Average Rate by Province: every value is the same')).toBeInTheDocument();
  });

  test('a search or a filter redraws the same charts from a background read, keeping the old ones meanwhile', async () => {
    const view = render(<ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" />);
    await screen.findByText('TOTAL by Province');
    let resolve;
    fetchResourceCharts.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    view.rerender(<ChartPanel resourceId="r1" q="ontario" filters={{ Province: { op: 'eq', value: 'Ontario' } }} fields={FIELDS} queryMode="ingested" />);
    await waitFor(() => expect(fetchResourceCharts).toHaveBeenCalledTimes(2));
    expect(fetchResourceCharts).toHaveBeenLastCalledWith('r1', { q: 'ontario', filters: { Province: { op: 'eq', value: 'Ontario' } }, lang: 'en' },
      expect.objectContaining({ background: true }));
    expect(screen.getByText('TOTAL by Province')).toBeInTheDocument();
    resolve({ data: { ...ANALYSIS, kpis: [{ role: 'rows', value: 40 }], scope: { ...ANALYSIS.scope, rows: 40, filtered: true } } });
    await waitFor(() => expect(screen.getAllByTestId('kpi').map((kpi) => kpi.textContent)).toEqual(['Rows: 40']));
  });

  test('a measure that is different things in each row offers those things as filters', async () => {
    fetchResourceCharts.mockImplementation(() => answer(BLOCKED));
    const onPin = vi.fn();
    render(<ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" onPin={onPin} />);
    await screen.findByText('Some figures in this table cannot be added up together');
    expect(screen.getByText(/^“Measure Value” is a different measure for each “Data Point Label”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Net income/ }));
    expect(onPin).toHaveBeenCalledWith('Data Point Label', 'Net income');
    // A ratio is charted under no filter: it is not offered.
    expect(screen.queryByRole('button', { name: /Capital ratio/ })).toBeNull();
    expect(screen.getByText('No chart of this table would say something reliable.')).toBeInTheDocument();
  });

  test('when no value leads to a chart, the tab says so and offers none', async () => {
    const block = { ...BLOCKED.blocked[0], values: BLOCKED.blocked[0].values.map((entry) => ({ ...entry, charts: false })), charts: false };
    fetchResourceCharts.mockImplementation(() => answer({ ...BLOCKED, blocked: [block] }));
    render(<ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" onPin={vi.fn()} />);
    await screen.findByText('Some figures in this table cannot be added up together');
    expect(screen.getByText('“Measure Value” is not charted: its figures cannot be added up across “Data Point Label”, nor one “Data Point Label” at a time. The Table tab shows them as published.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Net income|Capital ratio/ })).toBeNull();
  });

  test('figures the engine did not add up on its own are said, under the counts or in place of a chart', async () => {
    fetchResourceCharts.mockImplementation(() => answer({ ...ANALYSIS, sums_withheld: true }));
    const view = render(<ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" />);
    await screen.findByText('TOTAL by Province');
    expect(screen.getByText('The figures of this table are not added up automatically: adding up its rows could count the same thing twice. In the Custom tab, you choose what to add up.')).toBeInTheDocument();
    view.unmount();

    fetchResourceCharts.mockImplementation(() => answer({ ...ANALYSIS, status: 'no_charts', charts: [], kpis: [{ role: 'rows', value: 20 }], sums_withheld: true }));
    render(<ChartPanel resourceId="r2" fields={FIELDS} queryMode="ingested" />);
    await screen.findByText('The figures of this table are not added up automatically: adding up its rows could count the same thing twice.');
    expect(screen.getByText('In the Custom tab, you choose what to add up.')).toBeInTheDocument();
    expect(screen.queryByText('No chart of this table would say something reliable.')).toBeNull();
  });

  test('a busy engine says so and offers to try again', async () => {
    fetchResourceCharts.mockImplementationOnce(() => Promise.reject(new ApiError('busy', 503, { code: 'CHARTS_BUSY' })));
    render(<ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" />);
    await screen.findByText('Charts are busy right now. Try again in a moment.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('TOTAL by Province');
    expect(fetchResourceCharts).toHaveBeenCalledTimes(2);
    // The visit was not counted by the failed request: the retry counts it.
    expect(fetchResourceCharts.mock.calls[1][2]).toMatchObject({ background: false });
  });

  test('unprepared live resources never chart a misleading row preview', () => {
    render(<ChartPanel resourceId="d1" fields={FIELDS} queryMode="datastore" />);
    expect(screen.getByText(/Full-data charts require a prepared file/)).toBeInTheDocument();
    expect(fetchResourceCharts).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('an expired copy asks the resource page to recover', async () => {
    fetchResourceCharts.mockImplementationOnce(() => Promise.reject(new NotIngestedError('expired', 409)));
    const onUnavailable = vi.fn();
    render(<ChartPanel resourceId="expired" fields={FIELDS} queryMode="ingested" onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
  });

  test('the Custom tab starts from the chart the engine put first', async () => {
    render(<ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" />);
    await screen.findByText('TOTAL by Province');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() => expect(fetchCustomChart).toHaveBeenCalledWith('r1', { kind: 'donut', x: { column: 'Province' }, y: { agg: 'sum', column: 'TOTAL' } },
      { q: undefined, filters: undefined, lang: 'en' }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(fetchResourceCharts).toHaveBeenCalledTimes(1);
  });

  test('the loading card waits for the first answer as the profile, and for later ones as a refresh', async () => {
    const store = createChartLoadStore();
    let resolve;
    fetchResourceCharts.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const panel = (props) => <ChartLoadContext.Provider value={store}><ChartPanel resourceId="r1" fields={FIELDS} queryMode="ingested" {...props} /></ChartLoadContext.Provider>;
    const view = render(panel({}));
    await waitFor(() => expect(store.getSnapshot()).toMatchObject({ profile: 'loading', charts: { total: 1, settled: 1 } }));
    resolve({ data: ANALYSIS });
    await waitFor(() => expect(store.getSnapshot()).toMatchObject({ profile: 'settled', charts: { total: 1, settled: 1 } }));
    fetchResourceCharts.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    view.rerender(panel({ q: 'x' }));
    await waitFor(() => expect(store.getSnapshot()).toMatchObject({ profile: 'settled', charts: { total: 1, settled: 0 } }));
    resolve({ data: ANALYSIS });
    await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 }));
    expect(within(document.body).getByText('TOTAL by Province')).toBeInTheDocument();
  });
});
