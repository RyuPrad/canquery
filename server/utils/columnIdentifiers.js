const AppError = require('./AppError');

const MAX_IDENTIFIER_BYTES = 63;

function truncateUtf8(value, maxBytes = MAX_IDENTIFIER_BYTES) {
    let bytes = 0;
    let result = '';
    for (const character of String(value).toWellFormed()) {
        bytes += Buffer.byteLength(character, 'utf8');
        if (bytes > maxBytes) break;
        result += character;
    }
    return result;
}

function validColumnId(value) {
    return typeof value === 'string' && value.length > 0 && !/["\0]/.test(value) &&
        Buffer.byteLength(value, 'utf8') <= MAX_IDENTIFIER_BYTES && value.isWellFormed();
}

// Aliases are accepted only from recorded snapshot metadata, never guessed by
// truncating a caller's input. Exact current names always take precedence.
function columnResolver(columns) {
    const current = new Set(columns.map(column => column.id));
    const aliases = new Map();
    for (const column of columns) {
        if (!validColumnId(column.id) || !Array.isArray(column.legacy_ids)) continue;
        for (const legacy of column.legacy_ids) {
            if (typeof legacy !== 'string' || current.has(legacy)) continue;
            if (aliases.has(legacy) && aliases.get(legacy) !== column.id) aliases.set(legacy, null);
            else if (!aliases.has(legacy)) aliases.set(legacy, column.id);
        }
    }
    return value => {
        if (current.has(value) || !aliases.has(value)) return value;
        const resolved = aliases.get(value);
        if (resolved === null) throw new AppError('ambiguous legacy column identifier', 400);
        return resolved;
    };
}

function resolveLocalQueryColumns({ filters = [], sort, group_by, agg_column }, columns) {
    const resolve = columnResolver([{ id: '_id' }, ...columns]);
    let resolvedSort = sort;
    if (typeof sort === 'string') {
        const trimmed = sort.trim();
        const exact = resolve(trimmed);
        if (exact !== trimmed || columns.some(column => column.id === trimmed) || trimmed === '_id') resolvedSort = exact;
        else {
            const match = /^([\s\S]+?)\s+(asc|desc)$/i.exec(trimmed);
            if (match) resolvedSort = resolve(match[1]) + ' ' + match[2];
        }
    }
    return { filters: filters.map(filter => ({ ...filter, column: resolve(filter.column) })),
        sort: resolvedSort, group_by: resolve(group_by), agg_column: resolve(agg_column) };
}

module.exports = { MAX_IDENTIFIER_BYTES, truncateUtf8, validColumnId, columnResolver, resolveLocalQueryColumns };
