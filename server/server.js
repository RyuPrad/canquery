const app = require('./app');
const { createShutdown } = require('./services/apiLifecycle');
const port = process.env.PORT || 3100;
const host = process.env.HOST?.trim() || '127.0.0.1';

async function closeResources() {
    await require('./services/authRuntime').closeAuth();
    await require('./db/pool').end();
}

async function start() {
    const { config } = require('./services/commercialConfig');
    await require('./services/billingService').verifyEnvironment();
    let stopMaintenance;
    if (config().enabled) {
        await require('./services/authRuntime').getAuth();
        stopMaintenance = require('./services/commercialMaintenance').startMaintenance();
    }
    const server = app.listen(port, host, () => console.log('canquery-api listening on ' + host + ':' + port));
    const shutdown = createShutdown(server, { stopMaintenance, closeResources });
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    server.on('error', () => void shutdown('listen_error'));
}
start().catch(() => {
    console.error('CanQuery startup validation failed; check runtime configuration');
    process.exit(1);
});
