const INT_RE = /^-?\d{1,15}$/;
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)??)?(Z|[+-]\d{2}:?\d{2})?$/;

function sanitizeColumnName(name, index, used) {
    let n = String(name == null ? '' : name).trim();
    n = n.replace(/"/g, '');
    n = n.substring(0, 60);
    if (n === '') {
        n = 'column_' + (index + 1);
    }
    let candidate = n;
    let counter = 0;
    while (used.has(candidate)) {
        if (counter === 0) {
            candidate = n + '_' + (index + 1);
        } else {
            candidate = n + '_' + (index + 1) + '_' + counter;
        }
        counter++;
    }
    used.add(candidate);
    return candidate;
}

function inferType(values) {
    if (values.length === 0) {
        return 'TEXT';
    }
    const allInt = values.every(v => INT_RE.test(v));
    if (allInt) {
        return 'INTEGER';
    }
    const allNum = values.every(v => NUM_RE.test(v));
    if (allNum) {
        return 'NUMERIC';
    }
    const allDate = values.every(v => DATE_RE.test(v));
    if (allDate) {
        return 'DATE';
    }
    const allTs = values.every(v => TS_RE.test(v));
    if (allTs) {
        return 'TIMESTAMPTZ';
    }
    return 'TEXT';
}

function inferColumns(headers, sampleRows) {
    const used = new Set();
    return headers.map((header, i) => {
        const id = sanitizeColumnName(header, i, used);
        const sampleValues = sampleRows
            .map(r => r[i])
            .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
            .slice(0, 1000)
            .map(v => String(v));
        const type = inferType(sampleValues);
        return { id, type };
    });
}

function pgTypeFor(type) {
    switch (type) {
        case 'INTEGER':
            return 'bigint';
        case 'NUMERIC':
            return 'numeric';
        case 'DATE':
            return 'date';
        case 'TIMESTAMPTZ':
            return 'timestamptz';
        case 'TEXT':
            return 'text';
        default:
            return 'text';
    }
}

module.exports = { sanitizeColumnName, inferType, inferColumns, pgTypeFor };
