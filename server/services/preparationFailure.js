// Classify only known publisher/content failures. Unknown database, filesystem
// and protocol errors keep the bounded temporary policy instead of becoming
// permanent publisher failures because of a message or broad code prefix.
const INVALID_FILE_CODES = new Set([
    'CAP_FILE', 'CAP_ROWS', 'CAP_COLS', 'CAP_RESOURCE',
    'CSV_EMPTY', 'CSV_CONTENT_TYPE', 'CSV_ENCODING', 'DOWNLOAD_ENCODING',
    'INVALID_OPENING_QUOTE',
    'CSV_INVALID_CLOSING_QUOTE', 'CSV_QUOTE_NOT_CLOSED',
    'CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE', 'CSV_MAX_RECORD_SIZE',
    'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH', 'CSV_RECORD_INCONSISTENT_COLUMNS',
    'XLSX_ARCHIVE', 'XLSX_ZIP_BOMB', 'XLSX_XML', 'EXCEL_EMPTY'
]);
const UPSTREAM_CODES = new Set([
    'DOWNLOAD_URL_BLOCKED', 'DOWNLOAD_REDIRECT',
    'DOWNLOAD_DNS', 'DOWNLOAD_CERTIFICATE'
]);
const UPSTREAM_STATUSES = new Set([400, 401, 403, 404, 405, 410, 415, 422]);
const REASONS = {
    INVALID_FILE: 'invalid_file',
    UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
    CAPACITY: 'capacity',
    TEMPORARY: 'temporary'
};

function failureReason(code) {
    return Object.hasOwn(REASONS, code) ? REASONS[code] : null;
}

function preparationFailure(error, attempts) {
    const code = error?.code;
    if (INVALID_FILE_CODES.has(code)) return { code: 'INVALID_FILE', seconds: 86400 };
    if (UPSTREAM_CODES.has(code) ||
        (code === 'DOWNLOAD_HTTP' && UPSTREAM_STATUSES.has(Number(error.httpStatus)))) {
        return { code: 'UPSTREAM_UNAVAILABLE', seconds: 86400 };
    }
    if (code === 'DISK_FREE' || code === 'BUDGET') return { code: 'CAPACITY', seconds: 3600 };
    if (attempts >= 3) return { code: 'TEMPORARY', seconds: 3600 };
    const requestedMs = Number(error?.retryAfterMs);
    const delaySeconds = Number.isFinite(requestedMs) && requestedMs > 0
        ? Math.min(1800, Math.max(5, Math.ceil(requestedMs / 1000)))
        : attempts === 1 ? 30 : 120;
    return { code: 'TEMPORARY', delaySeconds };
}

module.exports = { preparationFailure, failureReason };
