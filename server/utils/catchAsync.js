const { track } = require('./runtimeWork');
function catchAsync(fn) {
    return (req, res, next) => {
        return track(Promise.resolve().then(() => fn(req, res, next))).catch(error => {
            if (req.signal?.aborted) return; // Lifecycle already replied/closed.
            next(error);
        });
    };
}

module.exports = catchAsync;
