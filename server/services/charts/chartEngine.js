// The chart engine. For one snapshot of a table it reads a bounded sample,
// decides what each column is (profile.js, model.js), proposes charts
// (candidates.js), computes them all from the whole table in one scan
// (chartQueries.js) and keeps those whose numbers hold up (validate.js).
// Every chart surface asks this module; none of them classifies columns.
const { createHash } = require('crypto');
const AppError = require('../../utils/AppError');
const { createCache } = require('../../utils/cache');
const { requestSignal } = require('../../utils/requestContext');
const chartQueries = require('../../db/chartQueries');
const { buildWhereAndParams } = require('../../db/storeQueries');
const { samplePlan, profileSample } = require('./profile');
const { buildTableModel, publicModel, hiddenTwin, pinnedModel } = require('./model');
const { listCandidates, pickDiverse } = require('./candidates');
const { shapeCategory, shapeTime, shapeWide, detectTotalMembers, latestPeriod, periodRange } = require('./validate');
const { validateSpec, asMeasure } = require('./spec');
const { periodStart } = require('./periods');

// Part of every cache key: raise it when the rules change what a chart shows.
const ENGINE_VERSION = 2;
const TIMEOUTS = { sample: 6000, batch: 10000, filtered: 15000, custom: 12000 };
// What one scan may carry.
const BATCH = { sets: 8, cleaned: 4, plain: 8, wide: 36, specs: 14 };
const CHART_LIMIT = 6;
// A selection may scan the table this many times: the charts, a re-run
// without totals found among the groups, replacements for rejected charts,
// and the latest period of a table of figures.
const MAX_STATEMENTS = 6;
const SELECTION_BUDGET_MS = 20000;
const SLOTS = 3;
const SLOT_WAIT_MS = 3000;
const DETECT_LIMIT = 20;
const PIN_VALUES = 12;
const SQL_GRAINS = new Set(['day', 'month', 'quarter', 'year']);
const DAY_MS = 24 * 60 * 60 * 1000;

// Each cache holds a few hundred entries of bounded size: about 250 MB at
// worst, a few MB in practice (a model is 20-60 KB, a selection 10-40 KB).
const small = limit => value => value != null && Buffer.byteLength(JSON.stringify(value)) <= limit;
const modelCache = createCache({ name: 'chart-models', ttlMs: DAY_MS, negativeTtlMs: 0, maxEntries: 200, cacheable: small(512 * 1024) });
// Charts chosen for a table, also per value of a pinned column.
const selectionCache = createCache({ name: 'chart-selections', ttlMs: DAY_MS, negativeTtlMs: 0, maxEntries: 300, cacheable: small(256 * 1024) });
// Charts recomputed under a search or filters, and charts from the builder.
const viewCache = createCache({ name: 'chart-views', ttlMs: 5 * 60 * 1000, negativeTtlMs: 0, maxEntries: 200, cacheable: small(256 * 1024) });
// Work that ran out of time is not tried again for a while: every visitor
// would otherwise start the same long scan.
const TIMEOUT_MEMORY_MS = 60 * 1000;
const timedOut = new Map();

function publicError(message, status, code, extra = {}) {
    const error = new AppError(message, status);
    error.publicCode = code;
    return Object.assign(error, extra);
}

const timeoutError = () => publicError('The table is too large to chart right now', 503, 'CHARTS_TIMEOUT', { retryAfter: 30 });

function rememberTimeout(key) {
    const now = Date.now();
    for (const [entry, until] of timedOut) if (until <= now) timedOut.delete(entry);
    if (timedOut.size >= 500) timedOut.delete(timedOut.keys().next().value);
    timedOut.set(key, now + TIMEOUT_MEMORY_MS);
}
const timedOutRecently = key => (timedOut.get(key) || 0) > Date.now();

// Requests that need the same work share it. A request that joined another's
// computation does not share its fate: if that request ends and takes its
// reader with it, the joiner computes for itself.
async function shared(cache, key, compute, signal) {
    if (timedOutRecently(key)) throw timeoutError();
    let ran = false;
    const run = async () => {
        ran = true;
        try {
            return await compute();
        } catch (error) {
            if (error && error.publicCode === 'CHARTS_TIMEOUT') rememberTimeout(key);
            throw error;
        }
    };
    if (!signal) return cache.get(key, run);
    try {
        return await cache.get(key, run);
    } catch (error) {
        signal.throwIfAborted();
        // This request did the work, or the work itself failed: that is the answer.
        if (ran || (error && error.isOperational)) throw error;
        return cache.get(key, run, { deduplicate: false });
    }
}

// --- Scan slots -----------------------------------------------------------
// At most three chart scans run at once in a process; a fourth waits briefly
// and is then told to retry, so chart work can never take every connection.
const waiting = [];
let scanning = 0;

function permit() {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const next = waiting.shift();
        if (next) next();
        else scanning -= 1;
    };
}

