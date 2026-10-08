const { track } = require('../utils/runtimeWork');

// One settlement, followed by an optional disconnect reversal. No connection
// or transaction is retained during response streaming.
function attachMeteredResponse(res, context, { queries, pool, deadlineMs = 240000, heartbeatMs = 30000 }) {
    let settlement;
    let reversal;
    let ending = false;
    let heartbeating = false;
    const end = res.end;
    function finalize(charge) {
        settlement ||= track(Promise.resolve().then(() => queries.settle(context.id, charge)));
        return settlement;
    }
    function abort() {
        reversal ||= track((settlement || Promise.resolve()).catch(() => {})
            .then(() => queries.abortRequest(context.id)));
        return reversal;
    }
    const heartbeat = setInterval(() => {
        if (heartbeating) return;
        heartbeating = true;
        track(pool.query("UPDATE commercial.requests SET expires_at=now()+interval '5 minutes' WHERE id=$1 AND state='reserved'", [context.id]))
            .catch(() => res.destroy()).finally(() => { heartbeating = false; });
    }, heartbeatMs);
    heartbeat.unref();
    const deadline = setTimeout(() => res.destroy(), deadlineMs);
    deadline.unref();
    function cleanup() {
        clearInterval(heartbeat);
        clearTimeout(deadline);
    }
    res.end = function(...args) {
        if (ending) return this;
        ending = true;
        finalize(res.statusCode >= 200 && res.statusCode < 400).then(() => {
            if (!res.destroyed) end.apply(res, args);
        }).catch(() => res.destroy());
        return this;
    };
    res.once('close', () => {
        cleanup();
        if (!res.writableFinished) abort().catch(() => {});
    });
    return { finalize, abort, cleanup };
}
module.exports = { attachMeteredResponse };
