import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChartBuilder from './ChartBuilder.jsx';
import { MODEL, SHARE, LINE, BLOCKED } from '../test/chartAnalysis.js';

vi.mock('../api/catalog.js', () => ({ fetchCustomChart: vi.fn(), queryResource: vi.fn() }));
vi.mock('./charts/Visuals.jsx', () => ({
  ChartCard: ({ title, subtitle, children }) => <section><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}{children}</section>,
  ChartSkeleton: () => <div>Chart loading</div>,
  ChartEmpty: ({ label }) => <div>{label}</div>,
  DonutChart: ({ records }) => <div>Donut {records.map((r) => r.key + '=' + r.value).join(', ')}</div>,
  CategoryBar: ({ records }) => <div>Bars {records.map((r) => r.key + '=' + r.value).join(', ')}</div>,
  TimeSeriesChart: ({ records }) => <div>Line {records.map((r) => r.key).join(', ')}</div>,
}));
import { fetchCustomChart, queryResource } from '../api/catalog.js';
import { ApiError } from '../api/client.js';

const answer = (chart, reason = null) => Promise.resolve({ data: { chart, reason }, meta: {} });
const build = (props = {}) => render(<ChartBuilder resourceId="r1" queryMode="ingested" model={MODEL} initialSpec={SHARE.spec} {...props} />);
const lastSpec = () => fetchCustomChart.mock.calls[fetchCustomChart.mock.calls.length - 1][1];
const select = (name) => screen.getByRole('combobox', { name });

beforeEach(() => {
  vi.clearAllMocks();
  fetchCustomChart.mockImplementation((_id, spec) => answer(spec.x.time ? LINE : SHARE));
});

