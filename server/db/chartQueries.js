// SQL of the chart engine. Two statements exist: the bounded sample that the
// profile reads, and the batch that computes every chart of a table in one
// scan. Table names are validated, identifiers quoted, and everything that
// came from a file or a request travels as a parameter.
const pool = require('./pool');
const { snapshotDb } = require('./snapshotRead');
const AppError = require('../utils/AppError');
const { quoteIdent } = require('../utils/filterGrammar');
const { TABLE_NAME_RE } = require('./storeQueries');
const { SPACE_FROM, SPACE_TO, sqlStrip, sqlValue, sqlTypedValue } = require('../services/charts/numberFormats');
const { sqlDateKey, sqlDayFirstKey } = require('../services/charts/periods');

// Knuth's multiplicative hash of _id, reduced to 32 bits: rows are scattered
// evenly whatever order the publisher sorted them in.
const SCATTER = '(("_id" * 2654435761) % 4294967296)';
const WORK_MEM = '32MB';

function tableOf(tableName) {
    if (!TABLE_NAME_RE.test(tableName)) throw new AppError('invalid store table name', 500);
    return 'store.' + quoteIdent(tableName);
}

/**
 * The sample statement for a plan from profile.samplePlan(). Rows come back as
 * arrays: _id, then one cell per column as text, long text cut.
 */
function buildSampleSql({ tableName, columns, plan }) {
    const used = (columns || []).filter(column => column && column.id !== '_id');
    const cells = used.map(column => (column.type === 'TEXT'
        ? 'left(' + quoteIdent(column.id) + ', ' + (plan.textCut + 1) + ')'
        : quoteIdent(column.id) + '::text'));
    const select = 'SELECT "_id"' + cells.map(cell => ', ' + cell).join('') + ' FROM ' + tableOf(tableName);
    if (plan.complete || plan.rows === null) return { text: select + ' ORDER BY "_id" LIMIT $1', values: [plan.target] };
    return {
        text: select + ' WHERE "_id" <= $1 OR "_id" > $2 OR ' + SCATTER + ' < $3 ORDER BY "_id" LIMIT $4',
        // The scatter is a share of the rows, so allow it some slack over the target.
        values: [plan.head, plan.rows - plan.tail, plan.threshold, Math.ceil(plan.target * 1.25)]
    };
}

// One read-only statement with its own time and memory bounds, on the
// snapshot lease's connection when there is one. A statement that times out
// rolls back and leaves the connection, and the lease's lock, usable.
async function bounded(statement, { timeoutMs, db = snapshotDb() } = {}) {
    const leased = db !== pool && typeof db.release === 'function';
    const client = leased || db !== pool ? db : await pool.connect();
    const owned = client !== db;
    let broken = false;
    try {
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new AppError('invalid chart statement timeout', 500);
        try {
            await client.query('BEGIN READ ONLY; SET LOCAL statement_timeout = ' + timeoutMs + '; SET LOCAL jit = off; SET LOCAL work_mem = \'' + WORK_MEM + '\'');
            const result = await client.query(statement);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { broken = true; }
            throw error;
        }
    } finally {
        if (owned) client.release(broken);
    }
}

async function readSample({ tableName, columns, plan }, options) {
    const { text, values } = buildSampleSql({ tableName, columns, plan });
    const result = await bounded({ text, values, rowMode: 'array' }, options);
    return result.rows;
}

const MAX_SETS = 12;
const MAX_MEASURES = 48;
const KEY_CUT = 200;
const RANK_ALIAS = { sum: 's', avg: 'a', max: 'x', min: 'l', abs: 'b' };
// Groups are ordered by the bytes of their key: the same order on every
// database, whatever its language settings, and the cheapest comparison.
const BY_KEY = 'fk COLLATE "C"';

