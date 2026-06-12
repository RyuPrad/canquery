const catchAsync = require('../utils/catchAsync');
const catalogService = require('../services/catalogService');
const { envelope } = require('../utils/envelope');
const AppError = require('../utils/AppError');

const cleanStr = (v) => {
    if (typeof v === 'string' && v.trim() !== '') {
        const trimmed = v.trim();
        if (trimmed.length > 200) throw new AppError('Query parameter too long', 400);
        return trimmed;
    }
    return undefined;
};

const listDatasets = async (req, res) => {
    const { q, org, format, keyword, limit, cursor } = req.query;
    const result = await catalogService.searchDatasets({
        q: cleanStr(q),
        org: cleanStr(org),
        format: cleanStr(format),
        keyword: cleanStr(keyword),
        limit,
        cursor
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { nextCursor: result.nextCursor }));
};

const getDataset = async (req, res) => {
    const dataset = await catalogService.getDataset(req.params.idOrName);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(dataset));
};

const getResource = async (req, res) => {
    const resource = await catalogService.getResource(req.params.id);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(resource));
};

const listOrganizations = async (req, res) => {
    const result = await catalogService.listOrganizations({
        limit: req.query.limit,
        cursor: req.query.cursor
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(result.items, { nextCursor: result.nextCursor }));
};

const getStats = async (req, res) => {
    const stats = await catalogService.getStats();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(stats));
};

const getRecentlyUnlocked = async (req, res) => {
    const items = await catalogService.recentlyUnlocked(req.query.limit);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(envelope(items));
};

const getPopular = async (req, res) => {
    const items = await catalogService.popularResources({ days: req.query.days, limit: req.query.limit });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(items));
};

const healthz = async (req, res) => {
    const health = await catalogService.healthz();
    res.set('Cache-Control', 'no-store');
    res.status(health.ok ? 200 : 503).json(health);
};

const getOps = async (req, res) => {
    const status = await catalogService.opsStatus();
    res.set('Cache-Control', 'no-store');
    res.status(status.ok ? 200 : 503).json(envelope(status));
};

module.exports = {
    listDatasets: catchAsync(listDatasets),
    getDataset: catchAsync(getDataset),
    getResource: catchAsync(getResource),
    listOrganizations: catchAsync(listOrganizations),
    getStats: catchAsync(getStats),
    getRecentlyUnlocked: catchAsync(getRecentlyUnlocked),
    getPopular: catchAsync(getPopular),
    healthz: catchAsync(healthz),
    getOps: catchAsync(getOps)
};