describe('the custom builder', () => {
  test('offers the table\'s time axes and groups, each language\'s copy once, and starts from the first automatic chart', async () => {
    build();
    await screen.findByText('Donut Ontario=600, Quebec=300, Not recorded=100');
    expect(lastSpec()).toEqual({ kind: 'donut', x: { column: 'Province' }, y: { agg: 'sum', column: 'TOTAL' } });
    const x = select('X axis');
    expect(x).toHaveValue('c:Province');
    // Column names read as words: underscores become spaces.
    expect([...within(x).getByRole('group', { name: 'Time' }).querySelectorAll('option')].map((option) => option.textContent))
      .toEqual(['EN YEAR', 'EN YEAR + EN MONTH']);
    expect([...within(x).getByRole('group', { name: 'Groups' }).querySelectorAll('option')].map((option) => option.textContent))
      .toEqual(['EN MONTH', 'Province', 'Code']);
    expect(within(x).queryByRole('group', { name: 'Other columns' })).toBeNull();
    // Every column, on request: the other language's copy and the rest.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show every column' }));
    expect([...within(select('X axis')).getByRole('group', { name: 'Groups' }).querySelectorAll('option')].map((option) => option.textContent))
      .toEqual(['EN MONTH', 'Province', 'Province FR', 'Code']);
    expect(within(select('X axis')).getByRole('group', { name: 'Other columns' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TOTAL by Province' })).toBeInTheDocument();
  });

  test('values to add up or average are the table\'s numbers, those read from text marked as such', async () => {
    build();
    await screen.findByText(/^Donut/);
    expect([...select('Value column').querySelectorAll('option')].map((option) => option.textContent)).toEqual(['TOTAL (numbers read from text)', 'Rate']);
    fireEvent.change(select('Value column'), { target: { value: 'Rate' } });
    fireEvent.change(select('Function'), { target: { value: 'avg' } });
    await waitFor(() => expect(lastSpec()).toEqual({ kind: 'bars', x: { column: 'Province' }, y: { agg: 'avg', column: 'Rate' } }));
    // A donut is a share of a whole: offered for counts and sums only.
    expect(screen.getByRole('button', { name: 'Donut' })).toBeDisabled();
    fireEvent.change(select('Function'), { target: { value: 'count' } });
    await waitFor(() => expect(lastSpec()).toEqual({ kind: 'donut', x: { column: 'Province' }, y: { agg: 'count' } }));
    expect(screen.queryByRole('combobox', { name: 'Value column' })).toBeNull();
  });

  test('a time axis is drawn in order, at the period chosen', async () => {
    build();
    await screen.findByText(/^Donut/);
    fireEvent.change(select('X axis'), { target: { value: 't:EN_YEAR+EN_MONTH' } });
    await waitFor(() => expect(lastSpec()).toEqual({ x: { time: 't:EN_YEAR+EN_MONTH', grain: 'month' }, y: { agg: 'sum', column: 'TOTAL' } }));
    await screen.findByText('Line Jan 2019, Feb 2019, Mar 2019, Apr 2019');
    expect([...select('Period').querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Month', 'Year']);
    fireEvent.change(select('Period'), { target: { value: 'year' } });
    await waitFor(() => expect(lastSpec()).toEqual({ x: { time: 't:EN_YEAR+EN_MONTH', grain: 'year' }, y: { agg: 'sum', column: 'TOTAL' } }));
    // No donut or bars toggle for time: the engine draws two or three periods as bars itself.
    expect(screen.queryByRole('button', { name: 'Donut' })).toBeNull();
  });

  test('a sum across different measures is refused with the column to group or filter by', async () => {
    fetchCustomChart.mockImplementation(() => Promise.reject(new ApiError('refused', 400, { code: 'CHART_REFUSED', hint: 'mixed_measures' })));
    build({ model: BLOCKED.model, initialSpec: null });
    fireEvent.change(select('Function'), { target: { value: 'sum' } });
    expect(await screen.findByText('“Measure Value” holds a different thing for each “Data Point Label”. Group by “Data Point Label”, or filter the table to one of them.'))
      .toBeInTheDocument();
  });

  test('says why when the choices leave nothing to draw, and lets a busy engine be retried', async () => {
    fetchCustomChart.mockImplementationOnce(() => answer(null, 'flat'));
    const view = build();
    expect(await screen.findByText('No chart can be drawn with these choices: every value is the same.')).toBeInTheDocument();
    fetchCustomChart.mockImplementationOnce(() => Promise.reject(new ApiError('busy', 503, { code: 'CHARTS_BUSY' })));
    view.rerender(<ChartBuilder resourceId="r1" queryMode="ingested" model={MODEL} initialSpec={SHARE.spec} q="on" />);
    await screen.findByText('Charts are busy right now. Try again in a moment.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Donut/);
  });

  test('the lowest or highest text of a group is read as the table query reads it', async () => {
    queryResource.mockResolvedValue({ data: { records: [{ key: 'Ontario', value: 'Toronto note' }], total: 1 } });
    build();
    await screen.findByText(/^Donut/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show every column' }));
    fireEvent.change(select('Function'), { target: { value: 'max' } });
    fireEvent.change(select('Value column'), { target: { value: 'Notes' } });
    // A builder choice is a background read: it neither renews the copy nor counts as a visit.
    await waitFor(() => expect(queryResource).toHaveBeenCalledWith('r1', expect.objectContaining({ group_by: 'Province', agg: 'max', agg_column: 'Notes' }),
      expect.objectContaining({ background: true })));
    expect(await screen.findByText('Toronto note')).toBeInTheDocument();
  });

  test('the column shown is the column asked for, even once its choice is no longer offered', async () => {
    build();
    await screen.findByText(/^Donut/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show every column' }));
    fireEvent.change(select('X axis'), { target: { value: 'c:Notes' } });
    await waitFor(() => expect(lastSpec().x).toEqual({ column: 'Notes' }));
    // Hiding the other columns again takes "Notes" off the list: the select and
    // the request both fall back to the first choice, never one each.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show every column' }));
    expect(select('X axis')).toHaveValue('t:EN_YEAR');
    await waitFor(() => expect(lastSpec().x).toEqual({ time: 't:EN_YEAR', grain: 'year' }));
  });

  test('the value column is never the column grouped by', async () => {
    build();
    await screen.findByText(/^Donut/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show every column' }));
    fireEvent.change(select('X axis'), { target: { value: 'c:TOTAL' } });
    await waitFor(() => expect(lastSpec()).toEqual({ kind: 'donut', x: { column: 'TOTAL' }, y: { agg: 'sum', column: 'Rate' } }));
    expect([...select('Value column').querySelectorAll('option')].map((option) => option.value)).not.toContain('TOTAL');
  });

  test('errors read in the page\'s language, and any rate limit can be retried', async () => {
    fetchCustomChart.mockImplementationOnce(() => Promise.reject(new ApiError('Spec says no', 400, { code: 'INVALID_CHART_SPEC' })));
    const view = build();
    expect(await screen.findByText('This chart cannot be drawn from these choices.')).toBeInTheDocument();
    expect(screen.queryByText('Spec says no')).toBeNull();
    // The general rate limit answers 429 without a code of its own.
    fetchCustomChart.mockImplementationOnce(() => Promise.reject(new ApiError('Too many requests', 429, {})));
    view.rerender(<ChartBuilder resourceId="r1" queryMode="ingested" model={MODEL} initialSpec={SHARE.spec} q="on" />);
    await screen.findByText('Charts are busy right now. Try again in a moment.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/^Donut/);
    fetchCustomChart.mockImplementationOnce(() => Promise.reject(new ApiError('Something broke', 500, {})));
    view.rerender(<ChartBuilder resourceId="r1" queryMode="ingested" model={MODEL} initialSpec={SHARE.spec} q="other" />);
    expect(await screen.findByText('This chart could not be drawn.')).toBeInTheDocument();
  });

  test('without a prepared copy or a model there is nothing to build from', () => {
    const first = render(<ChartBuilder resourceId="r1" queryMode="datastore" />);
    expect(screen.getByText(/Full-data charts require a prepared file/)).toBeInTheDocument();
    first.unmount();
    render(<ChartBuilder resourceId="r1" queryMode="ingested" model={null} />);
    expect(screen.getByText("Couldn't load insights for this table.")).toBeInTheDocument();
    expect(fetchCustomChart).not.toHaveBeenCalled();
  });
});

describe('the loading card', () => {
  test('counts the custom chart until it draws', async () => {
    const { ChartLoadContext, createChartLoadStore } = await import('../hooks/useChartLoadReport.js');
    const store = createChartLoadStore();
    let resolve;
    fetchCustomChart.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<ChartLoadContext.Provider value={store}><ChartBuilder resourceId="r1" queryMode="ingested" model={MODEL} initialSpec={SHARE.spec} /></ChartLoadContext.Provider>);
    await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 0 }));
    resolve({ data: { chart: SHARE, reason: null } });
    await waitFor(() => expect(store.getSnapshot().charts).toEqual({ total: 1, settled: 1 }));
  });
});
