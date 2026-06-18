const catchAsync = require('../utils/catchAsync');
const insightsService = require('../services/insightsService');
const { envelope } = require('../utils/envelope');

const getTopDownloads = async (req, res) => {
    const result = await insightsService.topDownloads();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { meta: { period: result.period } }));
};

const getFeatured = async (req, res) => {
    const items = await insightsService.featured();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(items));
};

module.exports = { getTopDownloads: catchAsync(getTopDownloads), getFeatured: catchAsync(getFeatured) };