/**
 * One statement that computes every chart of a table in a single scan.
 *
 * Each set is a way of grouping the rows (a category, a period); each measure
 * is a number column, read through its cleaning rule when it is text. The
 * statement groups by every set at once (GROUPING SETS), merges spellings of
 * a group that differ only by case or spacing, and returns the top groups of
 * each set plus one grand-total row, which carries the exact counts of cells
 * left out.
 *
 * Work per row is kept to what must happen per row: reading numbers out of
 * text. Keys are grouped as they are stored and cleaned once per group.
 *
 * @param {{
 *   tableName: string,
 *   where?: { whereSql: string, params: unknown[] },
 *   scope?: { key: object, keys: string[] } | null,
 *   excluded?: number[],
 *   totals?: Array<{ column: { id: string, type: string }, labels: string[] }>,
 *   sets: Array<{ key: object, rank: Array<{ by: 'n' | 'sum' | 'avg' | 'max' | 'min' | 'key', measure?: number, limit: number }> }>,
 *   measures: Array<{ column: { id: string, type: string }, clean: object | null, only?: { column: { id: string, type: string }, value: string } | null }>
 * }} plan measures[].only: read the measure on the rows where that column holds that value, and count the others;
 *   scope: only the rows whose key (as a set of that key groups them, folded) is one of these, such as one period
 * @returns {{ text: string, values: unknown[], grand: number, sets: number[] }} the gs value of the grand-total row and of each set
 */
