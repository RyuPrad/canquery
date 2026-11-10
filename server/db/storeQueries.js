const { snapshotDb } = require('./snapshotRead');
const AppError = require('../utils/AppError');
const { buildWhere, quoteIdent } = require('../utils/filterGrammar');

const TABLE_NAME_RE = /^r_[0-9a-f_]+$/;
const AGG_FNS = new Set(['count', 'sum', 'avg', 'min', 'max']);
const BUCKETS = new Set(['year', 'month', 'day']);

// Profiling a very wide table means one count(distinct) per column in a single
// scan - bounded so a pathological 120-column table can't blow up the query.
const PROFILE_MAX_COLS = 60;

function buildWhereAndParams({ knownColumns, q, filters }) {
    const { clause, params, nextIndex } = buildWhere(filters || [], knownColumns, 1);

    let qClause = '';
    let qParamIndex = nextIndex;
    if (q && typeof q === 'string' && q.trim() !== '' && knownColumns.length > 0) {
        qClause = '(' + knownColumns.map(c => quoteIdent(c) + '::text ILIKE $' + qParamIndex).join(' OR ') + ')';
        params.push('%' + q + '%');
    }

    const whereParts = [clause, qClause].filter(s => s !== '');
    const whereSql = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';

    return { whereSql, params };
}

async function queryStoreTable({ tableName, knownColumns, q, filters, sortSql, limit, offset, includeTotal = true, snapshotRowCount }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    const table = 'store.' + quoteIdent(tableName);

    const { whereSql, params } = buildWhereAndParams({ knownColumns, q, filters });

    const tieBreaker = sortSql && !sortSql.startsWith('"_id" ') ? ', "_id" ASC' : '';
    const orderSql = ' ORDER BY ' + (sortSql || '"_id" ASC') + tieBreaker;

    let total = null;
    if (includeTotal) {
        const knownTotal = snapshotRowCount === null || snapshotRowCount === undefined || snapshotRowCount === ''
            ? NaN : Number(snapshotRowCount);
        if (!whereSql && Number.isSafeInteger(knownTotal) && knownTotal >= 0) total = knownTotal;
        else {
            const countResult = await snapshotDb().query('SELECT count(*)::bigint AS total FROM ' + table + whereSql, params);
            total = Number(countResult.rows[0].total);
        }
    }

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const pageResult = await snapshotDb().query(
        'SELECT * FROM ' + table + whereSql + orderSql + ' LIMIT $' + limitIdx + ' OFFSET $' + offsetIdx,
        params.concat([limit, offset])
    );

    return { records: pageResult.rows, total };
}

// The whole of a small snapshot in _id order: one index scan, no count. The
// caller asks for one row more than it accepts, so a stale row count still
// cannot slip a larger table past its cap.
async function readStoreRows({ tableName, limit }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    const result = await snapshotDb().query(
        'SELECT * FROM store.' + quoteIdent(tableName) + ' ORDER BY "_id" ASC LIMIT $1', [limit]);
    return { records: result.rows };
}

// The rows a search matches, each with a fingerprint of its content: the md5
// of the row's values as text, in column order, without the generated _id,
// which is only the record's position in its file. A copy rebuilt from an
// unchanged file gives the same fingerprints whatever its row order, and also
// when a column's inferred type changed (a number column that became text
// keeps the text of its numbers). A blank cell is one value whatever its
// column's type: the loader keeps it as an empty text in a text column and as
// NULL in a typed one, and both fingerprint alike. A number keeps the digits
// it was written with, and a timestamp is its instant.
// The WHERE clause is the table query's, so this matches exactly the rows the
// table shows for the same search and filters. Rows come in _id order; a
// caller with a cap asks for one row more than it accepts.
async function matchingRowHashes({ tableName, knownColumns, q, filters, limit }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    const { whereSql, params } = buildWhereAndParams({ knownColumns, q, filters });
    const values = knownColumns.map(column => 'coalesce(' + quoteIdent(column) + '::text, \'\')').join(', ');
    const result = await snapshotDb().query(
        'SELECT "_id", md5(to_jsonb(ARRAY[' + values + ']::text[])::text) AS "hash" FROM store.' + quoteIdent(tableName) +
        whereSql + ' ORDER BY "_id" ASC LIMIT $' + (params.length + 1),
        params.concat([limit])
    );
    return result.rows.map(row => ({ id: String(row._id), hash: row.hash }));
}

// Rows by their _id, in _id order: the few rows a caller shows out of the ones
// matchingRowHashes found in the same snapshot.
async function readStoreRowsByIds({ tableName, ids }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    if (!Array.isArray(ids) || ids.length === 0) return { records: [] };
    const result = await snapshotDb().query(
        'SELECT * FROM store.' + quoteIdent(tableName) + ' WHERE "_id" = ANY($1::bigint[]) ORDER BY "_id" ASC', [ids]);
    return { records: result.rows };
}

