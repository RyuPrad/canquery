const catchAsync = require('../utils/catchAsync');
const ingestService = require('../services/ingestService');
const { prepareResource } = require('../services/preparationService');

const prepare = catchAsync(async (req, res) => {
    const job = await prepareResource(req.params.id, req.ip);
    res.set('Cache-Control', 'no-store');
    res.status(job.already_loaded ? 200 : 202).json(envelope(job));
});
const { envelope } = require('../utils/envelope');

async function enqueueIngest(req, res) {
    const job = await ingestService.enqueueIngest(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.status(job.already_loaded ? 200 : 202).json(envelope(job));
}

async function getJob(req, res) {
    const job = await ingestService.getJob(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json(envelope(job));
}

module.exports = { prepareResource: prepare, enqueueIngest: catchAsync(enqueueIngest), getJob: catchAsync(getJob) };
