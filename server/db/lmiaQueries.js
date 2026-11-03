const pool = require('./pool');
const { LMIA_DATASET_ID } = require('../services/lmiaHistory');

// Writes come only from the deployment owner's build-lmia-history job; the API reads.

// Runs fn(client) in a transaction. A pool client passed in (the integration tests'
// connection, already inside their transaction) gets a savepoint instead.
async function inTransaction(db, fn) {
    if (typeof db.release === 'function') {
        await db.query('SAVEPOINT lmia_history');
        try {
            const result = await fn(db);
            await db.query('RELEASE SAVEPOINT lmia_history');
            return result;
        } catch (error) {
            await db.query('ROLLBACK TO SAVEPOINT lmia_history');
            throw error;
        }
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// The dataset's English files with what services/resourceVersion.js needs: a narrow
// slice of `raw`, never the whole record.
async function listLmiaResources(db = pool) {
    const { rows } = await db.query(`
        SELECT r.id, r.name_en, r.name_fr, r.url, r.format, r.size_bytes, r.last_modified,
            jsonb_build_object('record_count', r.raw->'record_count', 'field_count', r.raw->'field_count',
                'source_hash', r.raw->'source_hash', 'hash', r.raw->'hash', 'data_processed', r.raw->'data_processed',
                'rows_updated_at', r.raw->'rows_updated_at', 'view_last_modified', r.raw->'view_last_modified') AS raw
        FROM resources r
        WHERE r.dataset_id = $1 AND r.language = 'en' AND upper(r.format) IN ('CSV', 'XLS', 'XLSX') AND r.url IS NOT NULL
        ORDER BY r.id
    `, [LMIA_DATASET_ID]);
    return rows;
}

async function listLmiaFiles(db = pool) {
    const { rows } = await db.query(`
        SELECT resource_id, period_key, source_version, loaded_at, failure, failed_version
        FROM lmia_files ORDER BY period_key
    `);
    return rows;
}

const ROW_COLUMNS = [
    ['line', 'int'], ['province', 'text'], ['stream', 'text'], ['employer', 'text'], ['employer_key', 'text'],
    ['address', 'text'], ['city', 'text'], ['occupation_code', 'text'], ['occupation_title', 'text'],
    ['noc_version', 'smallint'], ['incorporation', 'text'], ['approved_lmias', 'int'], ['approved_positions', 'int']
];
const BATCH = 5000;

// Replaces one file's rows and its lmia_files row in one transaction. Another file
// holding the same period (a corrected file published as a new resource) goes, with
// its rows.
async function saveLmiaFile({ file, version, counts, rows }, db = pool) {
    return inTransaction(db, async client => {
        await client.query('DELETE FROM lmia_files WHERE period_key = $1 AND resource_id <> $2', [file.period.key, file.id]);
        await client.query(`
            INSERT INTO lmia_files (resource_id, period_key, period_kind, period_start, period_end, source_version, loaded_at,
                row_count, employers, positions, lmias, noc_version)
            VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11)
            ON CONFLICT (resource_id) DO UPDATE SET period_key = EXCLUDED.period_key, period_kind = EXCLUDED.period_kind,
                period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
                source_version = EXCLUDED.source_version, loaded_at = EXCLUDED.loaded_at, row_count = EXCLUDED.row_count,
                employers = EXCLUDED.employers, positions = EXCLUDED.positions, lmias = EXCLUDED.lmias,
                noc_version = EXCLUDED.noc_version, failure = NULL, failed_version = NULL, failed_at = NULL
        `, [file.id, file.period.key, file.period.kind, file.period.start, file.period.end, version,
            counts.row_count, counts.employers, counts.positions, counts.lmias, counts.noc_version]);
        await client.query('DELETE FROM lmia_positive_rows WHERE resource_id = $1', [file.id]);
        const casts = ROW_COLUMNS.map(([, type], index) => `$${index + 3}::${type}[]`).join(', ');
        for (let start = 0; start < rows.length; start += BATCH) {
            const batch = rows.slice(start, start + BATCH);
            await client.query(`
                INSERT INTO lmia_positive_rows (resource_id, period_key, ${ROW_COLUMNS.map(([name]) => name).join(', ')})
                SELECT $1, $2, * FROM unnest(${casts})
            `, [file.id, file.period.key, ...ROW_COLUMNS.map(([name]) => batch.map(row => row[name] ?? null))]);
        }
        return rows.length;
    });
}

// A failed attempt keeps the file's last good rows. A file never loaded gets a row
// with its period and the failure, unless another file already holds that period.
async function saveLmiaFailure({ file, version, failure }, db = pool) {
    await db.query(`
        WITH updated AS (
            UPDATE lmia_files SET failure = $6, failed_version = $7, failed_at = now() WHERE resource_id = $1 RETURNING 1
        )
        INSERT INTO lmia_files (resource_id, period_key, period_kind, period_start, period_end, failure, failed_version, failed_at)
        SELECT $1, $2, $3, $4, $5, $6, $7, now() WHERE NOT EXISTS (SELECT 1 FROM updated)
        ON CONFLICT DO NOTHING
    `, [file.id, file.period.key, file.period.kind, file.period.start, file.period.end, failure, version]);
}

async function refreshLmiaEmployers(db = pool) {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.lmia_employers');
    await db.query('ANALYZE public.lmia_positive_rows');
}

// ---- Reads for the /lmia pages ----------------------------------------------------

const PERIOD_COLUMNS = `resource_id, period_key, period_kind, period_start::text AS period_start, period_end::text AS period_end,
    row_count, employers, positions, lmias, noc_version`;

// Every loaded period, the number of employers across them and when the last file
// loaded, and for the newest period its provinces, streams, top occupations and top
// employers by approved positions. null before the first load.
async function getLmiaSummary(db = pool) {
    const { rows: periods } = await db.query(`
        SELECT ${PERIOD_COLUMNS} FROM lmia_files WHERE loaded_at IS NOT NULL ORDER BY period_key
    `);
    if (!periods.length) return null;
    const latest = periods[periods.length - 1];
    const id = [latest.resource_id];
    // One query at a time: a pool client (the tests') cannot run them together.
    const provinces = await db.query(`
        SELECT province, count(DISTINCT employer_key)::int AS employers, sum(approved_positions)::int AS positions
        FROM lmia_positive_rows WHERE resource_id = $1 AND province IS NOT NULL
        GROUP BY province ORDER BY positions DESC, province
    `, id);
    const streams = await db.query(`
        SELECT stream, count(DISTINCT employer_key)::int AS employers, sum(approved_positions)::int AS positions
        FROM lmia_positive_rows WHERE resource_id = $1 AND stream IS NOT NULL
        GROUP BY stream ORDER BY positions DESC, stream
    `, id);
    const occupations = await db.query(`
        SELECT occupation_code AS code, mode() WITHIN GROUP (ORDER BY occupation_title) AS title,
            min(noc_version)::int AS noc_version, count(DISTINCT employer_key)::int AS employers,
            sum(approved_positions)::int AS positions
        FROM lmia_positive_rows WHERE resource_id = $1 AND occupation_code IS NOT NULL
        GROUP BY occupation_code ORDER BY positions DESC, code LIMIT 15
    `, id);
    const employers = await db.query(`
        SELECT employer_key, (array_agg(employer ORDER BY line))[1] AS employer,
            (array_agg(province ORDER BY line))[1] AS province,
            (array_agg(city ORDER BY line) FILTER (WHERE city IS NOT NULL))[1] AS city,
            sum(approved_positions)::int AS positions
        FROM lmia_positive_rows WHERE resource_id = $1
        GROUP BY employer_key ORDER BY positions DESC, employer_key LIMIT 10
    `, id);
    const { rows: [totals] } = await db.query(`
        SELECT (SELECT count(*)::int FROM lmia_employers) AS employers_total,
            (SELECT max(loaded_at) FROM lmia_files) AS updated_at
    `);
    return { latest, periods, employers_total: totals.employers_total, updated_at: totals.updated_at,
        provinces: provinces.rows, streams: streams.rows, occupations: occupations.rows, top_employers: employers.rows };
}

// Employers whose key contains the searched key, optionally in a province or with an
// occupation code in any period. Exact and leading matches first, then the most
// recent and largest.
async function searchLmiaEmployers({ key = '', province = null, occupation = null, limit = 50, offset = 0 }, db = pool) {
    const { rows } = await db.query(`
        SELECT employer_key, employer, province, city, provinces, first_period, last_period, periods, positions,
            last_positions, count(*) OVER ()::int AS total
        FROM lmia_employers
        WHERE ($1 = '' OR employer_key LIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR provinces @> ARRAY[$2]::text[])
            AND ($3::text IS NULL OR occupations @> ARRAY[$3]::text[])
        ORDER BY (employer_key = $1) DESC, (employer_key LIKE $1 || '%') DESC, last_period DESC,
            last_positions DESC NULLS LAST, employer_key
        LIMIT $4 OFFSET $5
    `, [key, province, occupation, limit, offset]);
    return { total: rows.length ? rows[0].total : 0, rows: rows.map(({ total: _total, ...row }) => row) };
}

// Every line of one employer, newest period first, with each period's file.
async function getLmiaEmployerRows(key, { limit = 3000 } = {}, db = pool) {
    const { rows } = await db.query(`
        SELECT r.period_key, f.period_kind, f.period_start::text AS period_start, f.period_end::text AS period_end,
            r.resource_id, r.line, r.province, r.stream, r.employer, r.address, r.city, r.occupation_code,
            r.occupation_title, r.noc_version, r.incorporation, r.approved_lmias, r.approved_positions
        FROM lmia_positive_rows r JOIN lmia_files f ON f.resource_id = r.resource_id
        WHERE r.employer_key = $1 AND f.loaded_at IS NOT NULL
        ORDER BY r.period_key DESC, r.line
        LIMIT $2
    `, [key, limit]);
    return rows;
}

module.exports = {
    inTransaction, listLmiaResources, listLmiaFiles, saveLmiaFile, saveLmiaFailure, refreshLmiaEmployers,
    getLmiaSummary, searchLmiaEmployers, getLmiaEmployerRows
};
