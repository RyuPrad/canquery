// The Chart tab's loading percentage. Every step a chart waits on gets a band
// of a 0–99 scale (100 means drawn): the preparation's queue, download, row
// loading and finishing, then opening the chart, profiling the table and
// computing each chart. Real signals (bytes downloaded, the share of the file
// read, charts finished) move the value through a band; without one it eases
// toward 90% of the band, so it never claims a step's end before the step ends.
// The value never goes down within a run and reaches 100 only when every chart
// has settled. Pure: callers pass the time in.

/**
 * @typedef {'queued' | 'downloading' | 'loading' | 'finishing' | 'opening' | 'profile' | 'charts'} LoadStage
 * @typedef {'prep' | 'ready' | 'refresh'} LoadLayout
 * @typedef {{ phase?: string | null, bytes?: number | null, content_length?: number | null,
 *   rows?: number | null, read_fraction?: number | null }} JobProgress
 * @typedef {{ preparing: boolean, charting: boolean, published: boolean, phase: string,
 *   progress: JobProgress | null }} LoadFacts
 * @typedef {'loading' | 'settled' | 'failed'} UnitState
 * @typedef {'chunk' | 'profile' | 'chart'} UnitKind
 * @typedef {{ count: number, chunk: number, profile: UnitState | null,
 *   charts: { total: number, settled: number } }} LoadUnits
 * @typedef {{ stage: 'idle' | 'failed' | 'done' | 'finishing' | 'opening' | 'profile' }
 *   | { stage: 'queued', waiting: boolean }
 *   | { stage: 'downloading', ratio: number | null, bytes: number | null, length: number | null }
 *   | { stage: 'loading', ratio: number | null, rows: number }
 *   | { stage: 'charts', settled: number, total: number }} StageInfo
 * @typedef {{ stage: LoadStage, v0: number, r0: number }} Rebase
 * @typedef {{
 *   status: 'idle' | 'running' | 'holding',
 *   layout: LoadLayout | null,
 *   info: StageInfo,
 *   stageSince: number,
 *   settledCharts: number,
 *   chartsSince: number,
 *   rebase: Rebase | null,
 *   value: number,
 *   shown: number,
 *   visibleAt: number,
 *   doneSince: number | null,
 *   holdUntil: number,
 *   now: number,
 *   announced: string | null,
 *   wasVisible: boolean
 * }} LoadRun
 */

/** @type {LoadStage[]} */
export const STAGES = [
  'queued',
  'downloading',
  'loading',
  'finishing',
  'opening',
  'profile',
  'charts'
];
/** @type {Record<LoadStage, number>} */
export const WEIGHTS = {
  queued: 6,
  downloading: 28,
  loading: 32,
  finishing: 10,
  opening: 2,
  profile: 12,
  charts: 10
};
/** Easing time constants (ms) for a stage that reports nothing. @type {Record<LoadStage, number>} */
export const TAU_MS = {
  queued: 12000,
  downloading: 6000,
  loading: 12000,
  finishing: 5000,
  opening: 800,
  profile: 3000,
  charts: 1500
};
export const EASE_CAP = 0.9;
export const RATIO_CAP = 0.98;
export const SHOW_DELAY_MS = 300;
export const SETTLE_MS = 150;
export const HOLD_MS = 600;
export const ANNOUNCE_MS = 700;
const TOP = 99;

/** @type {Record<LoadLayout, LoadStage[]>} */
const LAYOUT_STAGES = {
  prep: STAGES,
  ready: ['opening', 'profile', 'charts'],
  refresh: ['charts']
};

/** @param {string} stage */
const isLoadStage = (stage) => /** @type {string[]} */ (STAGES).includes(stage);

/**
 * The layout a run takes from the stage it starts in.
 * @param {LoadStage} stage
 * @returns {LoadLayout}
 */
export function layoutFor(stage) {
  if (stage === 'charts') return 'refresh';
  if (stage === 'opening' || stage === 'profile') return 'ready';
  return 'prep';
}

/**
 * A stage's [start, end] on the 0–99 scale of a layout, or null when the
 * layout does not include it.
 * @param {LoadLayout} layout
 * @param {LoadStage} stage
 * @returns {[number, number] | null}
 */
export function bandOf(layout, stage) {
  const stages = LAYOUT_STAGES[layout];
  if (!stages.includes(stage)) return null;
  const total = stages.reduce((sum, name) => sum + WEIGHTS[name], 0);
  let start = 0;
  for (const name of stages) {
    const width = (WEIGHTS[name] / total) * TOP;
    if (name === stage) return [start, start + width];
    start += width;
  }
  return null;
}

/**
 * Whether the card stands in for the preparation card: anything running or
 * about to run. Waiting for a visitor, a busy queue (429), a failure and an
 * unavailable file keep their own card.
 * @param {{ supported?: boolean, enabled?: boolean, phase?: string, awaitingVisitor?: boolean }} preparation
 */
