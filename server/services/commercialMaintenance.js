const { reconcilePreparations } = require('../db/preparationAccounting');
const { maintenance } = require('../db/commercialQueries');
const { deliverMail } = require('./accountMail');
const { processBilling } = require('./billingService');

function startMaintenance({ tasks = [
    { name: 'request_retention', run: maintenance },
    { name: 'preparation_reconciliation', run: reconcilePreparations },
    { name: 'account_mail', run: deliverMail },
    { name: 'billing_reconciliation', run: processBilling }
], intervalMs = 5000, log = entry => console.log(JSON.stringify(entry)) } = {}) {
    let stopped = false;
    let timer;
    let active;
    async function pass() {
        for (const task of tasks) {
            const started = Date.now();
            let outcome = 'ok';
            try { await task.run(); } catch { outcome = 'failed'; }
            log({ event: 'commercial_maintenance', task: task.name, outcome,
                duration_ms: Date.now() - started, release: process.env.CANQUERY_RELEASE || 'unknown' });
        }
    }
    function tick() {
        active = pass().finally(() => {
            if (!stopped) {
                timer = setTimeout(tick, intervalMs);
                timer.unref();
            }
        });
    }
    tick();
    return async function stop() {
        stopped = true;
        clearTimeout(timer);
        await active;
    };
}
module.exports = { startMaintenance };