function buildBatchSql({ tableName, where, scope = null, excluded = [], totals = [], sets, measures }) {
    if (sets.length > MAX_SETS || measures.length > MAX_MEASURES) throw new AppError('chart batch is too large', 500);
    const values = where && Array.isArray(where.params) ? where.params.slice() : [];
    const placeholders = new Map();
    // Equal values share a placeholder: the same pattern guards many columns.
    const param = value => {
        const key = JSON.stringify(value);
        if (!placeholders.has(key)) {
            values.push(value);
            placeholders.set(key, '$' + values.length);
        }
        return placeholders.get(key);
    };

    // Every column is read once, at the bottom: as stored, and for a text
    // measure also prepped (odd spaces mapped, trimmed).
    const registry = new Map();
    const baseItems = [];
    const register = (id, expression, prefix) => {
        if (!registry.has(id)) {
            registry.set(id, prefix + registry.size);
            baseItems.push(expression + ' AS ' + registry.get(id));
        }
        return registry.get(id);
    };
    const stored = column => register('c:' + column.id, quoteIdent(column.id), 'c');
    const prepped = column => register('p:' + column.id,
        'btrim(translate(' + quoteIdent(column.id) + ', ' + param(SPACE_FROM) + ', ' + param(SPACE_TO) + '))', 'p');
    const asText = column => (column.type === 'TEXT' ? stored(column) : stored(column) + '::text');
    // Text compared the way groups are merged (see "folded" below): odd spaces
    // mapped, trimmed, runs of spaces as one, lower case. Lists from the caller
    // are folded by the same expression, so both sides agree whatever the
    // database's locale makes of lower().
    const fold = text => 'lower(regexp_replace(btrim(translate(' + text + ', ' + param(SPACE_FROM) + ', ' + param(SPACE_TO) + ')), ' + param(' +') +
        ', \' \', \'g\'))';
    const foldAll = list => 'ARRAY(SELECT ' + fold('l') + ' FROM unnest(' + param(list) + '::text[]) AS l)';
    // A column's value as a category key: what the groups are made of.
    const groupKey = column => (column.type === 'TEXT' ? 'left(' + stored(column) + ', ' + KEY_CUT + ')' : asText(column));

    const keyOf = key => {
        if (key.kind === 'category') {
            return key.column.type === 'TEXT' ? 'coalesce(left(' + stored(key.column) + ', ' + KEY_CUT + '), \'\')' : 'coalesce(' + asText(key.column) + ', \'\')';
        }
        if (key.kind === 'date') {
            const text = key.column.type === 'TEXT';
            const value = text ? 'btrim(' + stored(key.column) + ')' : stored(key.column);
            const bucketed = 'coalesce(' + sqlDateKey(value, text ? 'iso_date' : key.column.type, key.grain) + ', \'\')';
            if (!Array.isArray(key.skip) || !key.skip.length) return bucketed;
            // Dates that stand for "no date" (1900-01-01) belong to no period.
            const day = text ? 'replace(left(' + value + ', 10), \'/\', \'-\')'
                : key.column.type === 'TIMESTAMPTZ' ? 'to_char(' + value + ' AT TIME ZONE \'UTC\', \'YYYY-MM-DD\')' : 'to_char(' + value + ', \'YYYY-MM-DD\')';
            return '(CASE WHEN coalesce(' + day + ' = ANY(' + param(key.skip) + '::text[]), false) THEN \'\' ELSE ' + bucketed + ' END)';
        }
        if (key.kind === 'text') return 'coalesce(' + asText(key.column) + ', \'\')';
        if (key.kind === 'day_first') return 'coalesce(' + sqlDayFirstKey('btrim(' + asText(key.column) + ')', key.order, key.grain, param) + ', \'\')';
        if (key.kind === 'composite') return '(coalesce(' + asText(key.year) + ', \'\') || chr(31) || coalesce(' + asText(key.part) + ', \'\'))';
        throw new AppError('invalid chart key', 500);
    };
    const keyItems = sets.map((set, i) => keyOf(set.key) + ' AS k' + i);
    // One period of an axis (or any one group of a key): the same key, folded
    // as groups are, so the rows are exactly those of the group the set found.
    const scoped = scope && Array.isArray(scope.keys) ? ' WHERE ' + fold(keyOf(scope.key)) + ' = ANY(' + param(scope.keys) + '::text[])' : '';

    // Rows that add other rows up are counted apart, in every set. Folding a
    // long text cell costs more than everything else a row goes through, so
    // the spellings that are one of the labels are found once, among the
    // column's distinct values, and each row is compared with those as stored.
    const totalParts = totals.map(total => {
        const raw = total.column.type === 'TEXT' ? 'left(' + quoteIdent(total.column.id) + ', ' + KEY_CUT + ')' : quoteIdent(total.column.id) + '::text';
        const spellings = 'ARRAY(SELECT v FROM (SELECT DISTINCT ' + raw + ' AS v FROM ' + tableOf(tableName) + ') d WHERE ' + fold('v') +
            ' = ANY(' + foldAll(total.labels) + '))';
        return 'coalesce(' + groupKey(total.column) + ' = ANY(' + spellings + '), false)';
    });
    const live = totalParts.length ? ' FILTER (WHERE NOT x)' : '';
    const and = totalParts.length ? ' AND NOT x' : '';

    const stripItems = [];
    const valueItems = [];
    const restricted = new Set();
    measures.forEach((measure, j) => {
        let value;
        let blank;
        let missing = null;
        if (measure.column.type === 'TEXT') {
            const p = prepped(measure.column);
            let d = p;
            if (measure.clean.symbols || (measure.clean.codes && measure.clean.codes.length) || measure.clean.paren || measure.clean.marks) {
                d = 'd' + j;
                stripItems.push(sqlStrip(p, measure.clean, param) + ' AS ' + d);
            }
            value = sqlValue(d, measure.clean, param);
            blank = '(' + p + ' IS NULL OR ' + p + ' = \'\')';
            if (measure.clean.missing && measure.clean.missing.length) {
                missing = 'coalesce(lower(' + p + ') = ANY(ARRAY(SELECT lower(m) FROM unnest(' + param(measure.clean.missing) + '::text[]) AS m)), false)';
            }
        } else {
            const c = stored(measure.column);
            value = sqlTypedValue(c, measure.column.type);
            blank = '(' + c + ' IS NULL)';
            // Figures that stand for "no figure" (99999.9) are placeholders, not numbers.
            if (Array.isArray(measure.sentinels) && measure.sentinels.length) {
                missing = 'coalesce(' + c + '::float8 = ANY(' + param(measure.sentinels) + '::float8[]), false)';
                value = '(CASE WHEN ' + missing + ' THEN NULL ELSE ' + value + ' END)';
            }
        }
        // A text measure whose placeholders are figures too ("99999.9"): the placeholder wins.
        if (measure.column.type === 'TEXT' && measure.clean.sentinel && missing) value = '(CASE WHEN ' + missing + ' THEN NULL ELSE ' + value + ' END)';
        if (measure.only) {
            // Rows in another unit are neither numbers nor blanks of this measure: they are counted apart.
            const here = 'coalesce(' + fold(groupKey(measure.only.column)) + ' = ' + fold(param(String(measure.only.value))) + ', false)';
            restricted.add(j);
            valueItems.push('(CASE WHEN ' + here + ' THEN ' + value + ' END) AS v' + j, '(' + here + ' AND ' + blank + ') AS b' + j,
                missing ? '(' + here + ' AND ' + missing + ') AS m' + j : 'false AS m' + j, '(NOT ' + here + ') AS o' + j);
        } else valueItems.push(value + ' AS v' + j, blank + ' AS b' + j, (missing || 'false') + ' AS m' + j);
    });
    const totalItem = totalParts.length ? '(' + totalParts.join(' OR ') + ') AS x' : null;

    const conditions = [];
    if (where && where.whereSql) conditions.push('(' + where.whereSql.replace(/^\s*WHERE\s+/i, '') + ')');
    if (excluded.length) conditions.push('"_id" <> ALL(' + param(excluded) + '::bigint[])');
    const base = 'SELECT ' + (baseItems.length ? baseItems.join(', ') : '1 AS one') + ' FROM ' + tableOf(tableName) +
        (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') + ' OFFSET 0';

    const count = sets.length;
    const keys = sets.map((_, i) => 'k' + i);
    const aggregates = ['count(*)' + live + '::bigint AS n', totalParts.length ? 'count(*) FILTER (WHERE x)::bigint AS nx' : '0::bigint AS nx'];
    const folds = ['sum(n)::bigint AS n', 'sum(nx)::bigint AS nx'];
    measures.forEach((_, j) => {
        aggregates.push('sum(v' + j + ')' + live + ' AS s' + j, 'count(v' + j + ')' + live + '::bigint AS c' + j,
            'min(v' + j + ')' + live + ' AS lo' + j, 'max(v' + j + ')' + live + ' AS hi' + j,
            'count(*) FILTER (WHERE b' + j + and + ')::bigint AS bl' + j, 'count(*) FILTER (WHERE m' + j + and + ')::bigint AS mi' + j);
        folds.push('sum(s' + j + ') AS s' + j, 'sum(c' + j + ')::bigint AS c' + j, 'min(lo' + j + ') AS lo' + j, 'max(hi' + j + ') AS hi' + j,
            'sum(bl' + j + ')::bigint AS bl' + j, 'sum(mi' + j + ')::bigint AS mi' + j);
        if (restricted.has(j)) {
            aggregates.push('count(*) FILTER (WHERE o' + j + and + ')::bigint AS ot' + j);
            folds.push('sum(ot' + j + ')::bigint AS ot' + j);
        }
        // What the rows set aside as totals say themselves: where a table has one
        // total row, its figure is the total, whatever its parts add up to.
        if (totalParts.length) {
            aggregates.push('sum(v' + j + ') FILTER (WHERE x) AS xs' + j, 'count(v' + j + ') FILTER (WHERE x)::bigint AS xc' + j);
            folds.push('sum(xs' + j + ') AS xs' + j, 'sum(xc' + j + ')::bigint AS xc' + j);
        }
    });
    const grouped = 'SELECT ' + (count ? 'GROUPING(' + keys.join(', ') + ')::int' : '0') + ' AS gs, ' +
        (count === 0 ? 'NULL::text' : count === 1 ? 'k0' : 'coalesce(' + keys.join(', ') + ')') + ' AS k, ' + aggregates.join(', ') +
        ' FROM s GROUP BY GROUPING SETS (' + keys.map(key => '(' + key + ')').concat(['()']).join(', ') + ')';
    // Spellings of one group that differ by case, odd spaces or padding merge
    // here, on the grouped rows; the most frequent spelling names the group.
    // The stored spelling travels along: a filter on the group must match it exactly.
    const folded = 'SELECT gs, ' + fold('k') + ' AS fk, (array_agg(btrim(translate(k, ' + param(SPACE_FROM) + ', ' + param(SPACE_TO) +
        ')) ORDER BY n DESC, k COLLATE "C"))[1] AS label, (array_agg(k ORDER BY n DESC, k COLLATE "C"))[1] AS raw, ' +
        'count(*)::int AS spellings, ' + folds.join(', ') + ' FROM g GROUP BY gs, 2';

    // gs of a set: every key but its own is "grouped away".
    const grand = 2 ** count - 1;
    const setIds = sets.map((_, i) => grand - 2 ** (count - 1 - i));
    const orders = new Map();
    const keep = ['gs = ' + grand];
    sets.forEach((set, i) => {
        const any = [];
        for (const rank of set.rank) {
            if (!Number.isInteger(rank.limit) || rank.limit < 1 || rank.limit > 1000) throw new AppError('invalid chart limit', 500);
            let name;
            if (rank.by === 'n') { name = 'rn_n'; orders.set(name, 'n DESC, ' + BY_KEY); }
            else if (rank.by === 'key') { name = 'rn_k'; orders.set(name, BY_KEY + ' DESC'); }
            else if (Object.hasOwn(RANK_ALIAS, rank.by) && Number.isInteger(rank.measure) && rank.measure >= 0 && rank.measure < measures.length) {
                const j = rank.measure;
                name = 'rn_' + RANK_ALIAS[rank.by] + j;
                orders.set(name, (rank.by === 'sum' ? 's' + j : rank.by === 'abs' ? 'abs(s' + j + ')' : rank.by === 'max' ? 'hi' + j
                    : rank.by === 'min' ? 'lo' + j : '(s' + j + ' / nullif(c' + j + ', 0))') + ' DESC NULLS LAST, ' + BY_KEY);
            } else throw new AppError('invalid chart ranking', 500);
            any.push(name + ' <= ' + rank.limit);
        }
        if (!any.length) throw new AppError('chart set without a ranking', 500);
        keep.push('(gs = ' + setIds[i] + ' AND (' + any.join(' OR ') + '))');
    });
    const ranked = 'SELECT f.*, count(*) OVER w AS groups' +
        [...orders.entries()].map(([name, order]) => ', row_number() OVER (w ORDER BY ' + order + ') AS ' + name).join('') +
        ' FROM f WINDOW w AS (PARTITION BY gs)';

    // The rows as the aggregate reads them: keys, numbers, and what is blank,
    // a placeholder or a total. Stripping currency signs and the like needs a
    // level of its own only when a measure has any.
    const rowItems = [...keyItems, ...valueItems, ...(totalItem ? [totalItem] : [])];
    const source = stripItems.length
        ? 'base AS (' + base + '), b AS (SELECT base.*' + stripItems.map(item => ', ' + item).join('') + ' FROM base' + scoped + ' OFFSET 0), ' +
            's AS (SELECT ' + (rowItems.length ? rowItems.join(', ') : '1 AS one') + ' FROM b OFFSET 0)'
        : 'base AS (' + base + '), s AS (SELECT ' + (rowItems.length ? rowItems.join(', ') : '1 AS one') + ' FROM base' + scoped + ' OFFSET 0)';
    const text = 'WITH ' + source + ', g AS (' + grouped + '), f AS (' + folded + '), r AS (' + ranked + ') ' +
        'SELECT * FROM r WHERE ' + keep.join(' OR ') + ' ORDER BY gs, ' + BY_KEY;
    return { text, values, grand, sets: setIds };
}

/**
 * Runs a batch and returns its rows by set, numbers as JavaScript numbers.
 * @returns {Promise<{ grand: object | null, sets: object[][] }>}
 */
async function runBatch(plan, options) {
    const { text, values, grand, sets } = buildBatchSql(plan);
    const result = await bounded({ text, values }, options);
    const number = value => (value === null || value === undefined ? null : Number(value));
    const out = { grand: null, sets: sets.map(() => []) };
    const measures = plan.measures.length;
    for (const row of result.rows) {
        const group = { key: row.fk, label: row.label, raw: row.raw, spellings: Number(row.spellings), n: Number(row.n), nx: Number(row.nx),
            groups: Number(row.groups), measures: [] };
        for (let j = 0; j < measures; j += 1) {
            group.measures.push({ sum: number(row['s' + j]), n: Number(row['c' + j]), min: number(row['lo' + j]), max: number(row['hi' + j]),
                blank: Number(row['bl' + j]), missing: Number(row['mi' + j]), other: Number(row['ot' + j] || 0),
                xsum: number(row['xs' + j]), xn: Number(row['xc' + j] || 0) });
        }
        const gs = Number(row.gs);
        if (gs === grand) out.grand = group;
        else {
            const index = sets.indexOf(gs);
            if (index >= 0) out.sets[index].push(group);
        }
    }
    return out;
}

module.exports = { buildSampleSql, readSample, buildBatchSql, runBatch, bounded, tableOf, WORK_MEM, MAX_SETS, MAX_MEASURES };
