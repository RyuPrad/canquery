// The /oas pages' JSON: website only (mounted under /web-api/v1, outside the metered
// developer API) and cached for five minutes by browsers and the server. The income a
// visitor looks up never comes here: the page finds its band in the table it was sent.
const express = require('express');
const { envelope } = require('../utils/envelope');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const oas = require('../services/oasPages');

const router = express.Router();
const META = oas.OAS_META;

function failure(message, status, code) {
    const error = new AppError(message, status);
    error.publicCode = code;
    return error;
}
const unavailable = () => failure('The tables of OAS benefit amounts are not loaded yet', 503, 'OAS_AMOUNTS_UNAVAILABLE');

router.get('/summary', catchAsync(async (_req, res) => {
    const summary = await oas.summary();
    if (!summary) throw unavailable();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(summary, { meta: META }));
}));

router.get('/tables/:table', catchAsync(async (req, res) => {
    if (!/^[1-5]$/.test(req.params.table)) throw failure('The OAS benefit amounts have tables 1 to 5', 404, 'OAS_TABLE_NOT_FOUND');
    const asked = req.query.period;
    if (asked !== undefined && (typeof asked !== 'string' || !/^\d{6}$/.test(asked))) {
        throw failure('Give period once, as a year and the last month of its quarter (202612)', 400, 'INVALID_QUERY');
    }
    if (!await oas.summary()) throw unavailable();
    const found = await oas.table(Number(req.params.table), { period: asked === undefined ? null : Number(asked) });
    if (!found) throw failure('That quarter of OAS benefit amounts is not loaded', 404, 'OAS_PERIOD_NOT_FOUND');
    res.set('Cache-Control', 'public, max-age=300');
    res.json(envelope(found, { meta: META }));
}));

module.exports = router;
