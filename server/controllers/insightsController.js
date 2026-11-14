const catchAsync = require('../utils/catchAsync');
const insightsService = require('../services/insightsService');
const { envelope } = require('../utils/envelope');

// Charts follow the UI language: ?lang=fr serves French representatives, anything
// else (default) serves English.
const pickLang = (req) => (req.query.lang === 'fr' ? 'fr' : 'en');

const getTopDownloads = async (req, res) => {
    const result = await insightsService.topDownloads(pickLang(req));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { meta: { period: result.period } }));
};

const getFeatured = async (req, res) => {
    const items = await insightsService.featured(pickLang(req));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(items));
};

// The chart cards of the homepage and the Insights gallery: the chart
// engine's best card-sized chart of each prepared Top 100 table.
const getChartCards = async (req, res) => {
    const items = await insightsService.cards(pickLang(req));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(items));
};

module.exports = { getTopDownloads: catchAsync(getTopDownloads), getFeatured: catchAsync(getFeatured), getChartCards: catchAsync(getChartCards) };
