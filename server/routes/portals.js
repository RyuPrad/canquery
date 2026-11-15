// The /portals page's JSON: website only (mounted under /web-api/v1, outside the
// metered developer API) and cached for five minutes by browsers; the server
// keeps the directory for ten (services/portalPages.js).
const express = require('express');
const { envelope } = require('../utils/envelope');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const portals = require('../services/portalPages');

const router = express.Router();

router.get('/', catchAsync(async (_req, res) => {
    const directory = await portals.directory();
    if (!directory) {
        const error = new AppError('No open-data portal is mirrored here yet', 503);
        error.publicCode = 'PORTALS_UNAVAILABLE';
        throw error;
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(directory, { meta: portals.PORTALS_META }));
}));

module.exports = router;
