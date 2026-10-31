import { describe, expect, test } from 'vitest';
import {
  ANNOUNCE_MS,
  HOLD_MS,
  IDLE_RUN,
  SETTLE_MS,
  SHOW_DELAY_MS,
  bandOf,
  chartLoadReducer,
  chartLoadStage,
  isRunVisible,
  layoutFor,
  preparationCovered,
  summarizeUnits
} from './chartLoadProgress.js';

const units = (overrides = {}) => ({
  count: 1,
  chunk: 0,
  profile: 'settled',
  charts: { total: 0, settled: 0 },
  ...overrides
});
const observe = (run, info, now, immediate = false) =>
  chartLoadReducer(run, { type: 'observe', info, now, immediate });
const tick = (run, now, smooth = false) => chartLoadReducer(run, { type: 'tick', now, smooth });
/** Ticks every 200 ms from `from` to `to`, returning the last run and every shown value. */
function tickThrough(run, from, to, smooth = false) {
  const values = [];
  let current = run;
  for (let now = from; now <= to; now += 200) {
    current = tick(current, now, smooth);
    values.push(current.shown);
  }
  return { run: current, values };
}

describe('bands', () => {
  test('each layout covers 0 to 99 without gaps, in step order', () => {
    for (const [layout, stages] of [
      ['prep', ['queued', 'downloading', 'loading', 'finishing', 'opening', 'profile', 'charts']],
      ['ready', ['opening', 'profile', 'charts']],
      ['refresh', ['charts']]
    ]) {
      let previous = 0;
      for (const stage of stages) {
        const [start, end] = bandOf(layout, stage);
        expect(start).toBeCloseTo(previous, 9);
        expect(end).toBeGreaterThan(start);
        previous = end;
      }
      expect(previous).toBeCloseTo(99, 9);
    }
    expect(bandOf('ready', 'queued')).toBeNull();
    expect(bandOf('refresh', 'profile')).toBeNull();
  });

  test('a run takes its layout from the stage it starts in', () => {
    expect(layoutFor('queued')).toBe('prep');
    expect(layoutFor('loading')).toBe('prep');
    expect(layoutFor('opening')).toBe('ready');
    expect(layoutFor('profile')).toBe('ready');
    expect(layoutFor('charts')).toBe('refresh');
  });

  test('the card stands in only while a preparation runs or is about to', () => {
    const base = { supported: true, enabled: true, awaitingVisitor: false };
    for (const phase of ['idle', 'requesting', 'pending', 'running'])
      expect(preparationCovered({ ...base, phase })).toBe(true);
    for (const phase of ['waiting', 'failed', 'unavailable'])
      expect(preparationCovered({ ...base, phase })).toBe(false);
    expect(preparationCovered({ ...base, phase: 'idle', awaitingVisitor: true })).toBe(false);
    expect(preparationCovered({ ...base, phase: 'running', supported: false })).toBe(false);
    expect(preparationCovered({ ...base, phase: 'running', enabled: false })).toBe(false);
  });
});