function acquireSlot({ waitMs = SLOT_WAIT_MS, signal } = {}) {
    signal?.throwIfAborted();
    if (scanning < SLOTS) {
        scanning += 1;
        return Promise.resolve(permit());
    }
    return new Promise((resolve, reject) => {
        const settle = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        const grant = () => {
            settle();
            resolve(permit());
        };
        const leave = error => {
            const index = waiting.indexOf(grant);
            if (index >= 0) waiting.splice(index, 1);
            settle();
            reject(error);
        };
        const onAbort = () => leave(signal.reason);
        const timer = setTimeout(() => leave(publicError('Charts are busy, try again shortly', 503, 'CHARTS_BUSY')), waitMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        waiting.push(grant);
    });
}

// Runs work under a slot: the caller's, when it took one before taking a
// database connection, or one of its own.
async function withSlot({ permit: held, waitMs, signal } = {}, work) {
    if (held) return work();
    const release = await acquireSlot({ waitMs, signal });
    try {
        return await work();
    } finally {
        release();
    }
}

async function scan(run) {
    try {
        return await run();
    } catch (error) {
        // PostgreSQL cancelled the statement at its time limit.
        if (error && error.code === '57014') throw timeoutError();
        throw error;
    }
}

// --- Tables and keys ------------------------------------------------------

/** What the engine needs to know about a snapshot, from its catalogue row. */
function describeTable(row) {
    const count = row.ingested_row_count === null || row.ingested_row_count === undefined || row.ingested_row_count === '' ? NaN : Number(row.ingested_row_count);
    const at = row.ingested_at ? new Date(row.ingested_at) : null;
    return {
        tableName: row.table_name,
        columns: (Array.isArray(row.ingested_columns) ? row.ingested_columns : []).filter(column => column && column.id !== '_id'),
        rowCount: Number.isSafeInteger(count) && count >= 0 ? count : null,
        ingestedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null
    };
}

function tableKey(table) {
    const columns = createHash('sha256').update(JSON.stringify(table.columns)).digest('base64url').slice(0, 16);
    return [ENGINE_VERSION, table.tableName, table.ingestedAt, columns].join('|');
}

const foldLabel = label => String(label).toLowerCase().replace(/\s+/g, ' ').trim();
const sums = column => column.measure.additive === 'yes' || column.measure.additive === 'probable';
const refOf = column => ({ id: column.id, type: column.type });

/**
 * The model of a table: what its columns are and how to clean them. Read
 * once per snapshot from a bounded sample and kept for a day.
 */
async function getTableModel(table, { signal = requestSignal(), now } = {}) {
    return shared(modelCache, tableKey(table), async () => {
        const plan = samplePlan({ rowCount: table.rowCount, columns: table.columns });
        const rows = await scan(() => chartQueries.readSample({ tableName: table.tableName, columns: table.columns, plan }, { timeoutMs: TIMEOUTS.sample }));
        const profile = await profileSample({ columns: table.columns, rows, plan }, { signal });
        return buildTableModel(profile, { rowCount: table.rowCount, now });
    }, signal);
}

// Members that add other members up, as the model found them in the sample.
function totalsOf(model) {
    const totals = new Map();
    for (const column of model.columns) {
        const labels = column.category ? column.category.total_members : column.total_members;
        if (labels && labels.length) totals.set(column.id, new Set(labels.map(foldLabel)));
    }
    return totals;
}

// --- One scan -------------------------------------------------------------

// How a scan groups the rows by a time axis at a grain: the key, and whether
// keys sort as their periods do (a year, a bucketed date) or must all be read.
function timeKeyOf(model, axis, grain) {
    const columns = axis.columns.map(id => model.columns.find(column => column.id === id));
    let id = 'time:' + axis.id;
    let bucket = null;
    let ordered = true;
    let key;
    if (axis.kind === 'composite') {
        key = { kind: 'composite', year: refOf(columns[0]), part: refOf(columns[1]) };
        ordered = false;
    } else {
        const time = columns[0].time;
        if (time.kind === 'typed' || time.format === 'iso_date' || time.format === 'day_month_year') {
            bucket = SQL_GRAINS.has(grain) ? grain : 'year';
            key = time.format === 'day_month_year'
                ? { kind: 'day_first', column: refOf(columns[0]), order: time.order, grain: bucket }
                : { kind: 'date', column: refOf(columns[0]), grain: bucket };
            // Dates that stand for "no date" have no period.
            if (time.placeholders && time.placeholders.length) key.skip = time.placeholders;
            id += ':' + bucket;
        } else if (time.kind === 'year_number') key = { kind: 'category', column: refOf(columns[0]) };
        else {
            key = { kind: 'text', column: refOf(columns[0]) };
            ordered = false;
        }
    }
    return { id, key, bucket, ordered, columns };
}

// Turns chart specs into one batch: the ways of grouping they need (sets),
// the number columns they read (measures) and, for each spec, where its
// figures will be found. Specs that do not fit this scan are handed back.
function planBatch(model, specs, { totals = new Map(), lang = 'en', pinned = [], detect = true } = {}) {
    const byId = new Map(model.columns.map(column => [column.id, column]));
    const sets = [];
    const setIndex = new Map();
    const measures = [];
    const measureIndex = new Map();
    const used = { cleaned: 0, plain: 0, wide: 0 };
    const uses = [];
    const deferred = [];
    const held = new Set(pinned);

    // A measure read in its main unit only, unless the reader's own filter
    // already holds that column to a value, or the chart groups by it.
    const onlyOf = (column, groupBy) => (column.measure.only && !held.has(column.measure.only.column) && column.measure.only.column !== groupBy &&
        byId.has(column.measure.only.column) ? { column: refOf(byId.get(column.measure.only.column)), value: column.measure.only.value } : null);
    const measureKey = (column, groupBy) => column.id + (onlyOf(column, groupBy) ? '' : '|all');
    const measureFits = (column, wide, groupBy) => measureIndex.has(measureKey(column, groupBy)) ||
        (wide ? used.wide < BATCH.wide : column.measure.text ? used.cleaned < BATCH.cleaned : used.plain < BATCH.plain);
    const measureOf = (column, wide = false, groupBy = null) => {
        const key = measureKey(column, groupBy);
        if (measureIndex.has(key)) return measureIndex.get(key);
        used[wide ? 'wide' : column.measure.text ? 'cleaned' : 'plain'] += 1;
        measureIndex.set(key, measures.length);
        measures.push({ column: refOf(column), clean: column.measure.clean, only: onlyOf(column, groupBy), model: column });
        return measures.length - 1;
    };
    const setFits = id => setIndex.has(id) || sets.length < BATCH.sets;
    const setOf = (id, key, rank, extra = {}) => {
        if (!setIndex.has(id)) {
            setIndex.set(id, sets.length);
            sets.push({ id, key, rank: [], ...extra });
        }
        const set = sets[setIndex.get(id)];
        const same = set.rank.find(entry => entry.by === rank.by && entry.measure === rank.measure);
        if (same) same.limit = Math.max(same.limit, rank.limit);
        else set.rank.push({ ...rank });
        return setIndex.get(id);
    };

    for (const spec of specs) {
        if (spec.x.type === 'wide') {
            const group = model.wide_groups.find(entry => entry.id === spec.x.group);
            const columns = group.columns.slice(-BATCH.wide).map(entry => byId.get(entry.id));
            const fresh = columns.filter(column => !measureIndex.has(measureKey(column, null))).length;
            if (used.wide + fresh > BATCH.wide) {
                deferred.push(spec);
                continue;
            }
            uses.push({ spec, type: 'wide', group, columns, indexes: columns.map(column => measureOf(column, true)) });
            continue;
        }
        const measure = spec.y.agg === 'count' ? null : asMeasure(byId.get(spec.y.column));
        if (spec.x.type === 'time') {
            const axis = model.time_axes.find(entry => entry.id === spec.x.axis);
            const { id, key, bucket, ordered, columns } = timeKeyOf(model, axis, spec.x.grain);
            if (!setFits(id) || (measure && !measureFits(measure, false))) {
                deferred.push(spec);
                continue;
            }
            const j = measure ? measureOf(measure) : null;
            // Keys that sort in SQL give the latest periods; others are all needed.
            const set = setOf(id, key, ordered ? { by: 'key', limit: Math.min(1000, (spec.limit || 60) + 40) } : { by: 'n', limit: 1000 }, { time: true });
            uses.push({ spec, type: 'time', set, j, measure, axis: { ...axis, bucket }, columns, ordered });
            continue;
        }
        const column = byId.get(spec.x.column);
        const id = 'category:' + column.id;
        if (!setFits(id) || (measure && !measureFits(measure, false, column.id))) {
            deferred.push(spec);
            continue;
        }
        const j = measure ? measureOf(measure, false, column.id) : null;
        const limit = Math.min(1000, (spec.limit || 12) + 8);
        // Figures below zero beside figures above it (cuts beside increases):
        // the largest either way are shown, not only the largest increases.
        const signed = measure && spec.y.agg === 'sum' && measure.measure.min !== null && measure.measure.min < 0;
        const set = setOf(id, { kind: 'category', column: refOf(column) },
            j === null ? { by: 'n', limit } : { by: signed ? 'abs' : spec.y.agg, measure: j, limit });
        uses.push({ spec, type: 'category', set, j, measure, column });
    }

    // Totals hide among the members of any column, so every category set is
    // also ranked by the first quantity that adds up, and columns that no chart
    // groups by are looked at while there is room.
    // The quantity to look for totals by: one that a chart adds up, else the first that adds up at all.
    const summed = uses.find(use => use.spec.y.agg === 'sum' && (use.type === 'wide' ? use.indexes.length : use.j !== null));
    const detectBy = !detect ? -1 : summed ? (summed.type === 'wide' ? summed.indexes[summed.indexes.length - 1] : summed.j)
        : measures.findIndex(measure => sums(measure.model));
    if (detectBy >= 0) {
        for (const set of sets) {
            if (!set.time) setOf(set.id, set.key, { by: 'sum', measure: detectBy, limit: DETECT_LIMIT });
        }
        const others = model.columns.filter(column => (column.role === 'category' || column.role === 'code') && column.category.distinct <= 200 &&
            !hiddenTwin(column, lang) && !held.has(column.id) && !setIndex.has('category:' + column.id))
            .sort((a, b) => a.category.distinct - b.category.distinct);
        for (const column of others) {
            if (sets.length >= BATCH.sets) break;
            setOf('category:' + column.id, { kind: 'category', column: refOf(column) }, { by: 'sum', measure: detectBy, limit: DETECT_LIMIT }, { detection: true });
        }
    }

    const totalList = [...totals.entries()].filter(([id, labels]) => byId.has(id) && labels.size > 0)
        .map(([id, labels]) => ({ column: refOf(byId.get(id)), labels: [...labels] }));
    return { sets, measures, uses, deferred, detectBy: detectBy >= 0 ? detectBy : null, totals: totalList,
        table: { records: model.records, blankTokens: new Set(model.blank_tokens || []) } };
}

async function runPlan(table, model, plan, { where, timeoutMs, scope = null }) {
    const result = await scan(() => chartQueries.runBatch({
        tableName: table.tableName, where, scope, excluded: model.excluded_rows, totals: plan.totals,
        sets: plan.sets.map(set => ({ key: set.key, rank: set.rank })),
        measures: plan.measures.map(measure => ({ column: measure.column, clean: measure.clean, only: measure.only,
            sentinels: (measure.model && measure.model.measure && measure.model.measure.sentinels) || [] }))
    }, { timeoutMs }));
    if (!result.grand) throw new AppError('chart batch returned no totals', 500);
    return result;
}

// Members that add the others up, in any category set of a finished scan.
function detect(plan, result) {
    const totals = [];
    const levels = [];
    plan.sets.forEach((set, index) => {
        if (set.time || set.key.kind !== 'category') return;
        const ranked = plan.detectBy !== null && set.rank.some(rank => rank.by === 'sum' && rank.measure === plan.detectBy);
        const found = detectTotalMembers(result.sets[index], result.grand, ranked ? plan.detectBy : null, plan.table);
        for (const total of found.totals) totals.push({ column: set.key.column.id, ...total });
        if (found.levels) levels.push(set.key.column.id);
    });
    return { totals, levels };
}

function shapeUse(use, result, model, { gates, filtered }) {
    const { spec } = use;
    const grand = result.grand;
    let shaped;
    if (use.type === 'wide') shaped = shapeWide(spec, grand, { group: use.group, columns: use.columns, indexes: use.indexes, filtered, gates });
    else if (use.type === 'time') {
        shaped = shapeTime(spec, result.sets[use.set], grand, { axis: use.axis, columns: use.columns, measure: use.measure, j: use.j,
            ordered: use.ordered, filtered, gates });
    } else {
        const groups = result.sets[use.set];
        // Every group came back: their rows must add up to the rows in scope.
        if (groups.length && groups.length === groups[0].groups && groups.reduce((sum, group) => sum + group.n, 0) !== grand.n) {
            return { ok: false, reason: 'inconsistent_counts' };
        }
        shaped = shapeCategory(spec, groups, grand, { column: use.column, measure: use.measure, j: use.j, filtered, gates,
            blankTokens: new Set(model.blank_tokens || []), records: model.records });
        if (shaped.ok && spec.y.latest) {
            const group = model.wide_groups.find(entry => entry.id === spec.y.of);
            const last = group && group.columns[group.columns.length - 1];
            if (last) shaped.chart.notes.push({ code: 'wide_latest_period', level: 'info', start: periodStart(group.grain, last.ord), grain: group.grain });
        }
    }
    if (!shaped.ok) return shaped;
    const chart = shaped.chart;
    chart.title = { code: spec.template, measure: chart.y.label, by: chart.x.label };
    chart.spec = builderSpec(spec);
    return shaped;
}

/** A chart's spec in the vocabulary of the custom builder (spec.js). */
function builderSpec(spec) {
    const x = spec.x.type === 'time' ? { time: spec.x.axis, grain: spec.x.grain }
        : spec.x.type === 'wide' ? { wide: spec.x.group } : { column: spec.x.column };
    const y = spec.y.agg === 'count' ? { agg: 'count' } : spec.y.group ? { agg: spec.y.agg } : { agg: spec.y.agg, column: spec.y.column };
    return { kind: spec.kind, x, y, limit: spec.limit || null };
}

const skipOf = (spec, reason) => ({ id: spec.id, template: spec.template, x: spec.x, y: spec.y, reason });

function addTotals(totals, found) {
    let added = false;
    for (const total of found) {
        const labels = totals.get(total.column) || new Set();
        const label = foldLabel(total.key);
        if (!labels.has(label)) {
            labels.add(label);
            added = true;
        }
        totals.set(total.column, labels);
    }
    return added;
}

function whereOf(table, { q, filters } = {}) {
    if (!q && !(filters && filters.length)) return null;
    const { whereSql, params } = buildWhereAndParams({ knownColumns: table.columns.map(column => column.id), q, filters: filters || [] });
    return whereSql ? { whereSql, params } : null;
}

// The largest members of each column a scan grouped by.
function noteValues(values, plan, result) {
    plan.sets.forEach((set, index) => {
        if (set.time || set.key.kind !== 'category') return;
        // The filter must match the stored spelling exactly: a value cut short cannot.
        values.set(set.key.column.id, result.sets[index]
            .filter(group => group.n > 0 && group.label !== '' && typeof group.raw === 'string' && group.raw.length < 200)
            .sort((a, b) => b.n - a.n).slice(0, PIN_VALUES).map(group => ({ value: group.raw, label: group.label, rows: group.n })));
    });
}

// The columns that keep a measure from being added up, with their largest
// members, so a page can offer them as filters ("show one measure at a time").
function blockedOf(model, lang, pinned, values, levels) {
    const held = new Set(pinned);
    const byId = new Map(model.columns.map(column => [column.id, column]));
    const out = [];
    const seen = new Set();
    const valuesOf = id => values.get(id) || [];
    for (const column of model.columns) {
        if (column.role !== 'measure' || hiddenTwin(column, lang)) continue;
        for (const block of column.measure.blocked_by) {
            const by = byId.get(block.column);
            if (!by || held.has(block.column) || seen.has(column.id + '|' + block.column)) continue;
            // A twin pair is offered once, in the reader's language; a pin on either holds it.
            if (by.twin && (held.has(by.twin.of) || hiddenTwin(by, lang))) continue;
            seen.add(column.id + '|' + block.column);
            out.push({ measure: column.id, measure_label: column.label, column: block.column, column_label: byId.get(block.column).label, why: block.why,
                values: valuesOf(block.column) });
        }
    }
    for (const id of levels) {
        if (!byId.has(id) || held.has(id)) continue;
        out.push({ measure: null, measure_label: null, column: id, column_label: byId.get(id).label, why: 'mixed_levels', values: valuesOf(id) });
    }
    return out.slice(0, 8);
}

/**
 * Chooses the charts of a table: every candidate that fits is computed in
 * one scan, checked, and kept or set aside with its reason.
 *
 * @param {object} table from describeTable()
 * @param {object} model from getTableModel()
 * @param {{ lang?: 'en' | 'fr', pins?: Array<{ column: string, op: 'eq', value: unknown }> }} [options]
 *   pins: equality filters on the columns that keep a measure from being added up
 */
async function computeSelection(table, model, { lang = 'en', pins = [] } = {}) {
    const started = Date.now();
    const pinned = pins.map(pin => pin.column);
    const where = whereOf(table, { filters: pins });
    const totals = totalsOf(model);
    // The first scan tries a varied set, so a table with two strong measures
    // still gets its counts looked at without a second scan.
    const candidates = listCandidates(model, { lang, pinned });
    // Groups of a table of figures are compared in its latest period, which
    // the first scans find: those charts wait for them.
    const later = candidates.filter(spec => spec.scope);
    const first = candidates.filter(spec => !spec.scope);
    const lead = pickDiverse(first, { limit: 10 });
    let queue = [...lead, ...first.filter(spec => !lead.includes(spec))];
    let pending = [];
    const accepted = new Map();
    const skipped = new Map();
    const stats = new Map();
    const levels = new Set();
    const values = new Map();
    let statements = 0;
    let slowest = 0;
    // What the time sets found: each measure's latest period on an axis, and each axis's span.
    const latest = new Map();
    const ranges = new Map();
    const notePeriods = (use, result) => {
        const groups = result.sets[use.set];
        // A set that kept only its largest periods cannot tell which is the latest.
        if (!use.ordered && groups.length && groups.length < groups[0].groups) return;
        const context = { axis: use.axis, columns: use.columns, grain: use.spec.x.grain };
        const key = (use.spec.y.column || '') + '|' + use.axis.id;
        if (use.spec.y.column && !latest.has(key)) latest.set(key, latestPeriod(groups, { ...context, j: use.j }));
        if (!ranges.has(use.axis.id)) ranges.set(use.axis.id, periodRange(groups, { ...context, rows: result.grand.n }));
    };

    // Columns that block a measure are grouped by even when no chart can be
    // drawn, to offer their values as filters.
    const byId = new Map(model.columns.map(column => [column.id, column]));
    const blockers = [...new Set(model.columns.filter(column => column.role === 'measure' && !hiddenTwin(column, lang))
        .flatMap(column => column.measure.blocked_by.map(block => block.column))
        .filter(id => !pinned.includes(id) && !(byId.get(id) && hiddenTwin(byId.get(id), lang))))];

    while (statements < MAX_STATEMENTS) {
        const remaining = SELECTION_BUDGET_MS - (Date.now() - started);
        // Another round only when it can finish in the time left.
        if (statements > 0 && remaining < Math.max(2000, slowest * 1.5)) break;
        const specs = pending.slice();
        while (queue.length && specs.length < BATCH.specs) specs.push(queue.shift());
        const plan = planBatch(model, specs, { totals, lang, pinned });
        queue = [...plan.deferred.filter(spec => !pending.includes(spec)), ...queue];
        // Deferred specs that were being recomputed cannot be shown: their figures predate the totals found.
        for (const spec of plan.deferred) if (pending.includes(spec)) skipped.set(spec.id, skipOf(spec, 'not_recomputed'));
        if (statements === 0) {
            for (const id of blockers) {
                if (plan.sets.length >= BATCH.sets || plan.sets.some(set => set.id === 'category:' + id)) continue;
                const column = model.columns.find(entry => entry.id === id);
                if (column) plan.sets.push({ id: 'category:' + id, key: { kind: 'category', column: refOf(column) }, rank: [{ by: 'n', limit: PIN_VALUES + 4 }], pins: true });
            }
        }
        // Nothing to draw and nothing to offer: the table is not read at all.
        if (!plan.uses.length && !plan.sets.length) break;
        const began = Date.now();
        let result;
        try {
            result = await runPlan(table, model, plan, { where, timeoutMs: Math.max(1000, Math.min(TIMEOUTS.batch, remaining)) });
        } catch (error) {
            // A later round that runs out of time keeps what the earlier ones found.
            if (statements === 0 || !error || error.publicCode !== 'CHARTS_TIMEOUT') throw error;
            for (const use of plan.uses) if (!pending.includes(use.spec)) queue.unshift(use.spec);
            break;
        }
        slowest = Math.max(slowest, Date.now() - began);
        statements += 1;
        noteValues(values, plan, result);
        const found = detect(plan, result);
        for (const id of found.levels) levels.add(id);
        if (addTotals(totals, found.totals)) {
            // Rows of a total are in every figure computed so far: all of it is computed again without them.
            pending = [...new Set([...[...accepted.values()].map(entry => entry.spec), ...plan.uses.map(use => use.spec)])];
            accepted.clear();
            stats.clear();
            continue;
        }
        pending = [];
        plan.measures.forEach((measure, j) => stats.set(measure.column.id, result.grand.measures[j]));
        stats.set('', { n: result.grand.n, nx: result.grand.nx });
        for (const use of plan.uses) {
            if (use.type === 'time') notePeriods(use, result);
            const shaped = shapeUse(use, result, model, { gates: true, filtered: pins.length > 0 });
            if (!shaped.ok) skipped.set(use.spec.id, skipOf(use.spec, shaped.reason));
            else accept(accepted, skipped, use.spec, shaped.chart);
        }
        if (!queue.length || pickDiverse(chartsOf(accepted, levels), { limit: CHART_LIMIT }).length >= CHART_LIMIT) break;
    }

    // The groups of a table of figures, in the latest period each measure has
    // figures for: one scan per period (nearly always one).
    const periodGroups = new Map();
    for (const spec of later) {
        const info = latest.get(spec.y.column + '|' + spec.scope.axis);
        if (!info) {
            skipped.set(spec.id, skipOf(spec, 'no_periods'));
            continue;
        }
        const key = spec.scope.axis + SEPARATOR + info.keys.join(SEPARATOR);
        if (!periodGroups.has(key)) periodGroups.set(key, { axis: spec.scope.axis, info, specs: [] });
        periodGroups.get(key).specs.push(spec);
    }
    for (const group of periodGroups.values()) {
        const remaining = SELECTION_BUDGET_MS - (Date.now() - started);
        const specs = group.specs.slice(0, BATCH.specs);
        if (statements >= MAX_STATEMENTS || remaining < Math.max(2000, slowest * 1.5)) {
            for (const spec of specs) skipped.set(spec.id, skipOf(spec, 'not_tried'));
            continue;
        }
        for (const spec of specs) spec.period = { axis: group.axis, grain: group.info.grain, start: group.info.start, keys: group.info.keys };
        let ran;
        const began = Date.now();
        try {
            ran = await runWithTotals(table, model, specs, { totals, where, scope: scopeOf(model, specs[0].period),
                timeoutMs: Math.max(1000, Math.min(TIMEOUTS.batch, remaining)), lang, pinned, detectByValue: true });
        } catch (error) {
            if (!error || error.publicCode !== 'CHARTS_TIMEOUT') throw error;
            for (const spec of specs) skipped.set(spec.id, skipOf(spec, 'not_tried'));
            break;
        }
        slowest = Math.max(slowest, Date.now() - began);
        statements += ran.passes;
        if (!ran.result) continue;
        for (const use of ran.plan.uses) {
            const shaped = ran.unresolved ? { ok: false, reason: 'totals_unresolved' } : shapeUse(use, ran.result, model, { gates: true, filtered: pins.length > 0 });
            if (!shaped.ok) skipped.set(use.spec.id, skipOf(use.spec, shaped.reason));
            else accept(accepted, skipped, use.spec, shaped.chart);
        }
    }
    // A table of things or events: its groups count every period; say which.
    const span = [...ranges.values()].find(Boolean);
    if (model.records && span) {
        for (const entry of accepted.values()) if (entry.chart.x.type === 'category') entry.chart.span = span;
    }
    // Totals were found and could not be taken out in the scans allowed.
    for (const spec of pending) skipped.set(spec.id, skipOf(spec, 'totals_unresolved'));
    for (const spec of queue.slice(0, 12)) if (!skipped.has(spec.id)) skipped.set(spec.id, skipOf(spec, 'not_tried'));

    const charts = chartsOf(accepted, levels);
    for (const entry of accepted.values()) {
        if (!charts.includes(entry.chart)) skipped.set(entry.spec.id, skipOf(entry.spec, 'mixed_levels'));
    }
    // A table that was not read: its row count is the snapshot's (unknown under a pin).
    const grand = stats.get('') || { n: pins.length ? null : model.rows, nx: 0 };
    return {
        charts,
        specs: Object.fromEntries(charts.map(chart => [chart.id, accepted.get(chart.id).spec])),
        skipped: [...skipped.values()].filter(entry => !accepted.has(entry.id) || entry.reason === 'mixed_levels'),
        totals: [...totals.entries()].map(([column, labels]) => [column, [...labels]]),
        blocked: blockedOf(model, lang, pinned, values, [...levels]),
        measures: Object.fromEntries([...stats.entries()].filter(([id]) => id !== '')),
        rows: grand.n, total_rows: grand.nx, statements
    };
}

const SEPARATOR = String.fromCharCode(30);

// The rows of one period of an axis, as the scan grouped them.
function scopeOf(model, period) {
    if (!period) return null;
    const axis = model.time_axes.find(entry => entry.id === period.axis);
    return axis ? { key: timeKeyOf(model, axis, axis.grain).key, keys: period.keys } : null;
}

// A chart of the latest period says so on itself.
function withPeriod(chart, spec) {
    if (!spec.period) return chart;
    chart.period = { grain: spec.period.grain, start: spec.period.start };
    chart.notes.push({ code: 'latest_period_only', level: 'info', start: spec.period.start, grain: spec.period.grain });
    return chart;
}

// Keeps a chart unless it repeats one already kept: the same figures under
// another column (a code beside its name, a column in each language), or the
// same groups in the same proportions (hectares beside square metres).
function accept(accepted, skipped, spec, chart) {
    withPeriod(chart, spec);
    const figures = signatureOf(chart);
    const same = [...accepted.values()].find(entry => (entry.figures === figures && entry.chart.x.column !== chart.x.column) ||
        proportional(entry.chart, chart));
    if (same && same.spec.score >= spec.score) {
        skipped.set(spec.id, skipOf(spec, 'same_as_other_chart'));
        return;
    }
    if (same) {
        accepted.delete(same.spec.id);
        skipped.set(same.spec.id, skipOf(same.spec, 'same_as_other_chart'));
    }
    accepted.set(spec.id, { spec, chart, figures });
}

// Two charts of the same groups whose figures are one multiple of the other.
function proportional(a, b) {
    // Two or three groups can line up by chance; four or more in step are one chart.
    if (a.id === b.id || a.x.type !== b.x.type || (a.x.column || a.x.axis) !== (b.x.column || b.x.axis) || a.points.length !== b.points.length ||
        a.points.length < 4) return false;
    let ratio = null;
    for (let i = 0; i < a.points.length; i += 1) {
        const p = a.points[i];
        const q = b.points[i];
        if ((p.label ?? p.start ?? null) !== (q.label ?? q.start ?? null) || Boolean(p.blank) !== Boolean(q.blank)) return false;
        if (p.value === 0 || q.value === 0) {
            if (p.value !== q.value) return false;
            continue;
        }
        const r = q.value / p.value;
        if (ratio === null) ratio = r;
        // Within three percent the two draw the same picture.
        else if (Math.abs(r - ratio) > Math.abs(ratio) * 0.03) return false;
    }
    return ratio !== null;
}

// What a chart of groups draws, apart from the column it groups by.
function signatureOf(chart) {
    if (chart.x.type !== 'category') return chart.id;
    return JSON.stringify([chart.y.agg, chart.y.column, chart.points.map(point => (point.blank ? null : Number(point.value.toPrecision(12))))]);
}

// Accepted charts, best first. A column that mixes totals, subtotals and
// their parts spoils every figure added up across it.
function chartsOf(accepted, levels) {
    return [...accepted.values()].map(entry => entry.chart)
        .filter(chart => levels.size === 0 || chart.y.agg === 'count')
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

// Equality filters on a column that keeps a measure from being added up
// change which charts make sense; every other filter only narrows the rows.
function pinsOf(model, filters = []) {
    const blockers = new Set(model.columns.filter(column => column.measure).flatMap(column => column.measure.blocked_by.map(block => block.column)));
    // Either column of a twin pair holds the pair to one value.
    for (const column of model.columns) if (column.twin && blockers.has(column.twin.of)) blockers.add(column.id);
    return filters.filter(filter => filter.op === 'eq' && filter.value !== null && filter.value !== '' && blockers.has(filter.column));
}

const langKey = (model, lang) => (model.columns.some(column => column.twin && column.twin.lang) ? (lang === 'fr' ? 'fr' : 'en') : '-');

function selectionKey(table, model, lang, pins) {
    return tableKey(table) + '|s|' + langKey(model, lang) + '|' + JSON.stringify(pins.map(pin => [pin.column, pin.value]).sort());
}

async function getSelection(table, model, { lang, pins, signal = requestSignal() }) {
    return shared(selectionCache, selectionKey(table, model, lang, pins), () => computeSelection(table, model, { lang, pins }), signal);
}

// Scans a plan again while it keeps finding totals by their name, at most
// three times. Specs whose figures still hold a total are not shown.
async function runWithTotals(table, model, specs, { totals, where, scope = null, timeoutMs, lang, pinned, detectByValue }) {
    let plan;
    let result;
    let unresolved = false;
    let passes = 0;
    for (let pass = 0; pass < 3; pass += 1) {
        plan = planBatch(model, specs, { totals, lang, pinned, detect: detectByValue });
        if (!plan.uses.length) return { plan, result: null, unresolved: false, passes };
        result = await runPlan(table, model, plan, { where, scope, timeoutMs });
        passes += 1;
        unresolved = addTotals(totals, detect(plan, result).totals);
        if (!unresolved) break;
    }
    return { plan, result, unresolved, passes };
}

// The charts of a selection under a search or more filters: the same charts,
// recomputed on the rows in scope. Only integrity is checked.
async function computeView(table, model, selection, charts, { where, pinned = [] }) {
    const totals = new Map(selection.totals.map(([column, labels]) => [column, new Set(labels)]));
    const specs = charts.map(chart => selection.specs[chart.id]);
    // Charts of a table's latest period stay in that period: one scan per period.
    const groups = new Map();
    for (const spec of specs) {
        const key = spec.period ? spec.period.axis + SEPARATOR + spec.period.keys.join(SEPARATOR) : '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(spec);
    }
    const shapedOf = new Map();
    let measures = {};
    let rows = null;
    let totalRows = null;
    for (const [key, list] of groups) {
        // A total that only shows under this search is found by its name; totals
        // found by their value when the charts were chosen stay left out.
        const { plan, result, unresolved } = await runWithTotals(table, model, list, { totals, where, scope: scopeOf(model, list[0].period),
            timeoutMs: TIMEOUTS.filtered, pinned, detectByValue: false });
        const deferred = new Set(plan.deferred);
        for (const spec of list) {
            const use = plan.uses.find(entry => entry.spec === spec);
            const shaped = !use || !result || deferred.has(spec) || unresolved
                ? { ok: false, reason: unresolved ? 'totals_unresolved' : 'not_recomputed' }
                : shapeUse(use, result, model, { gates: false, filtered: true });
            if (shaped.ok) withPeriod(shaped.chart, spec);
            shapedOf.set(spec, shaped);
        }
        // The rows in scope are those of the search, not of one period.
        if (key === '' && result) {
            measures = Object.fromEntries(plan.measures.map((measure, j) => [measure.column.id, result.grand.measures[j]]));
            rows = result.grand.n;
            totalRows = result.grand.nx;
        }
    }
    const out = [];
    const skipped = [];
    specs.forEach((spec, index) => {
        const shaped = shapedOf.get(spec);
        if (!shaped.ok) {
            skipped.push(skipOf(spec, shaped.reason));
            return;
        }
        if (charts[index].span) shaped.chart.span = charts[index].span;
        out.push(shaped.chart);
    });
    return { charts: out, skipped, measures, rows, total_rows: totalRows };
}

// The figures above the charts: rows in scope, the period covered, and the
// totals or averages of the measures the charts show.
function kpisOf(model, charts, measures, rows) {
    const byId = new Map(model.columns.map(column => [column.id, column]));
    const kpis = [{ role: 'rows', value: rows }];
    const time = charts.find(chart => chart.time);
    if (time) kpis.push({ role: 'span', grain: time.time.grain, first: time.time.first, last: time.time.last });
    const seen = new Set();
    for (const chart of charts) {
        if (kpis.length >= 4) break;
        const id = chart.y.column;
        const stat = id ? measures[id] : null;
        const column = id ? byId.get(id) : null;
        if (!stat || !column || !column.measure || seen.has(id) || stat.n === 0 || chart.template === 'wide_top_rows_latest') continue;
        seen.add(id);
        const total = chart.y.agg === 'sum';
        kpis.push({ role: total ? 'sum' : 'avg', column: id, label: column.label, value: total ? stat.sum : stat.sum / stat.n,
            lower_bound: total && stat.missing > 0, integer: total && column.measure.integer, percent: column.measure.percent,
            currency: column.measure.currency, unit: column.measure.unit || null });
    }
    const groups = charts.find(chart => chart.x.type === 'category' && chart.scope.groups_total > 1);
    if (groups && kpis.length < 4) kpis.push({ role: 'groups', column: groups.x.column, label: groups.x.label, value: groups.scope.groups_total });
    return kpis;
}

function pickFor(charts, { purpose = 'tab', limit = CHART_LIMIT }) {
    const fit = purpose === 'card' || purpose === 'social' ? purpose : 'tab';
    return pickDiverse(charts.filter(chart => chart.fit[fit]), { limit });
}

const viewKey = (table, model, { lang, purpose, limit, q, filters }) => tableKey(table) + '|v|' + langKey(model, lang) + '|' +
    JSON.stringify([purpose, limit, q || null, (filters || []).map(filter => [filter.column, filter.op, filter.value])]);

/** Is everything this analysis needs already computed? Then it needs no scan and no slot. */
function isWarm(table, { lang = 'en', q, filters = [], purpose = 'tab', limit = CHART_LIMIT } = {}) {
    // Work that timed out a moment ago is answered at once, without a slot.
    if (timedOutRecently(tableKey(table))) return true;
    const model = modelCache.peek(tableKey(table));
    if (!model) return false;
    const pins = pinsOf(model, filters);
    const key = selectionKey(table, model, lang, pins);
    if (timedOutRecently(key)) return true;
    const selection = selectionCache.peek(key);
    if (!selection) return false;
    if (!q && filters.length === pins.length) return true;
    // Under a search, only the charts chosen are computed again: none, nothing to do.
    if (!pickFor(selection.charts, { purpose, limit }).length) return true;
    const view = viewKey(table, model, { lang, purpose, limit, q, filters });
    return timedOutRecently(view) || viewCache.peek(view) !== undefined;
}

/**
 * The charts of a table for a page: chosen once per snapshot, recomputed on
 * the rows in scope when the visitor searches or filters.
 *
 * @param {object} table from describeTable()
 * @param {{ lang?: 'en' | 'fr', q?: string, filters?: object[], purpose?: 'tab' | 'card' | 'social', limit?: number,
 *   permit?: Function, waitMs?: number, signal?: AbortSignal }} [options]
 */
async function analyzeSnapshot(table, options = {}) {
    const { lang = 'en', q, filters = [], purpose = 'tab', limit = CHART_LIMIT, signal = requestSignal() } = options;
    const work = async () => {
        const base = await getTableModel(table, { signal });
        const pins = pinsOf(base, filters);
        const model = pinnedModel(base, pins);
        const selection = await getSelection(table, model, { lang, pins, signal });
        const picked = pickFor(selection.charts, { purpose, limit });
        const narrowed = Boolean(q) || filters.length > pins.length;
        let view = { charts: picked, skipped: selection.skipped, measures: selection.measures, rows: selection.rows, total_rows: selection.total_rows };
        if (narrowed && picked.length) {
            view = await shared(viewCache, viewKey(table, model, { lang, purpose, limit, q, filters }),
                () => computeView(table, model, selection, picked, { where: whereOf(table, { q, filters }),
                    pinned: filters.filter(filter => filter.op === 'eq' && filter.value !== null).map(filter => filter.column) }), signal);
        } else if (narrowed) view = { ...view, rows: null, total_rows: null };
        return {
            engine: ENGINE_VERSION,
            status: view.charts.length ? 'ok' : 'no_charts',
            kpis: view.rows === null || view.rows === undefined ? [] : kpisOf(model, view.charts, view.measures, view.rows),
            charts: view.charts,
            skipped: view.skipped.slice(0, 16),
            blocked: selection.blocked,
            model: publicModel(model, lang),
            builder: { default: (view.charts[0] || selection.charts[0] || {}).spec || null },
            scope: { rows: view.rows, table_rows: model.rows, filtered: narrowed || pins.length > 0, pinned: pins.map(pin => pin.column),
                total_rows_left_out: view.total_rows, note_rows_left_out: model.excluded_notes ?? model.excluded_rows.length }
        };
    };
    if (isWarm(table, { lang, q, filters, purpose, limit })) return work();
    return withSlot({ permit: options.permit, waitMs: options.waitMs, signal }, work);
}

const customKey = (table, spec, q, filters) => tableKey(table) + '|c|' + JSON.stringify([spec.kind, spec.x, spec.y, spec.limit, q || null,
    filters.map(filter => [filter.column, filter.op, filter.value])]);

/**
 * One chart asked for by name: the custom builder, and charts picked by hand.
 * The request is checked against the table's model (spec.js); only integrity
 * is checked on the result, because the reader asked for this chart.
 *
 * @param {object} table from describeTable()
 * @param {object} raw the chart as the builder describes it
 * @returns {Promise<{ chart: object | null, reason: string | null }>}
 */
async function customChart(table, raw, options = {}) {
    const { lang = 'en', q, filters = [], signal = requestSignal() } = options;
    const pinned = filters.filter(filter => filter.op === 'eq' && filter.value !== null).map(filter => filter.column);
    const keyOf = spec => customKey(table, spec, q, filters);
    const warm = modelCache.peek(tableKey(table));
    if (warm) {
        const hit = viewCache.peek(keyOf(validateSpec(raw, pinnedModel(warm, pinsOf(warm, filters)), { lang, pinned })));
        if (hit !== undefined) return hit;
    }
    return withSlot({ permit: options.permit, waitMs: options.waitMs, signal }, async () => {
        const base = await getTableModel(table, { signal });
        const model = pinnedModel(base, pinsOf(base, filters));
        const spec = validateSpec(raw, model, { lang, pinned });
        return shared(viewCache, keyOf(spec), async () => {
            const where = whereOf(table, { q, filters });
            const { plan, result, unresolved } = await runWithTotals(table, model, [spec], { totals: totalsOf(model), where, timeoutMs: TIMEOUTS.custom,
                lang, pinned, detectByValue: true });
            if (!plan.uses.length) throw publicError('This chart cannot be computed', 400, 'INVALID_CHART_SPEC');
            if (unresolved) return { chart: null, reason: 'totals_unresolved' };
            const shaped = shapeUse(plan.uses[0], result, model, { gates: false, filtered: Boolean(where) });
            return shaped.ok ? { chart: shaped.chart, reason: null } : { chart: null, reason: shaped.reason };
        }, signal);
    });
}

/** Is this chart already computed? Throws what customChart() would for a request the table cannot answer. */
function isCustomWarm(table, raw, { lang = 'en', q, filters = [] } = {}) {
    const model = modelCache.peek(tableKey(table));
    if (!model) return false;
    const pinned = filters.filter(filter => filter.op === 'eq' && filter.value !== null).map(filter => filter.column);
    return viewCache.peek(customKey(table, validateSpec(raw, model, { lang, pinned }), q, filters)) !== undefined;
}

function clearCaches() {
    modelCache.clear();
    selectionCache.clear();
    viewCache.clear();
    timedOut.clear();
}

module.exports = {
    ENGINE_VERSION, CHART_LIMIT, TIMEOUTS, BATCH,
    describeTable, getTableModel, analyzeSnapshot, customChart, isWarm, isCustomWarm, acquireSlot, pinsOf, builderSpec, planBatch, clearCaches,
    cacheStats: () => [modelCache.stats(), selectionCache.stats(), viewCache.stats()]
};
