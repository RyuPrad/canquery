const AppError = require('../utils/AppError');
const { runWithRequestSignal } = require('../utils/requestContext');

// Cloudflare's default proxy read deadline is 125s. Return a shaped error before
// that boundary, or close an already-started stream. Actual response writes reset
// the progress clock; the separate keyed four-minute absolute ceiling remains.
function requestLifetime({ idleMs = 110000 } = {}) {
    return (req, res, next) => {
        const controller = new AbortController();
        req.signal = controller.signal;
        let timer;
        const cleanup = () => clearTimeout(timer);
        const abort = error => {
            cleanup();
            if (!controller.signal.aborted) controller.abort(error);
        };
        const progress = () => {
            cleanup();
            if (controller.signal.aborted || res.writableFinished || res.destroyed) return;
            timer = setTimeout(() => {
                const error = new AppError('Request made no response progress before its deadline', 504);
                error.publicCode = 'REQUEST_TIMEOUT';
                abort(error);
                if (res.headersSent || res.locals?.meteredResponseEnding) res.destroy();
                else {
                    // Timeout belongs to this lifecycle, not a second Express
                    // error traversal racing an aborted query's rejection.
                    res.status(504).set('Cache-Control', 'no-store').json({
                        error: error.message, code: error.publicCode, request_id: req.id || 'unavailable'
                    });
                }
            }, idleMs);
            timer.unref();
        };
        const write = res.write;
        res.write = function(...args) { progress(); return write.apply(this, args); };
        res.once('finish', cleanup);
        res.once('close', () => {
            cleanup();
            if (!res.writableFinished) abort(new AppError('Client disconnected', 499));
        });
        req.once('aborted', () => abort(new AppError('Client disconnected', 499)));
        progress();
        return runWithRequestSignal(controller.signal, next);
    };
}
module.exports = { requestLifetime };