describe('stages', () => {
  const prep = (phase, progress = null, published = false) =>
    chartLoadStage({ preparing: true, charting: false, published, phase, progress }, units({ count: 0 }));
  const chart = (u) => chartLoadStage({ preparing: false, charting: true, published: false, phase: 'idle', progress: null }, u);

  test('reads the preparation', () => {
    expect(prep('idle')).toEqual({ stage: 'queued', waiting: false });
    expect(prep('requesting')).toEqual({ stage: 'queued', waiting: false });
    expect(prep('pending')).toEqual({ stage: 'queued', waiting: true });
    expect(prep('running')).toEqual({ stage: 'downloading', ratio: null, bytes: null, length: null });
    expect(prep('running', { phase: 'downloading', bytes: 25, content_length: 100 })).toEqual({
      stage: 'downloading',
      ratio: 0.25,
      bytes: 25,
      length: 100
    });
    // A decoded (gzip) download can pass its declared length.
    expect(prep('running', { phase: 'downloading', bytes: 130, content_length: 100 }).ratio).toBe(1);
    expect(prep('running', { phase: 'loading', rows: 5000, read_fraction: 0.4 })).toEqual({
      stage: 'loading',
      ratio: 0.4,
      rows: 5000
    });
    expect(prep('running', { phase: 'loading', rows: 0 })).toEqual({ stage: 'loading', ratio: null, rows: 0 });
    expect(prep('running', { phase: 'finishing', rows: 9 })).toEqual({ stage: 'finishing' });
    expect(prep('idle', null, true)).toEqual({ stage: 'opening' });
  });

  test('reads the chart area', () => {
    expect(chart(units({ count: 0 }))).toEqual({ stage: 'opening' });
    expect(chart(units({ chunk: 1, profile: null }))).toEqual({ stage: 'opening' });
    expect(chart(units({ profile: 'loading' }))).toEqual({ stage: 'profile' });
    expect(chart(units({ profile: 'failed' }))).toEqual({ stage: 'failed' });
    expect(chart(units({ count: 4, charts: { total: 3, settled: 1 } }))).toEqual({
      stage: 'charts',
      settled: 1,
      total: 3
    });
    expect(chart(units({ count: 4, charts: { total: 3, settled: 3 } }))).toEqual({ stage: 'done' });
    // A table with nothing to chart is done once its profile is in.
    expect(chart(units())).toEqual({ stage: 'done' });
    expect(chartLoadStage({ preparing: false, charting: false, published: false, phase: 'failed', progress: null }, units())).toEqual({ stage: 'idle' });
  });

  test('sums what the chart area reports', () => {
    expect(
      summarizeUnits([
        { kind: 'chunk', state: 'loading' },
        { kind: 'profile', state: 'settled' },
        { kind: 'profile', state: 'loading' },
        { kind: 'chart', state: 'loading' },
        { kind: 'chart', state: 'settled' },
        { kind: 'chart', state: 'failed' }
      ])
    ).toEqual({ count: 6, chunk: 1, profile: 'loading', charts: { total: 3, settled: 2 } });
    expect(summarizeUnits([])).toEqual({ count: 0, chunk: 0, profile: null, charts: { total: 0, settled: 0 } });
  });
});

describe('a preparation run', () => {
  test('shows at once, eases without passing 90% of a silent band and never goes down', () => {
    let run = observe(IDLE_RUN, { stage: 'queued', waiting: true }, 0, true);
    expect(isRunVisible(run)).toBe(true);
    expect(run.layout).toBe('prep');
    const [, queuedEnd] = bandOf('prep', 'queued');
    let result = tickThrough(run, 200, 120000);
    expect(Math.max(...result.values)).toBeLessThanOrEqual(queuedEnd * 0.9 + 1e-9);
    run = result.run;
    const before = run.value;
    // A requeued job goes back to waiting: the number holds.
    run = observe(run, { stage: 'downloading', ratio: null, bytes: null, length: null }, 120200);
    run = tick(run, 121000);
    expect(run.value).toBeGreaterThanOrEqual(before);
    const afterDownload = run.value;
    run = observe(run, { stage: 'queued', waiting: true }, 121200);
    result = tickThrough(run, 121400, 125000);
    expect(Math.min(...result.values)).toBeGreaterThanOrEqual(afterDownload);
  });

  test('a real figure moves the value through the rest of its band without stalling', () => {
    let run = observe(IDLE_RUN, { stage: 'downloading', ratio: null, bytes: null, length: null }, 0, true);
    run = tickThrough(run, 200, 4000).run;
    const eased = run.value;
    const [, end] = bandOf('prep', 'downloading');
    run = observe(run, { stage: 'downloading', ratio: 0.1, bytes: 10, length: 100 }, 4200);
    run = tick(run, 4400);
    expect(run.value).toBeGreaterThanOrEqual(eased);
    run = observe(run, { stage: 'downloading', ratio: 0.55, bytes: 55, length: 100 }, 4600);
    run = tick(run, 4800);
    const middle = run.value;
    expect(middle).toBeGreaterThan(eased);
    run = observe(run, { stage: 'downloading', ratio: 1, bytes: 100, length: 100 }, 5000);
    run = tick(run, 5200);
    expect(run.value).toBeGreaterThan(middle);
    expect(run.value).toBeLessThan(end);
  });

  test('reaches 100 only after every chart has settled, holds it, then hides', () => {
    let run = observe(IDLE_RUN, { stage: 'finishing' }, 0, true);
    run = tickThrough(run, 200, 2000).run;
    run = observe(run, { stage: 'opening' }, 2200);
    run = observe(run, { stage: 'profile' }, 2400);
    run = observe(run, { stage: 'charts', settled: 0, total: 2 }, 3000);
    run = tickThrough(run, 3200, 4000).run;
    const one = observe(run, { stage: 'charts', settled: 1, total: 2 }, 4200);
    run = tickThrough(one, 4400, 5000).run;
    expect(run.value).toBeLessThan(99.0001);
    expect(run.status).toBe('running');
    run = observe(run, { stage: 'done' }, 5200);
    run = tick(run, 5200 + SETTLE_MS - 1);
    expect(run.status).toBe('running');
    expect(run.value).toBeLessThan(100);
    run = tick(run, 5200 + SETTLE_MS);
    expect(run.status).toBe('holding');
    expect(run.shown).toBe(100);
    expect(isRunVisible(run)).toBe(true);
    run = tick(run, 5200 + SETTLE_MS + HOLD_MS - 1);
    expect(run.status).toBe('holding');
    run = tick(run, 5200 + SETTLE_MS + HOLD_MS);
    expect(run.status).toBe('idle');
    expect(isRunVisible(run)).toBe(false);
  });

  test('a failure ends the run without 100, and the next run starts at 0', () => {
    let run = observe(IDLE_RUN, { stage: 'loading', ratio: 0.5, rows: 5000 }, 0, true);
    run = tickThrough(run, 200, 3000).run;
    expect(run.value).toBeGreaterThan(0);
    run = observe(run, { stage: 'idle' }, 3200);
    expect(run.status).toBe('idle');
    expect(run.value).toBe(0);
    run = observe(run, { stage: 'queued', waiting: false }, 4000, true);
    expect(run.value).toBe(0);
    expect(run.shown).toBe(0);
  });
});

