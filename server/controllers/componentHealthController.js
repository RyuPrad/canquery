const { envelope } = require('../utils/envelope');
const { readiness, componentHealth } = require('../services/componentHealth');

async function readyz(_req, res) {
    res.set('Cache-Control', 'no-store');
    const result = await readiness();
    res.status(result.ok ? 200 : 503).json(result);
}

async function component(req, res) {
    res.set('Cache-Control', 'no-store');
    const result = await componentHealth(req.params.component);
    res.status(result.ok ? 200 : 503).json(envelope(result));
}

module.exports = { readyz, component };
