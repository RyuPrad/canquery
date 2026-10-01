const { preparationFailure, failureReason } = require('../services/preparationFailure');

test.each(['CAP_FILE', 'CAP_ROWS', 'CAP_COLS', 'CAP_RESOURCE', 'CSV_EMPTY', 'CSV_CONTENT_TYPE',
    'CSV_ENCODING', 'DOWNLOAD_ENCODING', 'INVALID_OPENING_QUOTE', 'CSV_INVALID_CLOSING_QUOTE', 'CSV_QUOTE_NOT_CLOSED', 'CSV_MAX_RECORD_SIZE',
    'CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE', 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH', 'CSV_RECORD_INCONSISTENT_COLUMNS',
    'XLSX_ARCHIVE', 'XLSX_ZIP_BOMB', 'XLSX_XML', 'EXCEL_EMPTY'])('known file failure %s stops the first attempt with a 24-hour cooldown', code => {
    expect(preparationFailure({ code }, 1)).toEqual({ code: 'INVALID_FILE', seconds: 86400 });
});

test.each([400, 401, 403, 404, 405, 410, 415, 422])('permanent upstream HTTP %s stops the first attempt with a distinct 24-hour reason', httpStatus => {
    expect(preparationFailure({ code: 'DOWNLOAD_HTTP', httpStatus }, 1))
        .toEqual({ code: 'UPSTREAM_UNAVAILABLE', seconds: 86400 });
});

test.each(['DOWNLOAD_URL_BLOCKED', 'DOWNLOAD_REDIRECT', 'DOWNLOAD_DNS', 'DOWNLOAD_CERTIFICATE'])('typed upstream failure %s has a 24-hour cooldown', code => {
    expect(preparationFailure({ code }, 1)).toEqual({ code: 'UPSTREAM_UNAVAILABLE', seconds: 86400 });
});

test.each(['DISK_FREE', 'BUDGET'])('capacity failure %s stops immediately for one hour', code => {
    expect(preparationFailure({ code }, 1)).toEqual({ code: 'CAPACITY', seconds: 3600 });
});

test.each(['53100', '57014', '08006', 'ENOENT', 'EACCES', 'ENOTFOUND', 'CERT_HAS_EXPIRED',
    'DOWNLOAD_BODY', 'STORE_SIZE_INVALID', 'DISK_CHECK', 'EXCEL_CONVERSION', 'XLSX_TIMEOUT', 'CSV_UNKNOWN', 'SOURCE_CHANGED', undefined])('unknown/infrastructure failure %s retains the bounded temporary policy', code => {
    const error = { code, message: 'private publisher/file/SQL detail', cause: { code: 'ENOTFOUND' } };
    expect(preparationFailure(error, 1)).toEqual({ code: 'TEMPORARY', delaySeconds: 30 });
    expect(preparationFailure(error, 2)).toEqual({ code: 'TEMPORARY', delaySeconds: 120 });
    expect(preparationFailure(error, 3)).toEqual({ code: 'TEMPORARY', seconds: 3600 });
});

test.each([202, 408, 425, 429, 500, 502, 503, 504])('temporary HTTP %s retries', httpStatus => {
    expect(preparationFailure({ code: 'DOWNLOAD_HTTP', httpStatus }, 1))
        .toEqual({ code: 'TEMPORARY', delaySeconds: 30 });
});

test.each([[1, 5], [5000, 5], [123456, 124], [99999999, 1800]])('publisher Retry-After %sms is bounded to %ss', (retryAfterMs, delaySeconds) => {
    expect(preparationFailure({ code: 'DOWNLOAD_PENDING', retryAfterMs }, 1))
        .toEqual({ code: 'TEMPORARY', delaySeconds });
    expect(preparationFailure({ code: 'DOWNLOAD_PENDING', retryAfterMs }, 3))
        .toEqual({ code: 'TEMPORARY', seconds: 3600 });
});

test.each([0, -1, Infinity, NaN, 'wrong', undefined])('invalid Retry-After %s uses ordinary backoff', retryAfterMs => {
    expect(preparationFailure({ retryAfterMs }, 2)).toEqual({ code: 'TEMPORARY', delaySeconds: 120 });
});

test('public reasons expose only the four policy categories', () => {
    expect(['INVALID_FILE', 'UPSTREAM_UNAVAILABLE', 'CAPACITY', 'TEMPORARY'].map(failureReason))
        .toEqual(['invalid_file', 'upstream_unavailable', 'capacity', 'temporary']);
    expect(failureReason('private SQL /etc/path')).toBeNull();
    expect(failureReason('__proto__')).toBeNull();
    expect(failureReason(null)).toBeNull();
});