describe('a ready copy', () => {
  test('stays hidden for the show delay, and a quick finish is never shown', () => {
    let run = observe(IDLE_RUN, { stage: 'profile' }, 0);
    expect(run.layout).toBe('ready');
    expect(isRunVisible(run)).toBe(false);
    run = tick(run, 200);
    expect(isRunVisible(run)).toBe(false);
    run = observe(run, { stage: 'done' }, 250);
    run = tick(run, 400);
    expect(run.status).toBe('idle');
    expect(isRunVisible(run)).toBe(false);
  });

  test('a slower one shows after the delay and completes at 100', () => {
    let run = observe(IDLE_RUN, { stage: 'opening' }, 0);
    run = tick(run, SHOW_DELAY_MS - 1);
    expect(isRunVisible(run)).toBe(false);
    run = tick(run, SHOW_DELAY_MS);
    expect(isRunVisible(run)).toBe(true);
    run = observe(run, { stage: 'profile' }, 400);
    run = observe(run, { stage: 'done' }, 900);
    run = tick(run, 1100);
    expect(run.status).toBe('holding');
    expect(run.shown).toBe(100);
  });

  test('a stage outside the layout starts a new run', () => {
    let run = observe(IDLE_RUN, { stage: 'charts', settled: 0, total: 1 }, 0);
    expect(run.layout).toBe('refresh');
    run = tickThrough(run, 200, 1000).run;
    run = observe(run, { stage: 'profile' }, 1200);
    expect(run.layout).toBe('ready');
    expect(run.value).toBe(0);
  });
});

describe('presentation', () => {
  test('smoothing closes the gap gradually; without it the number jumps', () => {
    const start = observe(IDLE_RUN, { stage: 'downloading', ratio: 0.9, bytes: 90, length: 100 }, 0, true);
    const smooth = tick(start, 200, true);
    const instant = tick(start, 200, false);
    expect(instant.shown).toBe(instant.value);
    expect(smooth.shown).toBeLessThan(smooth.value);
    expect(smooth.shown).toBeGreaterThan(0);
  });

  test('a stage is announced only once it has lasted', () => {
    let run = observe(IDLE_RUN, { stage: 'queued', waiting: false }, 0, true);
    run = tick(run, ANNOUNCE_MS - 1);
    expect(run.announced).toBeNull();
    run = observe(run, { stage: 'downloading', ratio: null, bytes: null, length: null }, ANNOUNCE_MS - 1);
    run = tick(run, ANNOUNCE_MS + 100);
    expect(run.announced).toBeNull();
    run = tick(run, 2 * ANNOUNCE_MS);
    expect(run.announced).toBe('downloading');
  });
});

test('joining a job that is far along places the value at once', () => {
  let run = observe(IDLE_RUN, { stage: 'downloading', ratio: 0.9, bytes: 90, length: 100 }, 0, true);
  run = tick(run, 200);
  const [start, end] = bandOf('prep', 'downloading');
  expect(run.value).toBeCloseTo(start + (end - start) * 0.9, 6);
});
