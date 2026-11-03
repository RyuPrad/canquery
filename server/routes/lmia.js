// The /lmia pages' JSON: website only (mounted under /web-api/v1, outside the
// metered developer API) and cached for five minutes by browsers and the server.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { envelope } = require('../utils/envelope');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const lmia = require('../services/lmiaPages');
const { LMIA_DATASET_ID } = require('../services/lmiaHistory');

const router = express.Router();
const META = { license: 'Open Government Licence - Canada',
    upstream: `https://open.canada.ca/data/en/dataset/${LMIA_DATASET_ID}` };

// Typing in the search box asks once per pause; this leaves room for that and
// stops a script from walking every employer.
const searchLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many employer searches. Try again in a minute.', code: 'RATE_LIMIT' } });

function unavailable() {
    const error = new AppError('The LMIA employers history is not loaded yet', 503);
    error.publicCode = 'LMIA_HISTORY_UNAVAILABLE';
    return error;
}

router.get('/summary', catchAsync(async (_req, res) => {
    const summary = await lmia.summary();
    if (!summary) throw unavailable();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(summary, { meta: META }));
}));

router.get('/employers', searchLimiter, catchAsync(async (req, res) => {
    const input = lmia.searchInput(req.query);
    if (!await lmia.summary()) throw unavailable();
    const found = await lmia.search(input);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(found, { meta: META }));
}));

router.get('/employers/:slug', catchAsync(async (req, res) => {
    const employer = await lmia.employer(req.params.slug);
    if (!employer) {
        const error = new AppError('This employer is not on any loaded LMIA list', 404);
        error.publicCode = 'LMIA_EMPLOYER_NOT_FOUND';
        throw error;
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(employer, { meta: META }));
}));

module.exports = router;
