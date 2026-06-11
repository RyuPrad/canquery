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

module.exports = { parseFilters, buildWhere, validateSort, quoteIdent, ALLOWED_OPS };
