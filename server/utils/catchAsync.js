const { track } = require('./runtimeWork');
function catchAsync(fn) {
    return (req, res, next) => {
        return track(Promise.resolve().then(() => fn(req, res, next))).catch(next);
    };
}

module.exports = catchAsync;
