const pool = require('./pool');
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

async function queryStoreTable({ tableName, knownColumns, q, filters, sortSql, limit, offset }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    const table = 'store.' + quoteIdent(tableName);

    const { whereSql, params } = buildWhereAndParams({ knownColumns, q, filters });

    const orderSql = ' ORDER BY ' + (sortSql || '"_id" ASC');

    const countResult = await pool.query('SELECT count(*)::bigint AS total FROM ' + table + whereSql, params);
    const total = Number(countResult.rows[0].total);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const pageResult = await pool.query(
        'SELECT * FROM ' + table + whereSql + orderSql + ' LIMIT $' + limitIdx + ' OFFSET $' + offsetIdx,
        params.concat([limit, offset])
    );

    return { records: pageResult.rows, total };
}

async function aggregateStoreTable({ tableName, knownColumns, q, filters, groupBy, agg, aggColumn, bucket, sortSql, limit, offset }) {
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

    const countResult = await pool.query(
        'SELECT count(*)::int AS total FROM (SELECT 1 FROM ' + table + whereSql + ' GROUP BY ' + keyExpr + ') g',
        params
    );

    const orderSql = sortSql ? (sortSql.indexOf('"value"') === 0 ? sortSql + ', "key" ASC' : sortSql) : '"key" ASC';
    const pageResult = await pool.query(
        'SELECT ' + keyExpr + ' AS "key", ' + valueExpr + ' AS "value" FROM ' + table + whereSql + ' GROUP BY 1 ORDER BY ' + orderSql + ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
        params.concat([limit, offset])
    );

    return { records: pageResult.rows, total: Number(countResult.rows[0].total) };
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

    const { rows } = await pool.query('SELECT ' + selects.join(', ') + ' FROM ' + table);
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

async function touchLastAccessed(resourceId) {
    await pool.query('UPDATE ingested_resources SET last_accessed_at = now() WHERE resource_id = $1', [resourceId]);
}

module.exports = { queryStoreTable, touchLastAccessed, TABLE_NAME_RE, aggregateStoreTable, profileStoreTable };
