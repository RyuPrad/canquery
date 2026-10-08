const http = require('node:http');
const { track } = require('../../utils/runtimeWork');
const { createShutdown } = require('../../services/apiLifecycle');
const { startMaintenance } = require('../../services/commercialMaintenance');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let active = 0;
const server = http.createServer((req, res) => {
    track((async () => {
        if (req.url === '/export') res.write('header\n');
        process.send({ event: 'request_started', active: ++active });
        await wait(150);
        res.end(req.url === '/export' ? 'row\n' : '{"ok":true}');
    })()).catch(() => res.destroy());
});
server.listen(0, '127.0.0.1', () => process.send({ event: 'ready', port: server.address().port }));
const stopMaintenance = startMaintenance({ tasks: [{ name: 'held', run: () => wait(200) }], log: () => {} });
const shutdown = createShutdown(server, {
    stopMaintenance, drainMs: 2000, cleanupMs: 1000,
    closeResources: async () => process.send({ event: 'resources_closed' }), log: () => {}
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