export function preparationCovered(preparation) {
  if (!preparation.supported || preparation.enabled === false) return false;
  if (preparation.awaitingVisitor) return false;
  return !['unavailable', 'failed', 'waiting'].includes(String(preparation.phase));
}

/** @param {unknown} value */
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** @param {number} value */
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** @type {Record<UnitState, number>} */
const UNIT_RANK = { settled: 0, loading: 1, failed: 2 };

/**
 * Sums the units the chart area reports: the code chunk, the profile and each chart.
 * @param {Iterable<{ kind: UnitKind, state: UnitState }>} units
 * @returns {LoadUnits}
 */
export function summarizeUnits(units) {
  let count = 0;
  let chunk = 0;
  /** @type {UnitState | null} */
  let profile = null;
  let total = 0;
  let settled = 0;
  for (const { kind, state } of units) {
    count += 1;
    if (kind === 'chunk') {
      if (state === 'loading') chunk += 1;
    } else if (kind === 'profile') {
      if (profile === null || UNIT_RANK[state] > UNIT_RANK[profile]) profile = state;
    } else {
      total += 1;
      if (state !== 'loading') settled += 1;
    }
  }
  return { count, chunk, profile, charts: { total, settled } };
}

/** @param {LoadUnits} a @param {LoadUnits} b */
export function sameUnits(a, b) {
  return (
    a.count === b.count &&
    a.chunk === b.chunk &&
    a.profile === b.profile &&
    a.charts.total === b.charts.total &&
    a.charts.settled === b.charts.settled
  );
}

/**
 * Where the chart stands now.
 * @param {LoadFacts} facts
 * @param {LoadUnits} units
 * @returns {StageInfo}
 */
export function chartLoadStage(facts, units) {
  if (facts.preparing) {
    // The job is done and fresh metadata is on its way.
    if (facts.published) return { stage: 'opening' };
    if (facts.phase !== 'running') return { stage: 'queued', waiting: facts.phase === 'pending' };
    const progress = facts.progress;
    if (progress?.phase === 'loading') {
      const ratio = finite(progress.read_fraction);
      return {
        stage: 'loading',
        ratio: ratio === null ? null : clamp01(ratio),
        rows: finite(progress.rows) ?? 0
      };
    }
    if (progress?.phase === 'finishing') return { stage: 'finishing' };
    // Downloading, or running before the worker's first report.
    const bytes = finite(progress?.bytes);
    const length = finite(progress?.content_length);
    return {
      stage: 'downloading',
      ratio: bytes !== null && length !== null && length > 0 ? clamp01(bytes / length) : null,
      bytes,
      length
    };
  }
  if (facts.charting) {
    // Nothing has reported yet, or the chart code is still loading.
    if (!units.count || units.chunk > 0) return { stage: 'opening' };
    if (units.profile === 'failed') return { stage: 'failed' };
    if (units.profile !== 'settled') return { stage: 'profile' };
    if (units.charts.settled < units.charts.total) {
      return { stage: 'charts', settled: units.charts.settled, total: units.charts.total };
    }
    return { stage: 'done' };
  }
  return { stage: 'idle' };
}

/** @type {LoadRun} */
const idleRun = {
  status: 'idle',
  layout: null,
  info: { stage: 'idle' },
  stageSince: 0,
  settledCharts: 0,
  chartsSince: 0,
  rebase: null,
  value: 0,
  shown: 0,
  visibleAt: 0,
  doneSince: null,
  holdUntil: 0,
  now: 0,
  announced: null,
  wasVisible: false
};
export const IDLE_RUN = Object.freeze(idleRun);

/**
 * @param {StageInfo} info
 * @param {number} now
 * @param {boolean} immediate shown at once (it stands in for the preparation card)
 * @returns {LoadRun}
 */
function startRun(info, now, immediate) {
  const stage = /** @type {LoadStage} */ (info.stage);
  return {
    ...IDLE_RUN,
    status: 'running',
    layout: layoutFor(stage),
    info,
    stageSince: now,
    settledCharts: info.stage === 'charts' ? info.settled : 0,
    chartsSince: now,
    visibleAt: immediate ? now : now + SHOW_DELAY_MS,
    now
  };
}

/** @param {number} elapsed @param {number} tau */
const ease = (elapsed, tau) => 1 - Math.exp(-Math.max(0, elapsed) / tau);

/**
 * The value a running stage aims for at a moment.
 * @param {LoadRun} run
 * @param {number} now
 * @returns {{ target: number, rebase: Rebase | null }}
 */
