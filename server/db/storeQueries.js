const pool = require('./pool');
const AppError = require('../utils/AppError');
const { buildWhere, quoteIdent } = require('../utils/filterGrammar');

const TABLE_NAME_RE = /^r_[0-9a-f_]+$/;

async function queryStoreTable({ tableName, knownColumns, q, filters, sortSql, limit, offset }) {
    if (!TABLE_NAME_RE.test(tableName)) {
        throw new AppError('invalid store table name', 500);
    }
    const table = 'store.' + quoteIdent(tableName);

    const { clause, params, nextIndex } = buildWhere(filters || [], knownColumns, 1);

    let qClause = '';
    let qParamIndex = nextIndex;
    if (q && typeof q === 'string' && q.trim() !== '' && knownColumns.length > 0) {
        qClause = '(' + knownColumns.map(c => quoteIdent(c) + '::text ILIKE $' + qParamIndex).join(' OR ') + ')';
        params.push('%' + q + '%');
    }

    const whereParts = [clause, qClause].filter(s => s !== '');
    const whereSql = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';

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

async function touchLastAccessed(resourceId) {
    await pool.query('UPDATE ingested_resources SET last_accessed_at = now() WHERE resource_id = $1', [resourceId]);
}

module.exports = { queryStoreTable, touchLastAccessed, TABLE_NAME_RE };
