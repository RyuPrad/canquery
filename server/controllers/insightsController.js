const catchAsync = require('../utils/catchAsync');
const insightsService = require('../services/insightsService');
const { envelope } = require('../utils/envelope');

const getTopDownloads = async (req, res) => {
    const result = await insightsService.topDownloads();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { meta: { period: result.period } }));
};

module.exports = { getTopDownloads: catchAsync(getTopDownloads) };
