function errorHandler(err, req, res, next) {
    // A streaming CSV can fail after its headers/body have started. Delegating
    // lets Express close the partial response; attempting another JSON response
    // here would itself throw ERR_HTTP_HEADERS_SENT and obscure the real error.
    if (res.headersSent) return next(err);

    const suppliedStatus = Number(err && (err.statusCode || err.status));
    const statusCode = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599
        ? suppliedStatus
        : 500;
    const operational = Boolean(err && err.isOperational === true);
    let message;
    if (operational) {
        message = err.message || 'Request failed';
    } else if (statusCode >= 500) {
        message = 'Internal server error';
    } else if (statusCode === 404) {
        message = 'Not found';
    } else if (statusCode === 401) {
        message = 'Unauthorized';
    } else if (statusCode === 403) {
        message = 'Forbidden';
    } else {
        message = 'Invalid request';
    }
    const requestId = req.id || 'unavailable';

    if (process.env.NODE_ENV !== 'test') {
        // JSON encoding prevents newline/control-character log injection from
        // request-derived operational messages. Unexpected errors retain their
        // full stack in server logs but never in production responses.
        console.error(JSON.stringify({
            level: 'error',
            request_id: requestId,
            method: req.method,
            path: req.path,
            status: statusCode,
            message: err && err.message,
            ...(!operational && err && err.stack ? { stack: err.stack } : {})
        }));
    }

    res.status(statusCode).json({
        error: message,
        request_id: requestId,
        ...(operational && err.hint && { hint: err.hint }),
        ...(operational && err.download_url && { download_url: err.download_url }),
        ...(process.env.NODE_ENV !== 'production' && err && err.stack && { stack: err.stack })
    });
}

module.exports = errorHandler;
