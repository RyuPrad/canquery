const { maintenance } = require('../db/commercialQueries');
const { deliverMail } = require('./accountMail');
const { processBilling } = require('./billingService');
function startMaintenance() {
    let stopped=false;
    let timer;
    async function tick() {
        for (const work of [maintenance,deliverMail,processBilling]) {
            try { await work(); } catch { console.error('CanQuery commercial maintenance failed; retry scheduled'); }
        }
        if (!stopped) { timer=setTimeout(tick,5000);timer.unref(); }
    }
    void tick();
    return ()=>{stopped=true;clearTimeout(timer);};
}
module.exports = { startMaintenance };
