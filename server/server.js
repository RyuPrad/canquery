const app = require('./app');
const port = process.env.PORT || 3100;
async function start() {
    const { config } = require('./services/commercialConfig');
    const { verifyEnvironment } = require('./services/billingService');
    await verifyEnvironment();
    if (config().enabled) {
        await require('./services/authRuntime').getAuth();
        require('./services/commercialMaintenance').startMaintenance();
    }
    app.listen(port,()=>console.log('canquery-api listening on :'+port));
}
start().catch(()=>{console.error('CanQuery startup validation failed; check commercial configuration');process.exit(1);});
