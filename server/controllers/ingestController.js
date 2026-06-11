const catchAsync = require('../utils/catchAsync');
const ingestService = require('../services/ingestService');
const { envelope } = require('../utils/envelope');

async function enqueueIngest(req, res) {
    const job = await ingestService.enqueueIngest(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.status(202).json(envelope(job));
}

async function getJob(req, res) {
    const job = await ingestService.getJob(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json(envelope(job));
}

module.exports = { enqueueIngest: catchAsync(enqueueIngest), getJob: catchAsync(getJob) };
