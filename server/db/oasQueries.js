const pool = require('./pool');
const { OAS_DATASET_ID } = require('../utils/oasLabels');
const { inTransaction } = require('./transaction');
const { listDatasetFiles } = require('./datasetFileQueries');
const { getProgress, setProgress } = require('./catalogWriteQueries');

// Writes come only from the deployment owner's load-oas-amounts job; the API reads.

// The dataset's CSV files (the publisher lists each one as English and French), with
// what services/resourceVersion.js needs.
function listOasResources(db = pool) {
    return listDatasetFiles({ datasetId: OAS_DATASET_ID, formats: ['CSV'] }, db);
}

// Every loaded table of every quarter: which resource and version it came from.
async function listOasFiles(db = pool) {
    const { rows } = await db.query(`
        SELECT period_key, table_no, income_year, resource_id, source_version, content_sha256, row_count, loaded_at
        FROM oas_files ORDER BY period_key, table_no
    `);
    return rows;
}

const ROW_COLUMNS = ['line', 'income_from_cents', 'income_to_cents', 'amount_cents', 'allowance_cents',
    'with_oas_65_cents', 'with_oas_75_cents'];

// Replaces one table of one quarter, its oas_files row and its rows, in one
// transaction. loaded_at is the clock's time, not the transaction's.
async function saveOasTable({ resource_id: resourceId, version, table }, db = pool) {
    return inTransaction(db, async client => {
        await client.query(`
            INSERT INTO oas_files (period_key, table_no, benefit_year, benefit_quarter, income_year, resource_id,
                source_version, content_sha256, row_count, loaded_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
            ON CONFLICT (period_key, table_no) DO UPDATE SET benefit_year = EXCLUDED.benefit_year,
                benefit_quarter = EXCLUDED.benefit_quarter, income_year = EXCLUDED.income_year,
                resource_id = EXCLUDED.resource_id, source_version = EXCLUDED.source_version,
                content_sha256 = EXCLUDED.content_sha256, row_count = EXCLUDED.row_count, loaded_at = EXCLUDED.loaded_at
        `, [table.period_key, table.table, table.year, table.quarter, table.income_year, resourceId, version, table.hash,
            table.rows.length]);
        await client.query('DELETE FROM oas_rows WHERE period_key = $1 AND table_no = $2', [table.period_key, table.table]);
        await client.query(`
            INSERT INTO oas_rows (period_key, table_no, ${ROW_COLUMNS.join(', ')})
            SELECT $1, $2, * FROM unnest(${ROW_COLUMNS.map((_, index) => `$${index + 3}::int[]`).join(', ')})
        `, [table.period_key, table.table, ...ROW_COLUMNS.map(name => table.rows.map(row => row[name] ?? null))]);
        return table.rows.length;
    }, 'oas_amounts');
}

// The same rows published again (a new upload, or a new resource for the same table):
// only where they came from changes, so loaded_at keeps saying when the amounts changed.
async function touchOasTable({ period_key: period, table, resource_id: resourceId, version }, db = pool) {
    const { rowCount } = await db.query(`
        UPDATE oas_files SET resource_id = $3, source_version = $4 WHERE period_key = $1 AND table_no = $2
    `, [period, table, resourceId, version]);
    return rowCount;
}

// The quarters the pages can show (all five tables loaded), oldest first.
async function listOasPeriods(db = pool) {
    const { rows } = await db.query(`
        SELECT period_key, benefit_year, benefit_quarter, income_year, loaded_at FROM oas_periods ORDER BY period_key
    `);
    return rows;
}

// ---- Reads for the /oas pages ------------------------------------------------------

// One quarter that can be shown, with its five tables and every income band, read in
// one statement so a load in progress is never seen half-applied: the newest complete
// quarter, or the complete quarter with the given key. null when there is none. Each
// band is [income_from, income_to, amount, allowance, with_oas_65, with_oas_75] in cents.
async function getOasPeriod({ period = null } = {}, db = pool) {
    const { rows } = await db.query(`
        WITH chosen AS (
            SELECT period_key, benefit_year, benefit_quarter, income_year, loaded_at FROM oas_periods
            WHERE $1::int IS NULL OR period_key = $1 ORDER BY period_key DESC LIMIT 1
        )
        SELECT c.period_key, c.benefit_year, c.benefit_quarter, c.income_year, c.loaded_at,
            (SELECT jsonb_agg(jsonb_build_object('table', f.table_no, 'resource_id', f.resource_id, 'loaded_at', f.loaded_at,
                    'rows', (SELECT jsonb_agg(jsonb_build_array(r.income_from_cents, r.income_to_cents, r.amount_cents,
                            r.allowance_cents, r.with_oas_65_cents, r.with_oas_75_cents) ORDER BY r.line)
                        FROM oas_rows r WHERE r.period_key = f.period_key AND r.table_no = f.table_no))
                    ORDER BY f.table_no)
                FROM oas_files f WHERE f.period_key = c.period_key) AS tables
        FROM chosen c
    `, [period]);
    return rows[0] || null;
}

// What the job remembers between runs about resources it did not load: the version
// that failed (why, and when it was last tried), was superseded by another resource
// (which one, at which version) or holds an unknown table.
const MEMORY_KEY = 'oas-amounts';
async function getOasMemory(db = pool) {
    const value = await getProgress(db, MEMORY_KEY);
    return value && typeof value.files === 'object' && value.files !== null && !Array.isArray(value.files) ? value.files : {};
}
async function saveOasMemory(files, db = pool) {
    await setProgress(db, MEMORY_KEY, { files });
}

module.exports = {
    MEMORY_KEY, listOasResources, listOasFiles, saveOasTable, touchOasTable, listOasPeriods, getOasPeriod, getOasMemory, saveOasMemory
};
