const catchAsync = require('../utils/catchAsync');
const repoService = require('../services/repoService');
const { envelope } = require('../utils/envelope');

// data may be null when GitHub is unreachable (negative-cached); the
// client falls back to a static "Star on GitHub" link in that case.
const getRepo = async (req, res) => {
    const data = await repoService.getRepoStats();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(data, { meta: { upstream: 'api.github.com', source: 'github' } }));
};

module.exports = { getRepo: catchAsync(getRepo) };
