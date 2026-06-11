function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Something went wrong';

    if (process.env.NODE_ENV !== 'test') {
        console.error(`[Error] ${statusCode} ${message}`);
    }

    res.status(statusCode).json({
        error: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
}

module.exports = errorHandler;
