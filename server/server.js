const app = require('./app');
const { createShutdown } = require('./services/apiLifecycle');
const { startCatalogCountWarming } = require('./services/catalogService');
const { extension, assertEditionMatchesDatabase } = require('./extensions');
const port = process.env.PORT || 3100;
const host = process.env.HOST?.trim() || '127.0.0.1';

async function closeResources() {
    await extension().close();
    await require('./db/pool').end();
}

async function start() {
    await assertEditionMatchesDatabase(require('./db/pool'));
    const { stopMaintenance } = await extension().start();
    let closing = false;
    let stopWarming = null;
    const server = app.listen(port, host, () => {
        console.log('canquery-api listening on ' + host + ':' + port);
        if (!closing) stopWarming = startCatalogCountWarming();
    });
    const shutdown = createShutdown(server, {
        stopMaintenance: async () => {
            closing = true;
            stopWarming?.();
            if (stopMaintenance) await stopMaintenance();
        },
        closeResources
    });
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    server.on('error', () => void shutdown('listen_error'));
}
start().catch(() => {
    console.error('CanQuery startup validation failed; check runtime configuration');
    process.exit(1);
});
