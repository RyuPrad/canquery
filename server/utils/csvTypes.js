const INT_RE = /^-?\d{1,15}$/;
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)??)?(Z|[+-]\d{2}:?\d{2})?$/;
const { truncateUtf8, MAX_IDENTIFIER_BYTES } = require('./columnIdentifiers');

const hasLeadingZeroInteger = value => /^[+-]?0\d+$/.test(String(value).trim());

function sanitizeColumnName(name, index, used) {
    let n = String(name == null ? '' : name).trim();
    n = n.replace(/"/g, '');
    // Preserve the old initial 60-character mapping where it was valid. For
    // overlong Unicode names, match PostgreSQL's previous physical truncation.
    n = truncateUtf8(n.substring(0, 60));
    if (n.includes('\0')) throw Object.assign(new Error('CSV header contains a null character'), { code: 'CSV_COLUMN_NAME' });
    if (n === '') {
        n = 'column_' + (index + 1);
    }
    let candidate = n;
    let counter = 0;
    while (used.has(candidate)) {
        const suffix = counter === 0 ? '_' + (index + 1) : '_' + (index + 1) + '_' + counter;
        candidate = truncateUtf8(n, MAX_IDENTIFIER_BYTES - Buffer.byteLength(suffix)) + suffix;
        counter++;
    }
    used.add(candidate);
    return candidate;
}

function inferType(values) {
    if (values.length === 0) {
        return 'TEXT';
    }
    if (values.some(hasLeadingZeroInteger)) return 'TEXT';
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
    // The store generates its own _id; preserve a publisher's identically
    // named field using the same suffix rules as other duplicate headers.
    const used = new Set(['_id']);
    return headers.map((header, i) => {
        const id = sanitizeColumnName(header, i, used);
        const sampleValues = sampleRows
            .map(r => r[i])
            .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
            .slice(0, 1000)
            .map(v => String(v));
        const type = inferType(sampleValues);
        const original_label = String(header == null ? '' : header);
        const legacyId = original_label.trim().replace(/"/g, '').substring(0, 60);
        const legacy_ids = Buffer.byteLength(legacyId) > MAX_IDENTIFIER_BYTES && truncateUtf8(legacyId) === id
            ? [legacyId] : undefined;
        return { id, type, original_label, ...(legacy_ids ? { legacy_ids } : {}) };
    });
}

// Detect which of the first records is the real header row. Returns the
// index of the first record that looks header-like: at least 2 non-empty
// cells AND at least 60% of the widest row seen in the scan window. Files
// that are legitimately single-column (max 1 non-empty cell) return 0.
function detectHeaderIndex(records) {
    const window = records.slice(0, 10);
    if (window.length === 0) return 0;
    const nonEmpty = (r) => (Array.isArray(r) ? r.filter(v => v !== null && v !== undefined && String(v).trim() !== '').length : 0);
    const counts = window.map(nonEmpty);
    const maxCount = Math.max(...counts);
    if (maxCount <= 1) return 0;
    const threshold = Math.max(2, Math.ceil(0.6 * maxCount));
    for (let i = 0; i < window.length; i += 1) {
        if (counts[i] >= threshold) return i;
    }
    return 0;
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

// Conservative two-row merged-header detection and merging.
// False positives would corrupt good ingests, so guards are strict.
function mergeTwoRowHeader(headerRow, nextRow) {
    const isEmpty = (v) => v === null || v === undefined || String(v).trim() === '';

    // Guard 1: Both arguments must be arrays with at least 2 cells each
    if (!Array.isArray(headerRow) || !Array.isArray(nextRow) || headerRow.length < 2 || nextRow.length < 2) {
        return null;
    }

    // Guard 2: width
    const width = Math.max(headerRow.length, nextRow.length);

    // Guard 3: count positions where headerRow is empty and nextRow is not
    let gapsFilled = 0;
    for (let p = 0; p < width; p += 1) {
        if (isEmpty(headerRow[p]) && !isEmpty(nextRow[p])) {
            gapsFilled += 1;
        }
    }
    if (gapsFilled < 2) {
        return null;
    }

    // Guard 4: require at least one position where headerRow is non-empty and nextRow is empty
    let headerNonEmptyNextEmpty = false;
    for (let p = 0; p < width; p += 1) {
        if (!isEmpty(headerRow[p]) && isEmpty(nextRow[p])) {
            headerNonEmptyNextEmpty = true;
            break;
        }
    }
    if (!headerNonEmptyNextEmpty) {
        return null;
    }

    // Merge: forward-fill headerRow values across empty cells
    const filled = [];
    let lastSeen = undefined;
    for (let p = 0; p < width; p += 1) {
        if (!isEmpty(headerRow[p])) {
            lastSeen = headerRow[p];
        }
        filled[p] = lastSeen;
    }

    // Build merged array
    const merged = [];
    for (let p = 0; p < width; p += 1) {
        const filledVal = filled[p];
        const nextVal = nextRow[p];
        if (!isEmpty(filledVal) && !isEmpty(nextVal)) {
            merged[p] = String(filledVal).trim() + ' ' + String(nextVal).trim();
        } else if (!isEmpty(nextVal)) {
            merged[p] = String(nextVal).trim();
        } else if (filledVal === undefined) {
            merged[p] = '';
        } else {
            merged[p] = String(filledVal).trim();
        }
    }

    return merged;
}

module.exports = { sanitizeColumnName, inferType, inferColumns, pgTypeFor, detectHeaderIndex, mergeTwoRowHeader, hasLeadingZeroInteger };
