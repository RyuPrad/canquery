const AppError = require('./AppError');

const ALLOWED_OPS = { eq: '=', lt: '<', gt: '>', lte: '<=', gte: '>=', contains: null };

function parseFilters(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return [];
    }
    if (typeof raw !== 'string') {
        throw new AppError('filters must be valid JSON', 400);
    }
    if (raw.length > 2000) {
        throw new AppError('filters too large', 400);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new AppError('filters must be valid JSON', 400);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AppError('filters must be a JSON object', 400);
    }
    const keys = Object.keys(parsed);
    if (keys.length > 20) {
        throw new AppError('too many filters', 400);
    }
    const result = [];
    for (const column of keys) {
        if (typeof column !== 'string' || column.length < 1 || column.length > 63) {
            throw new AppError('invalid filter column', 400);
        }
        const spec = parsed[column];
        if (spec === null || typeof spec === 'string' || typeof spec === 'number' || typeof spec === 'boolean') {
            result.push({ column, op: 'eq', value: spec });
        } else if (typeof spec === 'object' && !Array.isArray(spec)) {
            if (!Object.prototype.hasOwnProperty.call(spec, 'op') || !Object.prototype.hasOwnProperty.call(ALLOWED_OPS, spec.op)) {
                throw new AppError('invalid filter operator', 400);
            }
            const value = spec.value;
            if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                result.push({ column, op: spec.op, value });
            } else {
                throw new AppError('invalid filter value', 400);
            }
        } else {
            throw new AppError('invalid filter value', 400);
        }
    }
    return result;
}

function quoteIdent(name) {
    if (typeof name !== 'string' || name.includes('"') || name.length > 63) {
        throw new AppError('invalid identifier', 400);
    }
    return '"' + name + '"';
}

function buildWhere(filters, knownColumns, startIndex = 1) {
    const known = new Set(knownColumns);
    const clauses = [];
    const params = [];
    let paramIndex = startIndex;

    for (const filter of filters) {
        if (!known.has(filter.column)) {
            throw new AppError(`unknown column: ${filter.column}`, 400);
        }
        const ident = quoteIdent(filter.column);
        const op = filter.op;
        const value = filter.value;

        if (op === 'contains') {
            clauses.push(ident + '::text ILIKE $' + paramIndex);
            params.push('%' + String(value) + '%');
            paramIndex++;
        } else if (value === null && op === 'eq') {
            clauses.push(ident + ' IS NULL');
        } else {
            clauses.push(ident + ' ' + ALLOWED_OPS[op] + ' $' + paramIndex);
            params.push(value);
            paramIndex++;
        }
    }

    return {
        clause: clauses.join(' AND '),
        params: params,
        nextIndex: paramIndex
    };
}

function validateSort(sort, knownColumns) {
    if (sort === undefined || sort === null || sort === '') {
        return null;
    }
    const parts = sort.trim().split(/\s+/);
    if (parts.length === 0 || parts.length > 2) {
        throw new AppError('invalid sort', 400);
    }
    const column = parts[0];
    const directionRaw = parts[1];
    let direction = 'ASC';
    if (directionRaw !== undefined) {
        const dirLower = directionRaw.toLowerCase();
        if (dirLower === 'desc') {
            direction = 'DESC';
        } else if (dirLower === 'asc') {
            direction = 'ASC';
        } else {
            throw new AppError('invalid sort', 400);
        }
    }
    if (!knownColumns.includes(column)) {
        throw new AppError(`unknown sort column: ${column}`, 400);
    }
    return {
        column: column,
        direction: direction,
        sql: quoteIdent(column) + ' ' + direction
    };
}

const AGG_FNS = { count: true, sum: true, avg: true, min: true, max: true };

function validateAggregation(raw, columns) {
    let group_by = raw === undefined || raw === null ? undefined : raw.group_by;
    let agg = raw === undefined || raw === null ? undefined : raw.agg;
    let agg_column = raw === undefined || raw === null ? undefined : raw.agg_column;
    let bucket = raw === undefined || raw === null ? undefined : raw.bucket;

    if (group_by === '') group_by = undefined;
    if (agg === '') agg = undefined;
    if (agg_column === '') agg_column = undefined;
    if (bucket === '') bucket = undefined;

    if (group_by === undefined && agg === undefined && agg_column === undefined && bucket === undefined) {
        return null;
    }

    if (!(group_by !== undefined && agg !== undefined)) {
        throw new AppError('group_by and agg are required together', 400);
    }

    if (!Object.prototype.hasOwnProperty.call(AGG_FNS, agg)) {
        throw new AppError('invalid agg function', 400);
    }

    const groupCol = columns.find(c => c.id === group_by);
    if (!groupCol) {
        throw new AppError('unknown column: ' + group_by, 400);
    }

    let aggCol = null;
    if (agg === 'count') {
        if (agg_column !== undefined) {
            throw new AppError('agg_column is not allowed with count', 400);
        }
    } else {
        if (agg_column === undefined) {
            throw new AppError('agg_column is required for ' + agg, 400);
        }
        aggCol = columns.find(c => c.id === agg_column);
        if (!aggCol) {
            throw new AppError('unknown column: ' + agg_column, 400);
        }
        if (agg === 'sum' || agg === 'avg') {
            if (aggCol.type !== 'INTEGER' && aggCol.type !== 'NUMERIC') {
                throw new AppError('sum/avg require a numeric column', 400);
            }
        }
    }

    if (bucket !== undefined) {
        if (!['year', 'month', 'day'].includes(bucket)) {
            throw new AppError('invalid bucket', 400);
        }
        if (groupCol.type !== 'DATE' && groupCol.type !== 'TIMESTAMPTZ') {
            throw new AppError('bucket requires a date or timestamp group_by column', 400);
        }
    }

    const keyType = bucket ? 'TIMESTAMPTZ' : groupCol.type;
    let valueType;
    if (agg === 'count') {
        valueType = 'INTEGER';
    } else if (agg === 'sum' || agg === 'avg') {
        valueType = 'NUMERIC';
    } else {
        valueType = aggCol.type;
    }

    return {
        groupBy: group_by,
        agg: agg,
        aggColumn: agg_column || null,
        bucket: bucket || null,
        fields: [
            { id: 'key', type: keyType },
            { id: 'value', type: valueType }
        ]
    };
}

module.exports = { parseFilters, buildWhere, validateSort, quoteIdent, ALLOWED_OPS, validateAggregation };