async function aggregateStoreTable({ tableName, knownColumns, q, filters, groupBy, agg, aggColumn, bucket, sortSql, limit, offset, includeTotal = true }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    if (!AGG_FNS.has(agg)) {
        throw new AppError('invalid aggregation', 500);
    }
    if (bucket && !BUCKETS.has(bucket)) {
        throw new AppError('invalid aggregation', 500);
    }

    const table = 'store.' + quoteIdent(tableName);
    const keyExpr = bucket ? "date_trunc('" + bucket + "', " + quoteIdent(groupBy) + ')' : quoteIdent(groupBy);
    const valueExpr = agg === 'count' ? 'count(*)' : agg + '(' + quoteIdent(aggColumn) + ')';

    const { whereSql, params } = buildWhereAndParams({ knownColumns, q, filters });

    let total = null;
    if (includeTotal) {
        const countResult = await snapshotDb().query(
            'SELECT count(*)::int AS total FROM (SELECT 1 FROM ' + table + whereSql + ' GROUP BY ' + keyExpr + ') g',
            params
        );
        total = Number(countResult.rows[0].total);
    }

    const orderSql = sortSql ? (sortSql.indexOf('"value"') === 0 ? sortSql + ', "key" ASC' : sortSql) : '"key" ASC';
    const pageResult = await snapshotDb().query(
        'SELECT ' + keyExpr + ' AS "key", ' + valueExpr + ' AS "value" FROM ' + table + whereSql + ' GROUP BY 1 ORDER BY ' + orderSql + ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
        params.concat([limit, offset])
    );

    return { records: pageResult.rows, total };
}

// One-scan column profile that powers the auto-insights dashboard: per column
// we learn distinct/null counts (to tell a categorical dimension from a unique
// identifier) plus numeric/date ranges (for KPI cards). Column ids come from
// the trusted ingested_resources.columns metadata and are double-quoted; the
// table name is regex-validated. Indexed aliases (d0/n0/mn0/...) sidestep the
// 63-char identifier ceiling and any awkward characters in real column names.
async function profileStoreTable({ tableName, columns }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    const table = 'store.' + quoteIdent(tableName);
    const cols = (columns || []).filter(c => c && c.id !== '_id').slice(0, PROFILE_MAX_COLS);

    const selects = ['count(*)::bigint AS "__total"'];
    cols.forEach((c, i) => {
        const ident = quoteIdent(c.id);
        selects.push('count(distinct ' + ident + ')::bigint AS "d' + i + '"');
        selects.push('count(*) FILTER (WHERE ' + ident + ' IS NULL)::bigint AS "n' + i + '"');
        if (c.type === 'INTEGER' || c.type === 'NUMERIC') {
            selects.push('min(' + ident + ')::double precision AS "mn' + i + '"');
            selects.push('max(' + ident + ')::double precision AS "mx' + i + '"');
            selects.push('avg(' + ident + ')::double precision AS "av' + i + '"');
        } else if (c.type === 'DATE' || c.type === 'TIMESTAMPTZ') {
            selects.push('min(' + ident + ')::text AS "mn' + i + '"');
            selects.push('max(' + ident + ')::text AS "mx' + i + '"');
        }
    });

    const { rows } = await snapshotDb().query('SELECT ' + selects.join(', ') + ' FROM ' + table);
    const r = rows[0] || {};
    const profiled = cols.map((c, i) => {
        const out = { id: c.id, type: c.type, distinct: Number(r['d' + i]), nulls: Number(r['n' + i]) };
        if (r['mn' + i] !== undefined && r['mn' + i] !== null) out.min = r['mn' + i];
        if (r['mx' + i] !== undefined && r['mx' + i] !== null) out.max = r['mx' + i];
        if (r['av' + i] !== undefined && r['av' + i] !== null) out.avg = Number(r['av' + i]);
        return out;
    });

    return { rowCount: Number(r.__total || 0), columns: profiled };
}

async function touchLastAccessed(resourceId, tableName) {
    // Reuse the reader's connection: waiting on a second pool connection while
    // all readers hold one would deadlock. Only renew the snapshot actually used.
    const result = await snapshotDb().query(`UPDATE ingested_resources
        SET last_accessed_at = GREATEST(last_accessed_at, clock_timestamp())
        WHERE resource_id = $1 AND table_name = $2 AND status = 'ready'`, [resourceId, tableName]);
    return result.rowCount === 1;
}

module.exports = { queryStoreTable, readStoreRows, matchingRowHashes, readStoreRowsByIds, touchLastAccessed, TABLE_NAME_RE,
    aggregateStoreTable, profileStoreTable };
