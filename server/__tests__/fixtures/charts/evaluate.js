// The chart batch, computed in JavaScript over a fixture's rows. It follows
// db/chartQueries.js buildBatchSql() step by step, so the engine can be
// tested without a database, and so the SQL can be checked against it on a
// real one (integration/chartParity.test.cjs): two implementations of the same
// rules that must agree.
const { prep, strip, trimSpaces, FORMATS, MAX_LENGTH } = require('../../../services/charts/numberFormats');

const SEPARATOR = String.fromCharCode(31);
const DAY_FIRST_RE = /^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]((19|20)[0-9]{2})([ t][0-9:.apm ]{0,14})?$/;
const pad = number => String(number).padStart(2, '0');
// PostgreSQL's btrim(): plain spaces only.
const btrim = trimSpaces;

function validDay(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// date_trunc(grain, day), written YYYY-MM-DD.
function bucket(year, month, day, grain) {
    if (grain === 'year') return year + '-01-01';
    if (grain === 'quarter') return year + '-' + pad(Math.floor((month - 1) / 3) * 3 + 1) + '-01';
    if (grain === 'month') return year + '-' + pad(month) + '-01';
    return year + '-' + pad(month) + '-' + pad(day);
}

function isoBucket(text, grain, typed = false) {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text.slice(0, 10).replace(/\//g, '-'));
    if (!m || !validDay(Number(m[1]), Number(m[2]), Number(m[3]))) return '';
    // As the batch: a typed date before 1600 has no bucket.
    if (typed && Number(m[1]) < 1600) return '';
    return bucket(Number(m[1]), Number(m[2]), Number(m[3]), grain);
}

function keyOf(key, cell) {
    if (key.kind === 'category') {
        const value = cell(key.column);
        return value === null ? '' : key.column.type === 'TEXT' ? value.slice(0, 200) : value;
    }
    if (key.kind === 'date') {
        const value = cell(key.column);
        if (value === null) return '';
        // Dates that stand for "no date" belong to no period.
        if (Array.isArray(key.skip) && key.skip.length) {
            const day = key.column.type === 'TIMESTAMPTZ' ? new Date(value).toISOString().slice(0, 10)
                : (key.column.type === 'TEXT' ? btrim(value) : value).slice(0, 10).replace(/\//g, '-');
            if (key.skip.includes(day)) return '';
        }
        if (key.column.type === 'TIMESTAMPTZ') {
            const at = new Date(value);
            return Number.isFinite(at.getTime()) && at.getUTCFullYear() >= 1600 ? bucket(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate(), key.grain) : '';
        }
        return isoBucket(key.column.type === 'TEXT' ? btrim(value) : value, key.grain, key.column.type !== 'TEXT');
    }
    if (key.kind === 'text') return cell(key.column) ?? '';
    if (key.kind === 'day_first') {
        const value = cell(key.column);
        const m = value === null ? null : DAY_FIRST_RE.exec(btrim(value).toLowerCase());
        if (!m) return '';
        const [day, month] = key.order === 'dmy' ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
        return validDay(Number(m[3]), month, day) ? bucket(Number(m[3]), month, day, key.grain) : '';
    }
    if (key.kind === 'composite') return (cell(key.year) ?? '') + SEPARATOR + (cell(key.part) ?? '');
    throw new Error('unknown key kind');
}

// As the batch folds text: odd spaces mapped, trimmed, runs of spaces as one, lower case.
const fold = text => prep(text).replace(/ +/g, ' ').toLowerCase();
const groupKey = (column, cell) => { const value = cell(column); return value === null ? '' : column.type === 'TEXT' ? value.slice(0, 200) : value; };

function readMeasure(measure, cell) {
    const raw = cell(measure.column);
    if (measure.column.type !== 'TEXT') {
        const number = raw === null ? null : Number(raw);
        // Figures that stand for "no figure" are placeholders.
        const sentinel = number !== null && (measure.sentinels || []).includes(number);
        const value = number === null || sentinel ? null : number === 0 || Math.abs(number) < 1e-300 ? 0 : Math.abs(number) <= 1e300 ? number : null;
        return { value, blank: raw === null, missing: sentinel };
    }
    const p = raw === null ? null : prep(raw);
    const d = p === null ? null : strip(p, measure.clean);
    const format = FORMATS[measure.clean.core];
    const missing = p !== null && (measure.clean.missing || []).includes(p.toLowerCase());
    const readable = d !== null && d.length >= 1 && d.length <= MAX_LENGTH && format.re.test(d) && !(measure.clean.sentinel && missing);
    return { value: readable ? Number(format.js(d)) : null, blank: p === null || p === '', missing };
}

const emptyGroup = measures => ({ n: 0, nx: 0, measures: measures.map(() => ({ sum: null, n: 0, min: null, max: null, blank: 0, missing: 0, other: 0 })) });

function addRow(group, row) {
    if (row.total) {
        group.nx += 1;
        return;
    }
    group.n += 1;
    row.measures.forEach((read, j) => {
        const into = group.measures[j];
        if (read.other) {
            into.other += 1;
            return;
        }
        if (read.value !== null) {
            into.sum = (into.sum || 0) + read.value;
            into.n += 1;
            if (into.min === null || read.value < into.min) into.min = read.value;
            if (into.max === null || read.value > into.max) into.max = read.value;
        }
        if (read.blank) into.blank += 1;
        if (read.missing) into.missing += 1;
    });
}

function mergeGroup(into, more) {
    into.n += more.n;
    into.nx += more.nx;
    into.measures.forEach((measure, j) => {
        const other = more.measures[j];
        if (other.sum !== null) measure.sum = (measure.sum || 0) + other.sum;
        measure.n += other.n;
        if (other.min !== null && (measure.min === null || other.min < measure.min)) measure.min = other.min;
        if (other.max !== null && (measure.max === null || other.max > measure.max)) measure.max = other.max;
        measure.blank += other.blank;
        measure.missing += other.missing;
        measure.other += other.other;
    });
}

/**
 * @param {{ columns: Array<{ id: string, type: string }>, rows: Array<Array<string | number | null>> }} table rows: _id, then cells
 * @param {object} plan as passed to runBatch(); `where` is not supported
 * @returns {{ grand: object, sets: object[][] }} as runBatch() returns
 */
function evaluateBatch(table, { excluded = [], totals = [], sets, measures, scope = null }) {
    const index = new Map(table.columns.map((column, i) => [column.id, i + 1]));
    const skip = new Set(excluded.map(Number));
    const grand = emptyGroup(measures);
    const raw = sets.map(() => new Map());
    const inScope = scope ? new Set(scope.keys) : null;
    for (const row of table.rows) {
        if (skip.has(Number(row[0]))) continue;
        const cell = column => { const value = row[index.get(column.id)]; return value === null || value === undefined ? null : String(value); };
        // One period (or group) of a key: its folded key is one of the scope's.
        if (inScope && !inScope.has(fold(keyOf(scope.key, cell)))) continue;
        const total = totals.some(entry => cell(entry.column) !== null && entry.labels.map(fold).includes(fold(groupKey(entry.column, cell))));
        const read = { total, measures: measures.map(measure => {
            if (measure.only) {
                const unit = cell(measure.only.column);
                if (unit === null || fold(groupKey(measure.only.column, cell)) !== fold(String(measure.only.value))) return { other: true };
            }
            return readMeasure(measure, cell);
        }) };
        addRow(grand, read);
        sets.forEach((set, i) => {
            const key = keyOf(set.key, cell);
            if (!raw[i].has(key)) raw[i].set(key, emptyGroup(measures));
            addRow(raw[i].get(key), read);
        });
    }

    const out = sets.map((set, i) => {
        // Spellings that differ by case, odd spaces or padding are one group.
        const folded = new Map();
        for (const [key, group] of raw[i]) {
            const label = prep(key);
            const fk = fold(key);
            const seen = folded.get(fk);
            if (!seen) folded.set(fk, { key: fk, label, most: group.n, raw: key, spellings: 1, ...group });
            else {
                if (group.n > seen.most || (group.n === seen.most && key < seen.raw)) Object.assign(seen, { label, most: group.n, raw: key });
                seen.spellings += 1;
                mergeGroup(seen, group);
            }
        }
        const groups = [...folded.values()];
        const kept = new Set();
        for (const rank of set.rank) {
            const metric = group => {
                if (rank.by === 'n') return group.n;
                const measure = group.measures[rank.measure];
                if (rank.by === 'sum') return measure.sum;
                if (rank.by === 'abs') return measure.sum === null ? null : Math.abs(measure.sum);
                if (rank.by === 'max') return measure.max;
                if (rank.by === 'min') return measure.min;
                return measure.n ? measure.sum / measure.n : null;
            };
            const ordered = groups.slice().sort((a, b) => {
                if (rank.by === 'key') return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
                const x = metric(a);
                const y = metric(b);
                if (x === null || y === null) return x === y ? (a.key < b.key ? -1 : 1) : x === null ? 1 : -1;
                return y - x || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
            });
            ordered.slice(0, rank.limit).forEach(group => kept.add(group));
        }
        return groups.filter(group => kept.has(group)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
            .map(({ key, label, raw, spellings, n, nx, measures: figures }) => ({ key, label, raw, spellings, n, nx, groups: groups.length, measures: figures }));
    });
    return { grand: { key: null, label: null, spellings: 1, n: grand.n, nx: grand.nx, groups: 1, measures: grand.measures }, sets: out };
}

/**
 * chartQueries, answered from fixtures: tables is a Map of table name to
 * { columns, rows }. A search or filter cannot be read back out of its SQL, so
 * a test that narrows the rows says which rows it means with `filter`.
 */
function fakeQueries(tables, options = {}) {
    const calls = { samples: 0, batches: [] };
    return {
        calls,
        options,
        readSample: async ({ tableName }) => {
            calls.samples += 1;
            return tables.get(tableName).rows;
        },
        runBatch: async plan => {
            calls.batches.push(plan);
            if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
            if (options.fail) throw options.fail;
            const table = tables.get(plan.tableName);
            if (!plan.where) return evaluateBatch(table, plan);
            if (!options.filter) throw new Error('this test narrows the rows without saying which');
            return evaluateBatch({ columns: table.columns, rows: table.rows.filter(row => options.filter(row, table.columns)) }, plan);
        }
    };
}

module.exports = { evaluateBatch, fakeQueries };
