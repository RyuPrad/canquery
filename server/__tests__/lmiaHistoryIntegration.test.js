const { Pool } = require('pg');
const queries = require('../db/lmiaQueries');
const { normalizeRecords, fileSummary, lmiaPeriod, LMIA_DATASET_ID } = require('../services/lmiaHistory');
const { resourceVersion } = require('../services/resourceVersion');
const url = process.env.SPATIAL_TEST_DATABASE_URL;
const integrationDescribe = url ? describe : describe.skip;

const HEADER = ['Province/Territory', 'Program Stream', 'Employer', 'Address', 'Occupation', 'Incorporate Status',
    'Approved LMIAs', 'Approved Positions'];

// Periods in the year 2999 keep these files apart from any real list in the database.
integrationDescribe('LMIA history PostgreSQL integration', () => {
    let pool, db;
    const prefix = 'lmia_history_' + process.pid;
    const id = name => prefix + '_' + name;
    // Periods in 2999 are plausible only to a run that believes it is 2999.
    const file = (key, name) => ({ id: id(key), period: lmiaPeriod(name, { now: new Date('2999-07-01T00:00:00Z') }) });
    const parse = rows => {
        const { rows: parsed } = normalizeRecords([HEADER, ...rows]);
        return { rows: parsed, counts: fileSummary(parsed) };
    };
    const q2 = file('q2', '2999Q2-Employers Who Were Issued a Positive LMIA');
    const q1 = file('q1', '2999Q1-Employers Who Were Issued a Positive LMIA');
    const q2rows = parse([
        ['Ontario', 'High Wage', 'Zqx Danchar Ltd', 'Toronto, ON M5J 2X5', '72310-Carpenters', 'Corporation', '2', '5'],
        ['Ontario', 'High Wage', 'Zqx Danchar Ltd', 'Toronto, ON M5J 2X5', '72311-Cabinetmakers', 'Corporation', '1', '1'],
        ['Manitoba', 'Primary Agriculture', 'Zqx Prairie Farms', 'Brandon, MB R7A 1A1', '85100-Livestock labourers', 'Unknown', '1', '9'],
        ['British Columbia', 'Low Wage', 'Zqx Danchar Construction', 'Vancouver, BC V6B 1A1', '72310-Carpenters', 'Unknown', '1', '2']
    ]);
    const q1rows = parse([
        ['Alberta', 'High Wage', 'ZQX DANCHAR LTD.', 'Calgary, AB T2P 1J9', '72310-Carpenters', 'Corporation', '1', '3'],
        ['Quebec', 'Low Wage', 'Zqx Équipements Lafontaine inc.', 'Saint-Évariste, QC G0M 1S0', '75101-Material handlers', 'Unknown', '1', '4']
    ]);

    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        db = await pool.connect();
        await db.query('BEGIN');
        await db.query(`INSERT INTO datasets (id, name, title_en) VALUES ($1, $1, 'LMIA') ON CONFLICT (id) DO NOTHING`, [LMIA_DATASET_ID]);
        for (const [key, language, format, name] of [
            ['q2', 'en', 'XLSX', '2999Q2-Employers Who Were Issued a Positive LMIA'],
            ['q1', 'en', 'CSV', '2999Q1-Employers Who Were Issued a Positive LMIA'],
            ['q2_fr', 'fr', 'XLSX', '2999Q2-Employeurs ayant obtenu une EIMT positive'],
            ['notes', 'en', 'PDF', 'Data notes']
        ]) {
            await db.query(`INSERT INTO resources (id, dataset_id, name_en, language, format, url, size_bytes, last_modified, raw)
                VALUES ($1, $2, $3, $4, $5, $6, 4096, '2999-07-20T00:00:00Z', $7)`,
            [id(key), LMIA_DATASET_ID, name, language, format, 'https://files.example.test/' + key, { source_hash: 'h-' + key, unrelated: 'x' }]);
        }
    });
    afterAll(async () => {
        if (db) { await db.query('ROLLBACK'); db.release(); }
        if (pool) await pool.end();
    });
    const mine = rows => rows.filter(row => String(row.id || row.resource_id).startsWith(prefix));

    test('lists the English CSV and Excel files with the slice the version needs', async () => {
        const rows = mine(await queries.listLmiaResources(db));
        expect(rows.map(row => row.id)).toEqual([id('q1'), id('q2')]);
        const { rows: [full] } = await db.query('SELECT * FROM resources WHERE id = $1', [id('q2')]);
        expect(resourceVersion(rows[1])).toBe(resourceVersion(full));
        expect(rows[1].raw.unrelated).toBeUndefined();
    });

    test('loads files, refreshes the employers and answers the summary, search and employer reads', async () => {
        expect(await queries.saveLmiaFile({ file: q2, version: 'v-q2', ...q2rows }, db)).toBe(4);
        await queries.saveLmiaFile({ file: q1, version: 'v-q1', ...q1rows }, db);
        const files = mine(await queries.listLmiaFiles(db));
        expect(files.map(f => [f.period_key, f.source_version, f.failure])).toEqual([[299903, 'v-q1', null], [299906, 'v-q2', null]]);
        expect(await queries.lmiaEmployersBehind(db)).toBe(true);
        await queries.refreshLmiaEmployers(db);
        expect(await queries.lmiaEmployersBehind(db)).toBe(false);

        const { rows: [danchar] } = await db.query("SELECT * FROM lmia_employers WHERE employer_key = 'zqx danchar'");
        expect(danchar).toMatchObject({ employer: 'Zqx Danchar Ltd', province: 'ON', city: 'Toronto', provinces: ['AB', 'ON'],
            occupations: ['72310', '72311'], first_period: 299903, last_period: 299906, periods: 2, positions: 9, last_positions: 6 });

        const found = await queries.searchLmiaEmployers({ key: 'zqx danchar' }, db);
        expect(found.total).toBe(2);
        expect(found.rows.map(row => row.employer_key)).toEqual(['zqx danchar', 'zqx danchar construction']);
        const inManitoba = await queries.searchLmiaEmployers({ key: 'zqx', province: 'MB' }, db);
        expect(inManitoba.rows.map(row => row.employer_key)).toEqual(['zqx prairie farms']);
        const carpenters = await queries.searchLmiaEmployers({ key: 'zqx', occupation: '72310' }, db);
        expect(carpenters.rows.map(row => row.employer_key).sort()).toEqual(['zqx danchar', 'zqx danchar construction']);
        const second = await queries.searchLmiaEmployers({ key: 'zqx', limit: 2, offset: 2 }, db);
        expect(second).toMatchObject({ total: 4 });
        expect(second.rows).toHaveLength(2);
        expect(await queries.searchLmiaEmployers({ key: 'zqx', limit: 2, offset: 10 }, db)).toEqual({ total: 4, rows: [] });
        await expect(queries.searchLmiaEmployers({ key: 'zqx%' }, db)).rejects.toThrow(TypeError);

        const summary = await queries.getLmiaSummary(db);
        expect(summary.latest).toMatchObject({ resource_id: id('q2'), period_key: 299906, period_kind: 'quarter',
            period_start: '2999-04-01', period_end: '2999-06-30', row_count: 4, employers: 3, positions: 17, lmias: 5, noc_version: 2021 });
        expect(summary.periods.slice(-2).map(p => p.period_key)).toEqual([299903, 299906]);
        expect(summary.employers_total).toBeGreaterThanOrEqual(4);
        expect(summary.updated_at).toBeInstanceOf(Date);
        expect(summary.provinces).toEqual([{ province: 'MB', employers: 1, positions: 9 }, { province: 'ON', employers: 1, positions: 6 },
            { province: 'BC', employers: 1, positions: 2 }]);
        expect(summary.streams[0]).toEqual({ stream: 'Primary Agriculture', employers: 1, positions: 9 });
        expect(summary.occupations[0]).toMatchObject({ code: '85100', title: 'Livestock labourers', noc_version: 2021, positions: 9 });
        expect(summary.occupations.find(o => o.code === '72310')).toMatchObject({ employers: 2, positions: 7 });
        expect(summary.top_employers.map(e => [e.employer_key, e.positions, e.city])).toEqual([
            ['zqx prairie farms', 9, 'Brandon'], ['zqx danchar', 6, 'Toronto'], ['zqx danchar construction', 2, 'Vancouver']]);

        const history = await queries.getLmiaEmployerRows('zqx danchar', {}, db);
        expect(history.map(row => [row.period_key, row.employer, row.province, row.occupation_code, row.approved_positions])).toEqual([
            [299906, 'Zqx Danchar Ltd', 'ON', '72310', 5], [299906, 'Zqx Danchar Ltd', 'ON', '72311', 1],
            [299903, 'ZQX DANCHAR LTD.', 'AB', '72310', 3]]);
        expect(history[0]).toMatchObject({ period_kind: 'quarter', period_end: '2999-06-30', resource_id: id('q2') });
        expect(await queries.getLmiaEmployerRows('zqx nobody', {}, db)).toEqual([]);
    });

    test('a corrected file for a period replaces the earlier one with its rows', async () => {
        const corrected = { id: id('q2_corrected'), period: q2.period };
        await queries.saveLmiaFile({ file: corrected, version: 'v-c', ...parse([
            ['Ontario', 'High Wage', 'Zqx Danchar Ltd', 'Toronto, ON M5J 2X5', '72310-Carpenters', 'Corporation', '1', '1']]) }, db);
        expect(mine(await queries.listLmiaFiles(db)).map(f => f.resource_id)).toEqual([id('q1'), id('q2_corrected')]);
        const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM lmia_positive_rows WHERE resource_id = $1', [id('q2')]);
        expect(count).toBe(0);
    });

    test('a failure keeps loaded rows; a file never loaded is recorded but not read', async () => {
        await queries.saveLmiaFailure({ file: q1, version: 'v-q1b', failure: 'gone' }, db);
        const fresh = file('q3', '2999Q3-Employers Who Were Issued a Positive LMIA');
        await queries.saveLmiaFailure({ file: fresh, version: 'v-q3', failure: 'too_few_rows' }, db);
        // Another resource cannot record a failure over a period a loaded file holds.
        await queries.saveLmiaFailure({ file: { id: id('q1_dupe'), period: q1.period }, version: 'v', failure: 'error' }, db);
        const files = mine(await queries.listLmiaFiles(db));
        expect(files.map(f => [f.resource_id, f.source_version, f.failure, f.failed_version])).toEqual([
            [id('q1'), 'v-q1', 'gone', 'v-q1b'], [id('q2_corrected'), 'v-c', null, null], [id('q3'), null, 'too_few_rows', 'v-q3']]);
        const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM lmia_positive_rows WHERE resource_id = $1', [id('q1')]);
        expect(count).toBe(2);
        const summary = await queries.getLmiaSummary(db);
        expect(summary.latest.resource_id).toBe(id('q2_corrected'));
        expect(summary.periods.some(p => p.resource_id === id('q3'))).toBe(false);
    });

    test('the table refuses keys and codes outside their shape', async () => {
        await db.query('SAVEPOINT shape');
        await expect(db.query(`INSERT INTO lmia_positive_rows (resource_id, line, period_key, employer, employer_key, approved_positions)
            VALUES ($1, 999, 299903, 'X', 'Not A Key', 1)`, [id('q1')])).rejects.toMatchObject({ code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT shape');
        await expect(db.query(`INSERT INTO lmia_positive_rows (resource_id, line, period_key, employer, employer_key, occupation_code,
            approved_positions) VALUES ($1, 999, 299903, 'X', 'x', '123', 1)`, [id('q1')])).rejects.toMatchObject({ code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT shape');
    });
});