function stageTarget(run, now) {
  const info = run.info;
  if (!run.layout || !isLoadStage(info.stage)) return { target: run.value, rebase: run.rebase };
  const stage = /** @type {LoadStage} */ (info.stage);
  const band = bandOf(run.layout, stage);
  if (!band) return { target: run.value, rebase: run.rebase };
  const [start, end] = band;
  const width = end - start;
  if (info.stage === 'charts') {
    const slot = width / Math.max(1, info.total);
    const settled = Math.min(info.settled, info.total);
    return {
      target: start + slot * (settled + EASE_CAP * ease(now - run.chartsSince, TAU_MS.charts)),
      rebase: run.rebase
    };
  }
  const ratio = info.stage === 'downloading' || info.stage === 'loading' ? info.ratio : null;
  if (ratio === null) {
    return {
      target: start + width * EASE_CAP * ease(now - run.stageSince, TAU_MS[stage]),
      rebase: run.rebase
    };
  }
  // A real figure places the value in its band directly (joining a job that is
  // already 90% downloaded shows that). If easing had already moved past that
  // place, what is left of the figure is mapped onto what is left of the band,
  // so the value does not stall.
  const direct = start + width * Math.min(RATIO_CAP, ratio);
  const rebase =
    run.rebase && run.rebase.stage === stage
      ? run.rebase
      : run.value <= direct
        ? { stage, v0: start, r0: 0 }
        : { stage, v0: run.value, r0: ratio };
  const share = rebase.r0 >= 1 ? 1 : (ratio - rebase.r0) / (1 - rebase.r0);
  return { target: rebase.v0 + (end - rebase.v0) * Math.min(RATIO_CAP, clamp01(share)), rebase };
}

/**
 * The card shows once a run has loaded for longer than its delay; a run that
 * finished before then is never shown, not even at 100%.
 * @param {LoadRun} run
 */
export function isRunVisible(run) {
  if (run.status === 'holding') return true;
  return (
    run.status === 'running' &&
    (run.wasVisible || (run.doneSince === null && run.now >= run.visibleAt))
  );
}

/**
 * @param {LoadRun} run
 * @param {{ type: 'observe', info: StageInfo, now: number, immediate?: boolean }
 *   | { type: 'tick', now: number, smooth?: boolean }} action
 * @returns {LoadRun}
 */
export function chartLoadReducer(run, action) {
  const now = action.now;
  if (action.type === 'observe') {
    const info = action.info;
    if (info.stage === 'idle' || info.stage === 'failed') {
      // Nothing to wait for, or the chart failed: no 100%, the card goes.
      return run.status === 'idle' ? run : { ...IDLE_RUN, now };
    }
    if (info.stage === 'done') {
      if (run.status !== 'running') return run;
      const wasVisible = run.wasVisible || (run.doneSince === null && now >= run.visibleAt);
      return { ...run, info, doneSince: run.doneSince ?? now, wasVisible, now };
    }
    const stage = /** @type {LoadStage} */ (info.stage);
    if (run.status !== 'running' || !run.layout || !bandOf(run.layout, stage)) {
      return startRun(info, now, Boolean(action.immediate));
    }
    const sameStage = run.info.stage === info.stage;
    const settled = info.stage === 'charts' ? info.settled : 0;
    const chartsMoved = info.stage === 'charts' && (!sameStage || settled !== run.settledCharts);
    return {
      ...run,
      info,
      doneSince: null,
      stageSince: sameStage ? run.stageSince : now,
      rebase: sameStage ? run.rebase : null,
      settledCharts: settled,
      chartsSince: chartsMoved ? now : run.chartsSince,
      visibleAt: action.immediate ? Math.min(run.visibleAt, now) : run.visibleAt,
      wasVisible: run.wasVisible || now >= run.visibleAt,
      now
    };
  }

  // tick
  if (run.status === 'idle') return run;
  if (run.status === 'holding')
    return now >= run.holdUntil ? { ...IDLE_RUN, now } : { ...run, now };
  const visible = run.wasVisible || (run.doneSince === null && now >= run.visibleAt);
  if (run.doneSince !== null && now - run.doneSince >= SETTLE_MS) {
    // Every chart has settled: 100%, held briefly if anyone saw the card.
    if (!visible) return { ...IDLE_RUN, now };
    return {
      ...run,
      status: 'holding',
      value: 100,
      shown: 100,
      holdUntil: now + HOLD_MS,
      announced: 'done',
      wasVisible: true,
      now
    };
  }
  const { target, rebase } = stageTarget(run, now);
  const value = Math.max(run.value, Math.min(TOP, target));
  const gap = value - run.shown;
  const shown =
    action.smooth === false || gap <= 0.5 ? value : run.shown + Math.max(0.5, gap * 0.35);
  const announced =
    run.info.stage !== run.announced && now - run.stageSince >= ANNOUNCE_MS
      ? run.info.stage
      : run.announced;
  return {
    ...run,
    value,
    shown: Math.min(value, shown),
    rebase,
    announced,
    wasVisible: visible,
    now
  };
}
