// The chart engine reads a table twice: a bounded sample, and one statement
// that computes every chart (db/chartQueries.js). This suite checks those
// statements on a disposable PostgreSQL against a second implementation in
// JavaScript (__tests__/fixtures/charts/evaluate.js) and against the table's
// own query:
//  - the sample is the table's rows as text, and a large table's sample is bounded and repeatable;
//  - every number format reads the same numbers in JavaScript and in SQL, and no guarded cast can throw;
//  - the batch returns what the JavaScript evaluator computes, for every fixture, set by set;
//  - whole analyses come out identical whichever of the two computed them;
//  - the rows in scope are the rows the table shows for the same search and filters;
//  - a statement that runs out of time leaves its connection and its snapshot lease usable.
// The engine adds figures up in long tables only when told to; this suite compares SQL with the
// evaluator on every statement the engine can send, those sums included.
process.env.CHART_AUTO_SUMS = 'all';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const enabled = process.env.SPATIAL_TEST_DATABASE_URL;
if (!enabled || enabled !== process.env.CANQUERY_DATABASE_URL) {
    test('chart parity requires matching disposable database URLs', { skip: true }, () => {});
} else {
    const pool = require('../db/pool');
    const queries = require('../db/chartQueries');
    const { queryStoreTable, buildWhereAndParams } = require('../db/storeQueries');
    const { withSnapshot, snapshotDb } = require('../db/snapshotRead');
    const { parseFilters } = require('../utils/filterGrammar');
    const engine = require('../services/charts/chartEngine');
    const { samplePlan, profileSample } = require('../services/charts/profile');
    const { buildTableModel } = require('../services/charts/model');
    const { listCandidates } = require('../services/charts/candidates');
    const { FORMATS, parseNumber, sqlPrep, sqlStrip, sqlValue } = require('../services/charts/numberFormats');
    const { sqlDateKey, sqlDayFirstKey } = require('../services/charts/periods');
    const fixtures = require('../__tests__/fixtures/charts/tables');
    const { evaluateBatch, fakeQueries } = require('../__tests__/fixtures/charts/evaluate');

    const SQL_TYPES = { TEXT: 'text', INTEGER: 'bigint', NUMERIC: 'numeric', DATE: 'date', TIMESTAMPTZ: 'timestamptz' };
    const created = [];
    after(async () => {
        for (const tableName of created) await pool.query('DROP TABLE IF EXISTS store."' + tableName + '"');
        await pool.end();
    });

    // A fixture as the loader would have stored it: _id, then its typed columns.
    async function build(fixture) {
        const tableName = 'r_' + crypto.randomBytes(8).toString('hex');
        created.push(tableName);
        const names = fixture.columns.map(column => '"' + column.id.replaceAll('"', '') + '"');
        await pool.query('CREATE TABLE store."' + tableName + '" ("_id" bigint, ' +
            fixture.columns.map((column, i) => names[i] + ' ' + SQL_TYPES[column.type]).join(', ') + ')');
        const width = fixture.columns.length + 1;
        for (let start = 0; start < fixture.rows.length; start += 200) {
            const chunk = fixture.rows.slice(start, start + 200);
            const marks = chunk.map((_, r) => '(' + Array.from({ length: width }, (_, c) => '$' + (r * width + c + 1)).join(', ') + ')').join(', ');
            await pool.query('INSERT INTO store."' + tableName + '" ("_id", ' + names.join(', ') + ') VALUES ' + marks, chunk.flat());
        }
        return { tableName, columns: fixture.columns, rowCount: fixture.rows.length, ingestedAt: '2026-01-01T00:00:00.000Z' };
    }

    async function modelOf(fixture) {
        const plan = samplePlan({ rowCount: fixture.rows.length, columns: fixture.columns });
        const profile = await profileSample({ columns: fixture.columns, rows: fixture.rows, plan });
        return buildTableModel(profile, { rowCount: fixture.rows.length, now: new Date('2026-11-12T00:00:00Z') });
    }

    // Doubles added up in another order differ in their last digits.
    const round = value => (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value) ? Number(value.toPrecision(10)) : value);
    const figures = group => ({ n: group.n, nx: group.nx, spellings: group.spellings, groups: group.groups,
        measures: group.measures.map(measure => Object.fromEntries(Object.entries(measure).map(([name, value]) => [name, round(value)]))) });
    const byKey = groups => Object.fromEntries(groups.map(group => [group.key, figures(group)]));

    // Every candidate of a table in one plan, with ranks wide enough to return every group.
    function planOf(table, model) {
        const totals = new Map();
        for (const column of model.columns) {
            if (column.category && column.category.total_members.length) totals.set(column.id, new Set(column.category.total_members));
        }
        const plan = engine.planBatch(model, listCandidates(model), { totals });
        return { tableName: table.tableName, excluded: model.excluded_rows, totals: plan.totals,
            sets: plan.sets.map(set => ({ key: set.key, rank: set.rank.map(rank => ({ ...rank, limit: 1000 })) })),
            measures: plan.measures.map(measure => ({ column: measure.column, clean: measure.clean, only: measure.only })) };
    }

    test('the sample is the table as text, and a large table is sampled within bounds, the same way each time', async () => {
        const fixture = fixtures.cleanEvents();
        const table = await build(fixture);
        const plan = samplePlan({ rowCount: fixture.rows.length, columns: fixture.columns });
        assert.equal(plan.complete, true);
        assert.deepEqual(await queries.readSample({ tableName: table.tableName, columns: fixture.columns, plan }, { timeoutMs: 5000 }),
            fixture.rows.map(row => row.map(String)));

        const columns = [{ id: 'n', type: 'INTEGER' }, { id: 'label', type: 'TEXT' }];
        const big = 'r_' + crypto.randomBytes(8).toString('hex');
        created.push(big);
        await pool.query('CREATE TABLE store."' + big + '" AS SELECT g::bigint AS "_id", (g % 97)::bigint AS n, repeat(chr(65 + (g % 26)::int), 200) AS label ' +
            'FROM generate_series(1, 120000) g');
        const large = samplePlan({ rowCount: 120000, columns });
        assert.equal(large.complete, false);
        const first = await queries.readSample({ tableName: big, columns, plan: large }, { timeoutMs: 15000 });
        const second = await queries.readSample({ tableName: big, columns, plan: large }, { timeoutMs: 15000 });
        assert.deepEqual(first.map(row => row[0]), second.map(row => row[0]));
        assert.ok(first.length >= large.target * 0.85 && first.length <= large.target * 1.25, 'sampled ' + first.length + ' for a target of ' + large.target);
        const ids = new Set(first.map(row => Number(row[0])));
        for (const id of [1, large.head, 120000 - large.tail + 1, 120000]) assert.ok(ids.has(id), 'row ' + id + ' is in the sample');
        // Long text is cut one character past the limit, so the profile can tell it was long.
        assert.equal(first[0][2].length, large.textCut + 1);
        // The scatter is spread over the whole table, not a run of it.
        const middle = first.filter(row => Number(row[0]) > 40000 && Number(row[0]) <= 80000).length;
        assert.ok(middle > first.length * 0.25 && middle < first.length * 0.42, 'middle third holds ' + middle + ' of ' + first.length);
    });

    test('every number format reads the same numbers in JavaScript and in SQL, and nothing a cell holds can make a cast fail', async () => {
        const digits = n => String((n * 7919 + 13) % 100000);
        const tokens = new Set(['', ' ', '--', '-', '.', ',', '1e999', '1e99', '1e-99', '9'.repeat(64), '9'.repeat(65), '1,2,3', '1.2.3', 'NaN', 'Infinity', '-Infinity',
            '0x1F', '1_000', '１２３', '12abc', 'abc', '1 2', '(12)', '(12', '12)', '$', '%', '+', '+-1', '--1', '1-', '1e', 'e1', '.5', '5.', '0.', '-.5', '+.5e3',
            '\u00a01\u202f234\u2009', '\u22125', '1\u00a0234,5', '12 %', '$ 12', 'CAD 1,250.00', '1,250.00 CAD', '($1,234.50)', '1,234,567.891', '1 234 567,8', '0,125',
            '12,5', '1,234', '1.234,5', '1,23', '1,2345', '00012', '-0', '+0', '1e3', '1E3', '1e+3', '1e-3', '1.5e10',
            // Footnote marks after a number, and marks with nothing before them.
            '2,605*', '311 \u2020', '1 234\u00b9', '12%*', '(12)*', '*', '**', '\u2021', '1*2', '*12',
            // Flags of statistical tables: use with caution, preliminary, revised.
            '635E', '1,204p', '12 r', '3.5Er', 'E', 'pr', '1E', '2.5E2', 'NONE']);
        for (let n = 0; n < 420; n += 1) {
            const whole = digits(n);
            const cents = String(n % 100).padStart(2, '0');
            for (const token of [whole, '-' + whole, whole + '.' + cents, Number(whole).toLocaleString('en-CA'), Number(whole).toLocaleString('en-CA') + '.' + cents,
                Number(whole).toLocaleString('en-CA').replaceAll(',', ' ') + ',' + cents, whole + ',' + cents, '$' + whole, whole + '%', '(' + whole + ')', ' ' + whole + ' ',
                Number(whole).toLocaleString('en-CA').replaceAll(',', '\u00a0')]) tokens.add(token);
        }
        const list = [...tokens];
        assert.ok(list.length > 2000);
        for (const core of Object.keys(FORMATS)) {
            for (const rule of [{ core, symbols: '', codes: [], paren: false }, { core, symbols: '$%', codes: ['CAD'], paren: true },
                { core, symbols: '$%', codes: ['CAD'], paren: true, marks: true }]) {
                const values = [list];
                const param = value => { values.push(value); return '$' + values.length; };
                const text = 'SELECT t, ' + sqlValue('d', rule, param) + ' AS v FROM (SELECT t, ' + sqlStrip('p', rule, param) + ' AS d FROM (SELECT t, ' +
                    sqlPrep('t', param) + ' AS p FROM unnest($1::text[]) WITH ORDINALITY AS u(t, o) ORDER BY o) a) b';
                const { rows } = await pool.query(text, values);
                assert.equal(rows.length, list.length);
                let read = 0;
                rows.forEach((row, i) => {
                    const js = parseNumber(list[i], rule);
                    const sql = row.v === null ? null : Number(row.v);
                    if (js !== null) read += 1;
                    assert.ok(js === sql || (js !== null && sql !== null && Math.abs(js - sql) <= Math.abs(js) * 1e-12),
                        JSON.stringify(rule) + ' reads ' + JSON.stringify(list[i]) + ' as ' + js + ' in JavaScript and ' + sql + ' in SQL');
                });
                assert.ok(read > 400, core + ' read ' + read + ' tokens');
            }
        }

        // Dates as text: only real calendar days become a bucket; nothing throws.
        const dates = ['2021-03-04', '2021-02-30', '2021-13-01', '0000-00-00', '9999-99-99', '2021/03/06', '2021-03-07T10:00:00Z', 'not a date', '', '20210304',
            '31/01/2021', '01/31/2021', '31/02/2021', '13/13/2021', '5/2/2021 09:30', '5.2.2021', '5-2-1899'];
        const values = [dates];
        const param = value => { values.push(value); return '$' + values.length; };
        const { rows } = await pool.query('SELECT t, ' + sqlDateKey('btrim(t)', 'iso_date', 'month') + ' AS iso, ' + sqlDayFirstKey('btrim(t)', 'dmy', 'day', param) + ' AS dmy, ' +
            sqlDayFirstKey('btrim(t)', 'mdy', 'quarter', param) + ' AS mdy FROM unnest($1::text[]) WITH ORDINALITY AS u(t, o) ORDER BY o', values);
        const got = Object.fromEntries(rows.map(row => [row.t, [row.iso, row.dmy, row.mdy]]));
        assert.deepEqual(got['2021-03-04'], ['2021-03-01', null, null]);
        assert.deepEqual(got['2021/03/06'], ['2021-03-01', null, null]);
        assert.deepEqual(got['2021-03-07T10:00:00Z'], ['2021-03-01', null, null]);
        assert.deepEqual(got['31/01/2021'], [null, '2021-01-31', null]);
        assert.deepEqual(got['01/31/2021'], [null, null, '2021-01-01']);
        assert.deepEqual(got['5/2/2021 09:30'], [null, '2021-02-05', '2021-04-01']);
        assert.deepEqual(got['5.2.2021'], [null, '2021-02-05', '2021-04-01']);
        for (const bad of ['2021-02-30', '2021-13-01', '0000-00-00', '9999-99-99', 'not a date', '', '20210304', '31/02/2021', '13/13/2021', '5-2-1899']) {
            assert.deepEqual(got[bad], [null, null, null], bad);
        }
    });

    test('the batch returns what the evaluator computes, for every fixture and every way of grouping it', async () => {
        let sets = 0;
        for (const [name, make] of Object.entries(fixtures)) {
            const fixture = make();
            const table = await build(fixture);
            const model = await modelOf(fixture);
            const plan = planOf(table, model);
            const sql = await queries.runBatch(plan, { timeoutMs: 15000 });
            const js = evaluateBatch(fixture, plan);
            assert.deepEqual(figures(sql.grand), figures(js.grand), name + ': grand total');
            assert.equal(sql.sets.length, plan.sets.length);
            plan.sets.forEach((set, i) => {
                assert.deepEqual(byKey(sql.sets[i]), byKey(js.sets[i]), name + ': set ' + JSON.stringify(set.key));
                // One spelling: the label is that spelling, cleaned.
                for (const group of sql.sets[i]) {
                    if (group.spellings === 1) assert.equal(group.label, js.sets[i].find(other => other.key === group.key).label, name + ': label of ' + group.key);
                }
                sets += 1;
            });
            // Each set alone returns the same rows as within the batch.
            if (plan.sets.length > 1) {
                const alone = await queries.runBatch({ ...plan, sets: [plan.sets[plan.sets.length - 1]] }, { timeoutMs: 15000 });
                assert.deepEqual(byKey(alone.sets[0]), byKey(sql.sets[plan.sets.length - 1]), name + ': a set alone');
                assert.deepEqual(figures(alone.grand), figures(sql.grand));
            }
        }
        assert.ok(sets >= 30, sets + ' sets compared');
    });

    test('totals and units match however their text is padded, and no stored value can make a scan fail', async () => {
        const fixture = { columns: [{ id: 'Region', type: 'TEXT' }, { id: 'Currency', type: 'TEXT' }, { id: 'Amount', type: 'NUMERIC' }, { id: 'Day', type: 'DATE' }],
            rows: [
                [1, 'East', 'CAD', '10', '2020-01-05'],
                [2, 'West', 'CAD\u00a0', '20', '2021-03-01'],
                [3, 'Grand\u00a0 Total ', 'CAD', '30', '2022-06-30'],
                // Too small for a double, and a date too early or too late for any chart.
                [4, 'North', 'CAD', '1e-400', '1500-01-01'],
                [5, 'South', ' cad', '5', '200000-01-01'],
                [6, 'East', 'USD', '7', '2020-02-02']
            ] };
        const table = await build(fixture);
        const [region, currency, amount, day] = fixture.columns;
        const plan = { tableName: table.tableName, totals: [{ column: region, labels: ['grand total'] }],
            sets: [{ key: { kind: 'category', column: region }, rank: [{ by: 'n', limit: 100 }] }, { key: { kind: 'date', column: day, grain: 'year' }, rank: [{ by: 'key', limit: 100 }] }],
            measures: [{ column: amount, clean: null, only: { column: currency, value: 'CAD' } }] };
        const sql = await queries.runBatch(plan, { timeoutMs: 15000 });
        const js = evaluateBatch(fixture, plan);
        assert.deepEqual(figures(sql.grand), figures(js.grand));
        assert.deepEqual(byKey(sql.sets[0]), byKey(js.sets[0]));
        assert.deepEqual(byKey(sql.sets[1]), byKey(js.sets[1]));
        // The padded total is set aside, every spelling of the unit counts, the tiny value is zero.
        assert.equal(sql.grand.nx, 1);
        assert.equal(sql.grand.n, 5);
        assert.deepEqual([sql.grand.measures[0].sum, sql.grand.measures[0].n, sql.grand.measures[0].other], [35, 4, 1]);
        // Dates out of every period have no bucket (the total's row keeps its own, empty, group).
        assert.deepEqual(sql.sets[1].filter(group => group.n > 0).map(group => group.key).sort(), ['', '2020-01-01', '2021-01-01']);
        // Each group carries the spelling stored in the table, for an exact filter.
        assert.equal(sql.sets[0].find(group => group.key === 'grand total').raw, 'Grand\u00a0 Total ');
    });

    test('a scan of one period, figures that stand for none and footnote marks read the same in SQL and in the evaluator', async () => {
        const unit = String.fromCharCode(31);
        const fixture = { columns: [{ id: 'Year', type: 'INTEGER' }, { id: 'Month', type: 'TEXT' }, { id: 'Region', type: 'TEXT' }, { id: 'Assets', type: 'NUMERIC' },
            { id: 'Count', type: 'TEXT' }],
            rows: [[1, '2024', 'Jan', 'East', '10', '5'], [2, '2024', ' jan', 'West', '99999.9', '7*'], [3, '2025', 'Jan', 'East', '20', '99999.9'],
                [4, '2025', 'Feb', 'West', '-999', '3']] };
        const table = await build(fixture);
        const [year, month, region, assets, count] = fixture.columns;
        const plan = { tableName: table.tableName, scope: { key: { kind: 'composite', year, part: month }, keys: ['2024' + unit + 'jan', '2024' + unit + ' jan'] },
            sets: [{ key: { kind: 'category', column: region }, rank: [{ by: 'n', limit: 10 }] }],
            measures: [{ column: assets, clean: null, only: null, sentinels: [99999.9, -999] },
                { column: count, clean: { core: 'plain', symbols: '', codes: [], paren: false, marks: true, missing: ['99999.9'], sentinel: true }, only: null }] };
        const sql = await queries.runBatch(plan, { timeoutMs: 15000 });
        const js = evaluateBatch(fixture, plan);
        assert.deepEqual(figures(sql.grand), figures(js.grand));
        assert.deepEqual(byKey(sql.sets[0]), byKey(js.sets[0]));
        // January 2024 only, however its month is spelled.
        assert.equal(sql.grand.n, 2);
        assert.deepEqual([sql.grand.measures[0].sum, sql.grand.measures[0].n, sql.grand.measures[0].missing], [10, 1, 1]);
        assert.deepEqual([sql.grand.measures[1].sum, sql.grand.measures[1].n], [12, 2]);
    });

    test('whole analyses are the same whether PostgreSQL or the evaluator scanned the table', async () => {
        const real = { readSample: queries.readSample, runBatch: queries.runBatch };
        const strip = analysis => JSON.parse(JSON.stringify(analysis, (key, value) => round(value)));
        try {
            for (const [name, make] of Object.entries(fixtures)) {
                const fixture = make();
                const table = await build(fixture);
                engine.clearCaches();
                Object.assign(queries, real);
                const fromSql = strip(await engine.analyzeSnapshot(table, { lang: 'en' }));
                engine.clearCaches();
                const fake = fakeQueries(new Map([[table.tableName, fixture]]));
                Object.assign(queries, { readSample: fake.readSample, runBatch: fake.runBatch });
                const fromJs = strip(await engine.analyzeSnapshot(table, { lang: 'en' }));
                assert.deepEqual(fromSql, fromJs, name);
            }
        } finally {
            Object.assign(queries, real);
            engine.clearCaches();
        }
    });

    test('the rows in scope are the rows the table shows for the same search and filters', async () => {
        const fixture = fixtures.cleanEvents();
        const table = await build(fixture);
        const known = fixture.columns.map(column => column.id);
        const model = await modelOf(fixture);
        for (const query of [{}, { q: 'ontario' }, { filters: { Status: 'Active' } }, { q: '2019', filters: { Jurisdiction: 'Quebec' } },
            { filters: { 'Share capital': { op: 'gte', value: '25000' } } }, { filters: { Status: 'Nothing' } }]) {
            const filters = parseFilters(query.filters ? JSON.stringify(query.filters) : undefined);
            const where = buildWhereAndParams({ knownColumns: known, q: query.q, filters });
            const plan = planOf(table, model);
            const batch = await queries.runBatch({ ...plan, where: where.whereSql ? where : null }, { timeoutMs: 15000 });
            const page = await queryStoreTable({ tableName: table.tableName, knownColumns: known, q: query.q, filters, sortSql: null, limit: 1, offset: 0 });
            assert.equal(batch.grand.n + batch.grand.nx, page.total, JSON.stringify(query));
            // Every complete set adds up to the rows in scope.
            for (const groups of batch.sets) {
                if (groups.length && groups.length === groups[0].groups) assert.equal(groups.reduce((sum, group) => sum + group.n + group.nx, 0), page.total);
            }
        }
    });

    test('a statement that runs out of time leaves its connection and its snapshot lease usable', async () => {
        const slow = { text: 'SELECT pg_sleep(2)' };
        await assert.rejects(queries.bounded(slow, { timeoutMs: 100 }), error => error.code === '57014');
        assert.equal((await pool.query('SELECT 1 AS one')).rows[0].one, 1);
        await withSnapshot('chart-parity-' + crypto.randomBytes(4).toString('hex'), async () => {
            const leased = snapshotDb();
            assert.notEqual(leased, pool);
            await assert.rejects(queries.bounded(slow, { timeoutMs: 100 }), error => error.code === '57014');
            // The lease's connection is out of the failed transaction and still holds its lock.
            assert.equal((await leased.query('SELECT 1 AS one')).rows[0].one, 1);
            const ok = await queries.bounded({ text: 'SELECT current_setting(\'transaction_read_only\') AS read_only, current_setting(\'statement_timeout\') AS timeout' },
                { timeoutMs: 4000 });
            assert.deepEqual(ok.rows[0], { read_only: 'on', timeout: '4s' });
            // The bounds were local to that statement.
            assert.equal((await leased.query('SELECT current_setting(\'transaction_read_only\') AS read_only')).rows[0].read_only, 'off');
        });
        // Writing through a bounded statement is refused.
        await assert.rejects(queries.bounded({ text: 'CREATE TABLE store.r_should_not_exist (a int)' }, { timeoutMs: 4000 }), error => error.code === '25006');
    });
}
