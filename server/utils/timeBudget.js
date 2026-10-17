// Resolves null when a read outlasts its budget. The read itself is not
// aborted: an abort would discard the pooled connection, and the lease is
// released normally once the query completes in the background.
function withinBudget(promise, ms) {
    let timer;
    const expiry = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); });
    promise.catch(() => {});
    return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

module.exports = { withinBudget };
